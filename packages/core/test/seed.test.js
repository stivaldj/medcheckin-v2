import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { freshDb } from './helpers/db.js';
import { runSeed } from '../src/seed/index.js';

// D7: seed 100% sintético; contagens são a prova de E1.
describe('seed sintético', () => {
  let db, counts;
  beforeAll(async () => {
    db = await freshDb();
    counts = await runSeed(db);
  });
  afterAll(async () => {
    await db.destroy();
  });

  it('cria 1 clínica, 1 médica, 2 pacientes, 3 respondentes (1 cuidador), 1 produto', () => {
    expect(counts).toMatchObject({
      clinics: 1,
      users: 1,
      patients: 2,
      respondents: 3,
      products: 1,
      medications: 2,
    });
    expect(counts.dose_events).toBeGreaterThanOrEqual(3);
    expect(counts.questions).toBeGreaterThanOrEqual(5);
    expect(counts.episodes).toBe(2);
  });

  it('exatamente 1 respondente é cuidador, vinculado a um paciente', async () => {
    const cg = await db('respondents').where({ kind: 'caregiver' });
    expect(cg).toHaveLength(1);
    expect(cg[0].relationship).toBeTruthy();
  });

  it('nenhum dado parece real: e-mails em .test e telefones fictícios', async () => {
    const rows = await db('respondents').select('email', 'phone');
    for (const r of rows) {
      if (r.email) expect(r.email.endsWith('.test')).toBe(true);
      if (r.phone) expect(r.phone.startsWith('+55659100')).toBe(true);
    }
    const users = await db('users').select('email');
    for (const u of users) expect(u.email.endsWith('.test')).toBe(true);
  });

  it('se recusa a rodar sobre banco já populado (sem reset explícito)', async () => {
    await expect(runSeed(db)).rejects.toThrow(/já contém dados/);
  });

  it('com reset explícito, limpa e recria (idempotente)', async () => {
    const again = await runSeed(db, { reset: true });
    expect(again.patients).toBe(2);
  });
});
