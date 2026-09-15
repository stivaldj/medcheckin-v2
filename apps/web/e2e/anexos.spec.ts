import { test, expect } from '@playwright/test';
import { createDb, createPatient, type Session } from '@medcheckin/core';
import { loginAsDoctor } from './helpers';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n');

/** E12.2 / D38 — anexar PDF, ver na lista, abrir o visualizador, ocultar. */
test.describe('anexos', () => {
  test('anexar → listar → abrir → ocultar', async ({ page, context, baseURL }) => {
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
          name: 'Paciente Anexo E2E',
          respondents: [{ kind: 'caregiver', name: 'C', email: 'anexo@x.test' }],
          consent_version: 'v1',
        },
        new Date(),
      );
      await page.goto(`/pacientes/${patient.id}`);
      const card = page.getByTestId('attachments-card');
      await expect(card).toContainText('Nenhum anexo');
      await card
        .getByTestId('attachment-upload')
        .setInputFiles({ name: 'prontuario-antigo.pdf', mimeType: 'application/pdf', buffer: PDF });
      const item = card.getByTestId('attachment-item');
      await expect(item).toHaveCount(1);
      await expect(item).toContainText('prontuario-antigo.pdf');
      await expect(item).toContainText('PDF');
      await item.getByTestId('attachment-open').click();
      await expect(card.getByTestId('attachment-viewer').locator('iframe')).toHaveAttribute(
        'src',
        /\/api\/patients\/.+\/attachments\//,
      );
      const src = await card.getByTestId('attachment-viewer').locator('iframe').getAttribute('src');
      const res = await page.request.get(src!);
      expect(res.status()).toBe(200);
      expect(res.headers()['content-type']).toContain('application/pdf');
      expect((await res.body()).subarray(0, 4).toString()).toBe('%PDF');
      // tipo errado recusado
      await card.getByTestId('attachment-upload').setInputFiles({
        name: 'falso.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('MZ nao sou pdf'),
      });
      await expect(card).toContainText('não aceito');
      await expect(item).toHaveCount(1);
      // ocultar
      await item.getByTestId('attachment-hide').click();
      await item.getByTestId('attachment-hide-confirm').click();
      await expect(card.getByTestId('attachment-item')).toHaveCount(0);
      const rows = await db('attachments').where({ patient_id: patient.id });
      expect(rows).toHaveLength(1);
      expect(rows[0].deleted_at).not.toBeNull();
      const audit = await db('access_audit')
        .where({ patient_id: patient.id })
        .whereIn('route', ['attachments.create', 'attachments.read', 'attachments.delete']);
      const routes = new Set(audit.map((a) => a.route));
      expect([...routes].sort()).toEqual([
        'attachments.create',
        'attachments.delete',
        'attachments.read',
      ]);
    } finally {
      // Banco compartilhado por toda a suíte (um único global-setup) — sem apagar este paciente
      // fixture, ele fica poluindo a lista/contagens de specs que rodam depois (mesmo problema já
      // corrigido em lista-pacientes.spec.ts). O cascade cuida de respondents/attachments; os
      // bytes em UPLOADS_DIR (pasta temporária) podem ficar, sem custo real.
      try {
        await db('patients').where({ name: 'Paciente Anexo E2E' }).del();
      } catch {
        // não deixa um erro de limpeza mascarar o resultado real do teste
      }
      await db.destroy();
    }
  });
});
