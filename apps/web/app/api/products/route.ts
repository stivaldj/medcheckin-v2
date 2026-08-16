import { listProducts, createProduct } from '@medcheckin/core';
import { doctorRoute, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const GET = doctorRoute(async ({ db, session }) =>
  json(await listProducts(db, session.clinicId)),
);
export const POST = doctorRoute(async ({ db, session, body }) =>
  json(await createProduct(db, session, body as Record<string, unknown>), 201),
);
