import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { openAttachment, hideAttachment } from '@medcheckin/core';
import { doctorRoute } from '@/lib/api';

export const dynamic = 'force-dynamic';

/** Stream do arquivo, inline (o visualizador embute PDF/imagem). Tenancy e auditoria no core. */
export const GET = doctorRoute<{ id: string; attachmentId: string }>(
  async ({ db, session, params }) => {
    const { row, path } = await openAttachment(db, session, params.attachmentId, new Date());
    const stream = Readable.toWeb(createReadStream(path)) as ReadableStream;
    const safeName = row.original_name.replace(/["\r\n]/g, '_');
    return new Response(stream, {
      status: 200,
      headers: {
        'content-type': row.mime,
        'content-length': String(row.size_bytes),
        'content-disposition': `inline; filename="${safeName}"`,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  },
);

export const DELETE = doctorRoute<{ id: string; attachmentId: string }>(
  async ({ db, session, params }) => {
    await hideAttachment(db, session, params.attachmentId, new Date());
    return new Response(null, { status: 204 });
  },
);
