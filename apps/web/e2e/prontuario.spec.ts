// apps/web/e2e/prontuario.spec.ts
import { test, expect } from '@playwright/test';
import { createDb, createPatient, addMedication, type Session } from '@medcheckin/core';
import { abrirCaso, abrirConfiguracao, loginAsDoctor } from './helpers';

/**
 * E12.1 / D35 — nota na consulta, ajuste de dose no mesmo dia aparece sob a nota, editar, ocultar.
 */
test.describe('prontuário', () => {
  test('nota + ajuste de dose no mesmo dia → agrupados; editar; ocultar', async ({
    page,
    context,
    baseURL,
  }) => {
    await loginAsDoctor(context, baseURL!);
    const db = createDb(process.env.DATABASE_URL_TEST || process.env.DATABASE_URL!);
    try {
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
      const { patient } = await createPatient(
        db,
        doctor,
        {
          name: 'Paciente Prontuário E2E',
          respondents: [{ kind: 'caregiver', name: 'C', email: 'pront@x.test' }],
          consent_version: 'v1',
        },
        new Date(),
      );
      await addMedication(db, doctor, patient.id, { name: 'Óleo Prontuário 10 mg/ml' }, new Date());

      await page.goto(`/pacientes/${patient.id}`);
      const card = page.getByTestId('prontuario-card');
      await expect(card).toContainText('Nenhuma nota ainda');

      // 1. nova nota (Ctrl+Enter salva)
      await card.getByTestId('note-new').click();
      await card.getByTestId('note-body').fill('Queixa de dor 7/10. Conduta: subir para 4 gotas.');
      await card.getByTestId('note-body').press('Control+Enter');
      const nota = card.getByTestId('note-item');
      await expect(nota).toContainText('Queixa de dor 7/10');
      await expect(nota).toContainText('Consulta');

      // 2. ajuste de dose hoje → aparece no MESMO dia, embaixo da nota
      await abrirConfiguracao(page);
      const med = page.getByTestId('medication').first();
      await med.getByRole('button', { name: 'Ajustar dose' }).click();
      await page.getByLabel('Dose', { exact: true }).fill('4');
      await page.getByLabel('Vezes por dia').fill('2');
      await page.getByTestId('dose-time-0').fill('08:00');
      await page.getByTestId('dose-time-1').fill('20:00');
      await page.getByLabel('Motivo').fill('dor persistente');
      await page.getByRole('button', { name: 'Registrar ajuste' }).click();
      await expect(med.getByTestId('current-dose')).toContainText('4 gotas');
      await abrirCaso(page);
      const dias = card.getByTestId('timeline-day');
      await expect(dias).toHaveCount(1);
      await expect(dias.first().getByTestId('note-item')).toContainText('Queixa de dor');
      const evento = dias.first().getByTestId('timeline-event');
      await expect(evento).toHaveCount(1);
      await expect(evento).toContainText(
        'Óleo Prontuário 10 mg/ml: 4 gotas · 2×/dia (08:00, 20:00) — dor persistente',
      );

      // 3. editar
      await card.getByTestId('note-edit').click();
      await card
        .getByTestId('note-body')
        .fill('Queixa de dor 7/10. Conduta: subir para 4 gotas. Reavaliar em 7 dias.');
      await card.getByTestId('note-save').click();
      await expect(card.getByTestId('note-item')).toContainText('Reavaliar em 7 dias');

      // 4. ocultar: some da lista, fica no banco
      await card.getByTestId('note-hide').click();
      await card.getByTestId('note-hide-confirm').click();
      await expect(card.getByTestId('note-item')).toHaveCount(0);
      await expect(card.getByTestId('timeline-event')).toHaveCount(1); // a dose continua
      const rows = await db('clinical_notes').where({ patient_id: patient.id });
      expect(rows).toHaveLength(1);
      expect(rows[0].deleted_at).not.toBeNull();
      const audit = await db('access_audit')
        .where({ patient_id: patient.id })
        .whereIn('route', ['notes.create', 'notes.update', 'notes.delete']);
      expect(audit).toHaveLength(3);
    } finally {
      await db.destroy();
    }
  });
});
