import { listAttachments, storeAttachment, ATTACHMENT_MAX_BYTES } from '@medcheckin/core';
import { doctorRoute, doctorUploadRoute, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const GET = doctorRoute<{ id: string }>(async ({ db, session, params }) =>
  json(await listAttachments(db, session, params.id)),
);

/** multipart/form-data com o campo `file`. Tipo e tamanho são decididos no core pelos bytes. */
export const POST = doctorUploadRoute<{ id: string }>(async ({ req, db, session, params }) => {
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > ATTACHMENT_MAX_BYTES + 64 * 1024)
    return json({ error: 'validation', message: 'Arquivo acima de 25 MB.', field: 'file' }, 413);
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File))
    return json(
      { error: 'validation', message: 'Envie o arquivo no campo "file".', field: 'file' },
      400,
    );
  const buffer = Buffer.from(await file.arrayBuffer());
  const row = await storeAttachment(
    db,
    session,
    params.id,
    { buffer, originalName: file.name, mime: file.type },
    new Date(),
  );
  return json(row, 201);
});
