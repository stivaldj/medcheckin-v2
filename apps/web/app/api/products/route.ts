import { listProducts, findOrCreateProduct } from '@medcheckin/core';
import { doctorRoute, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const GET = doctorRoute(async ({ db, session }) =>
  json(await listProducts(db, session.clinicId)),
);
export const POST = doctorRoute(async ({ db, session, body }) => {
  const { product, created } = await findOrCreateProduct(
    db,
    session,
    body as { name: string; form?: string; cbd_mg_ml?: number | null; thc_mg_ml?: number | null },
  );
  return json(product, created ? 201 : 200);
});
