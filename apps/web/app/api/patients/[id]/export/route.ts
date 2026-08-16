import { exportPatientData, buildExportZip } from '@medcheckin/core';
import { doctorRoute } from '@/lib/api';

export const dynamic = 'force-dynamic';
/** LGPD: acesso/portabilidade. Zip com manifest + json por tabela. */
export const GET = doctorRoute<{ id: string }>(async ({ db, session, params }) => {
  const data = await exportPatientData(db, session, params.id, new Date());
  const buf = await buildExportZip(data);
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="medcheckin-export-${params.id.slice(0, 8)}-${stamp}.zip"`,
      'cache-control': 'no-store',
    },
  });
});
