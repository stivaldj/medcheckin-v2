import { redirect } from 'next/navigation';
import { currentUserSession, currentRespondentSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** Raiz: médica logada → /hoje; respondente logado → /p/hoje; senão → /login. */
export default async function Home() {
  if (await currentUserSession()) redirect('/hoje');
  if (await currentRespondentSession()) redirect('/p/hoje');
  redirect('/login');
}
