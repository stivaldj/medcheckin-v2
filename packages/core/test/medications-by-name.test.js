import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { freshDb, seedClinic, seedPatient } from './helpers/db.js';
import { addMedication, findOrCreateProduct, createProduct } from '../src/medications/index.js';

// D34: a médica digita o nome; o backend acha ou cria o produto e vincula ao paciente.
describe('medicação por nome', () => {
  let db, ctx, session, patientId;
  const NOW = new Date('2026-09-14T12:00:00Z');
  beforeAll(async () => {
    db = await freshDb();
    ctx = await seedClinic(db, 'nome');
    patientId = await seedPatient(db, ctx);
    session = {
      kind: 'user',
      sessionId: 't',
      userId: ctx.userId,
      clinicId: ctx.clinicId,
      role: 'doctor',
      name: 'Dra.',
      email: 'dra-nome@example.test',
    };
  });
  afterAll(async () => db.destroy());

  const count = async () =>
    Number((await db('products').where({ clinic_id: ctx.clinicId }).count().first()).count);

  it('nome novo cria o produto com o texto como digitado e vincula ao paciente', async () => {
    const med = await addMedication(db, session, patientId, { name: '  Óleo CBD 50mg/ml ' }, NOW);
    expect(med.patient_id).toBe(patientId);
    expect(med.product_name).toBe('Óleo CBD 50mg/ml');
    const prod = await db('products').where({ id: med.product_id }).first();
    expect(prod.name).toBe('Óleo CBD 50mg/ml');
    expect(prod.name_key).toBe('oleo cbd 50mg/ml');
    expect(prod.form).toBe('oil');
    expect(await count()).toBe(1);
  });

  it('nome repetido com caixa e acento diferentes reaproveita o produto', async () => {
    const med = await addMedication(db, session, patientId, { name: 'OLEO cbd 50MG/ML' }, NOW);
    const primeiro = await db('products').where({ clinic_id: ctx.clinicId }).first();
    expect(med.product_id).toBe(primeiro.id);
    expect(med.product_name).toBe('Óleo CBD 50mg/ml'); // o nome exibido é o do primeiro cadastro
    expect(await count()).toBe(1);
  });

  it('product_id continua funcionando', async () => {
    const prod = await db('products').where({ clinic_id: ctx.clinicId }).first();
    const med = await addMedication(db, session, patientId, { product_id: prod.id }, NOW);
    expect(med.product_id).toBe(prod.id);
    expect(med.product_name).toBe(prod.name);
  });

  it('recusa nome curto, nome longo e ausência de nome e product_id', async () => {
    await expect(addMedication(db, session, patientId, { name: 'x' }, NOW)).rejects.toMatchObject({
      code: 'validation',
      field: 'name',
    });
    await expect(
      addMedication(db, session, patientId, { name: 'a'.repeat(121) }, NOW),
    ).rejects.toMatchObject({ code: 'validation', field: 'name' });
    await expect(addMedication(db, session, patientId, {}, NOW)).rejects.toMatchObject({
      code: 'validation',
      field: 'name',
    });
  });

  it('product_id de outra clínica é not_found', async () => {
    const outra = await seedClinic(db, 'outra');
    const { product } = await findOrCreateProduct(
      db,
      { ...session, clinicId: outra.clinicId, userId: outra.userId },
      { name: 'Produto da outra' },
    );
    await expect(
      addMedication(db, session, patientId, { product_id: product.id }, NOW),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('duas chamadas em paralelo com o mesmo nome novo criam um produto só', async () => {
    const antes = await count();
    const [a, b] = await Promise.all([
      addMedication(db, session, patientId, { name: 'Canabidiol 200mg/ml' }, NOW),
      addMedication(db, session, patientId, { name: 'canabidiol 200MG/ML' }, NOW),
    ]);
    expect(a.product_id).toBe(b.product_id);
    expect(await count()).toBe(antes + 1);
  });

  it('createProduct passa a ser idempotente pela chave', async () => {
    const p1 = await createProduct(db, session, { name: 'Gotas THC 1%' });
    const p2 = await createProduct(db, session, { name: 'gotas thc 1%' });
    expect(p2.id).toBe(p1.id);
    expect(p1.name_key).toBe('gotas thc 1%');
  });

  it('findOrCreateProduct exige sessão de médica', async () => {
    await expect(findOrCreateProduct(db, null, { name: 'Qualquer' })).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });
});
