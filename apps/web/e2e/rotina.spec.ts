import { test, expect } from '@playwright/test';
import { DateTime } from 'luxon';
import { createDb, dispatchDueRoutineAlarms } from '@medcheckin/core';
import type { Knex } from 'knex';
import { loginAsDoctor } from './helpers';

/**
 * PROVA E9.1 — rotina de alarmes por período na página do paciente:
 * criar período com 2 alarmes (texto livre) → replicar editando o texto → encerrar hoje →
 * fora do período nenhum alarme sai.
 */
const TZ = 'America/Cuiaba';
const TODAY = DateTime.now().setZone(TZ).startOf('day');
const iso = (n: number) => TODAY.plus({ days: n }).toISODate()!;
const br = (n: number) => iso(n).split('-').reverse().join('/');
const fakeNotifier = {
  async send() {
    return { ok: true };
  },
};

test.describe('rotina de alarmes por período', () => {
  let db: Knex;
  let patientId: string;

  test.beforeAll(async () => {
    db = createDb(process.env.DATABASE_URL_TEST || process.env.DATABASE_URL!);
    const clinic = await db('clinics').first();
    const doctor = await db('users').first();
    const [p] = await db('patients')
      .insert({
        clinic_id: clinic.id,
        name: 'Paciente Rotina E2E',
        timezone: TZ,
        created_by: doctor.id,
      })
      .returning('id');
    await db('respondents').insert({
      patient_id: p.id,
      kind: 'patient',
      name: 'Paciente Rotina E2E',
      invite_token: 'e2e-rotina',
      accepted_at: new Date(),
    });
    patientId = p.id;
  });
  test.afterAll(async () => db.destroy());

  test('criar → replicar editando o texto → encerrar hoje → sem período, nenhum alarme', async ({
    page,
    context,
    baseURL,
  }) => {
    await loginAsDoctor(context, baseURL!);
    await page.goto(`/pacientes/${patientId}`);
    const card = page.getByTestId('routine-card');
    await expect(card).toContainText('Nenhum período vigente');

    // 1. novo período: hoje → +4, dois horários com texto livre
    await card.getByTestId('routine-new').click();
    await page.getByLabel('Início').fill(iso(0));
    await page.getByLabel('Fim (opcional)').fill(iso(4));
    await page.getByTestId('routine-time-0').fill('08:00');
    await page
      .getByTestId('routine-desc-0')
      .fill('ômega 3 1cp / 4 gts óleo IBRACAN 10% / vitamina D');
    await page.getByTestId('routine-add-alarm').click();
    await page.getByTestId('routine-time-1').fill('20:00');
    await page.getByTestId('routine-desc-1').fill('4 gts óleo IBRACAN 10% sublingual');
    await page.getByTestId('routine-new-submit').click();

    await expect(card.getByTestId('routine-current')).toContainText(`${br(0)} → ${br(4)}`);
    await expect(card.getByTestId('routine-current')).toContainText('2 alarmes');
    await expect(card.getByTestId('routine-current')).toContainText(
      'ômega 3 1cp / 4 gts óleo IBRACAN 10% / vitamina D',
    );
    await expect(card.getByTestId('routine-recipients')).toContainText('Paciente Rotina E2E');

    // 2. replicar: começa no dia seguinte ao fim, com os textos copiados — edito um deles
    await card.getByTestId('routine-replicate').click();
    await expect(page.getByLabel('Início')).toHaveValue(iso(5));
    await expect(page.getByTestId('routine-desc-0')).toHaveValue(
      'ômega 3 1cp / 4 gts óleo IBRACAN 10% / vitamina D',
    );
    await page.getByLabel('Fim (opcional)').fill(iso(9));
    await page.getByTestId('routine-desc-0').fill('ômega 3 1cp / 5 gts óleo IBRACAN 10%');
    await page.getByTestId('routine-replicate-submit').click();

    const future = card.getByTestId('routine-future').first();
    await expect(future).toContainText(`${br(5)} → ${br(9)}`);
    await expect(future).toContainText('ômega 3 1cp / 5 gts óleo IBRACAN 10%');
    // o período vigente ficou intacto
    await expect(card.getByTestId('routine-current')).toContainText(
      'ômega 3 1cp / 4 gts óleo IBRACAN 10% / vitamina D',
    );
    await page.screenshot({ path: 'test-results/rotina-paciente.png', fullPage: true });

    // 3. o alarme das 08:00 de hoje sai com a descrição no corpo do push
    const out = await dispatchDueRoutineAlarms(db, TODAY.set({ hour: 8, minute: 5 }).toJSDate(), {
      notifier: fakeNotifier,
    });
    expect(out.sent).toBeGreaterThanOrEqual(1);
    const n = await db('notifications as n')
      .where({ 'n.patient_id': patientId, 'n.kind': 'alarm' })
      .first();
    expect(n.payload.body).toBe('ômega 3 1cp / 4 gts óleo IBRACAN 10% / vitamina D');

    // 4. encerrar hoje → amanhã já está fora do período: nenhum alarme
    await card.getByTestId('routine-end-today').click();
    await expect(card.getByTestId('routine-current')).toContainText(`${br(0)} → ${br(0)}`);
    const tomorrow = await dispatchDueRoutineAlarms(
      db,
      TODAY.plus({ days: 1 }).set({ hour: 8, minute: 5 }).toJSDate(),
      { notifier: fakeNotifier },
    );
    const forPatient = await db('notifications')
      .where({ patient_id: patientId, kind: 'alarm' })
      .count()
      .first();
    expect(Number(forPatient!.count)).toBe(1); // nada novo depois do fim do período
    expect(tomorrow.no_respondent).toBe(0);
  });
});
