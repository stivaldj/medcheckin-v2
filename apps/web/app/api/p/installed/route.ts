import { markInstalled } from '@medcheckin/core';
import { respondentRoute, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

/** E9.3: o app abriu em modo instalado (tela inicial). Guarda a primeira vez. */
export const POST = respondentRoute(async ({ db, session }) =>
  json(await markInstalled(db, session, new Date())),
);
