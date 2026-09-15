import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { openAttachment, hideAttachment } from '@medcheckin/core';
import { doctorRoute, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

/**
 * Stream do arquivo, inline (o visualizador embute PDF/imagem). Tenancy e auditoria no core.
 * `anonymizePatient` apaga os arquivos do disco mas mantém a linha de `attachments`, então o
 * arquivo pode não existir mais — checa antes de montar a Response para não devolver um 200
 * com stream quebrado.
 */
export const GET = doctorRoute<{ id: string; attachmentId: string }>(
  async ({ db, session, params }) => {
    const { row, path } = await openAttachment(db, session, params.attachmentId, new Date());
    try {
      await stat(path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT')
        return json(
          { error: 'not_found', message: 'Arquivo do anexo não está mais disponível.' },
          404,
        );
      throw err;
    }
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
