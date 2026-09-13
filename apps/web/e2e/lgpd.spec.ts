import { test, expect } from '@playwright/test';
import JSZip from 'jszip';
import { createDb, createPatient, addMedication, adjustDose, type Session } from '@medcheckin/core';
import { abrirConfiguracao, loginAsDoctor } from './helpers';

test.describe('E7 — relatório, export e anonimização', () => {
  test('relatório imprimível → export.zip com contagens → anonimizar mantém séries', async ({
    page,
    context,
    baseURL,
  }) => {
    await loginAsDoctor(context, baseURL!);
    const db = createDb(process.env.DATABASE_URL_TEST || process.env.DATABASE_URL!);
    // paciente próprio deste teste (não anonimizar os do seed: outros specs dependem deles)
    const user = await db('users').where({ email: 'medica@medcheckin.test' }).first();
    const doctor = {
      kind: 'user',
      sessionId: 'e2e',
      userId: user.id,
      clinicId: user.clinic_id,
      role: 'doctor',
      name: 'Dra.',
      email: user.email,
    } as Session;
    const { patient: p1 } = await createPatient(
      db,
      doctor,
      {
        name: 'Paciente LGPD E2E',
        respondents: [{ kind: 'caregiver', name: 'Cuidador LGPD', email: 'lgpd@x.test' }],
        consent_version: 'v1',
      },
      new Date(),
    );
    const product = await db('products').first();
    const med = await addMedication(db, doctor, p1.id, { product_id: product.id }, new Date());
    await adjustDose(
      db,
      doctor,
      med.id,
      {
        effective_from: '2026-08-01',
        dose_amount: 2,
        dose_unit: 'gotas',
        times_per_day: 2,
        schedule_times: ['08:00', '20:00'],
        reason: 'início',
      },
      new Date(),
    );
    await adjustDose(
      db,
      doctor,
      med.id,
      {
        effective_from: '2026-08-10',
        dose_amount: 3,
        dose_unit: 'gotas',
        times_per_day: 2,
        schedule_times: ['08:00', '20:00'],
        reason: 'ajuste',
      },
      new Date(),
    );
    const scoresBefore = await db('patient_scores_daily')
      .where({ patient_id: p1.id })
      .orderBy('date');
    const dosesBefore = await db('dose_events as d')
      .join('medications as m', 'm.id', 'd.medication_id')
      .where('m.patient_id', p1.id)
      .count()
      .first();

    // relatório
    await page.goto(`/pacientes/${p1.id}/relatorio`);
    await expect(page.getByTestId('report')).toContainText(
      'Relatório de acompanhamento — Paciente LGPD E2E',
    );
    await expect(page.getByTestId('stat-adherence')).toBeVisible();
    await expect(page.getByTestId('print')).toBeVisible();

    // export (download)
    await page.goto(`/pacientes/${p1.id}`);
    await abrirConfiguracao(page);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('export').click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^medcheckin-export-.*\.zip$/);
    const path = await download.path();
    const fs = await import('node:fs');
    const zip = await JSZip.loadAsync(fs.readFileSync(path!));
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
    expect(manifest.counts.dose_events).toBeGreaterThanOrEqual(2);
    expect(manifest.counts).toHaveProperty('checkins');
    expect(Object.keys(zip.files)).toContain('checkins.json');

    // anonimizar: botão só habilita com o nome exato
    await page.getByTestId('anonymize-open').click();
    await page.getByTestId('anonymize-reason').fill('Pedido do titular (E2E)');
    await page.getByTestId('anonymize-name').fill('nome errado');
    await expect(page.getByTestId('anonymize-submit')).toBeDisabled();
    await page.getByTestId('anonymize-name').fill('Paciente LGPD E2E');
    await page.getByTestId('anonymize-submit').click();
    await expect(page.getByTestId('patient-name')).toContainText('Paciente anonimizado');
    // D28: o botão dá lugar à data, e não depende do status (alta grava o mesmo status)
    await expect(page.getByTestId('anonymized-at')).toBeVisible();
    await expect(page.getByTestId('anonymize-open')).toHaveCount(0);
    const scoresAfter = await db('patient_scores_daily')
      .where({ patient_id: p1.id })
      .orderBy('date');
    expect(scoresAfter.map((s) => s.score)).toEqual(scoresBefore.map((s) => s.score));
    const dosesAfter = await db('dose_events as d')
      .join('medications as m', 'm.id', 'd.medication_id')
      .where('m.patient_id', p1.id)
      .count()
      .first();
    expect(dosesAfter!.count).toBe(dosesBefore!.count);
    const r = await db('respondents').where({ patient_id: p1.id }).first();
    expect(r.email).toBeNull();
    await page.screenshot({ path: 'test-results/lgpd-anonimizado.png', fullPage: true });
    await db.destroy();
  });
});
