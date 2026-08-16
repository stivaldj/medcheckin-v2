import type { BrowserContext } from '@playwright/test';
import { createDb, createSession } from '@medcheckin/core';

/** Sessão da médica criada direto no core (sem backdoor de dev) e injetada como cookie. */
export async function loginAsDoctor(context: BrowserContext, baseURL: string) {
  const db = createDb(process.env.DATABASE_URL_TEST || process.env.DATABASE_URL!);
  try {
    const user = await db('users').where({ email: 'medica@medcheckin.test' }).first();
    const { sessionToken } = await createSession(
      db,
      { userId: user.id, clinicId: user.clinic_id },
      new Date(),
    );
    const url = new URL(baseURL);
    await context.addCookies([
      {
        name: 'mc_user',
        value: sessionToken,
        domain: url.hostname,
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
  } finally {
    await db.destroy();
  }
}
