import { NextResponse } from 'next/server';
import { requirePatientInClinic, logAccess } from '@medcheckin/core';
import { getDb } from '@/lib/db';
import { requireUser, errorResponse } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** E3: mínimo (nome/status) com tenancy + audit. E4 amplia o payload. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(req);
    const { id } = await ctx.params;
    const db = getDb();
    const p = await requirePatientInClinic(db, session, id);
    await logAccess(
      db,
      { session, patientId: p.id, route: '/api/patients/[id]', action: 'view' },
      new Date(),
    );
    return NextResponse.json({ id: p.id, name: p.name, status: p.status, timezone: p.timezone });
  } catch (err) {
    return errorResponse(err);
  }
}
