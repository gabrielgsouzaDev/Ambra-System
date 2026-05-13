import assert from 'node:assert/strict';
import test from 'node:test';

import { runWithTenantContext } from './tenant-context.ts';
import {
  SecurityException,
  createTenantPrismaMiddleware,
  type PrismaMiddlewareParams,
} from './tenant-prisma-middleware.ts';

const SCHOOL_ID = 'school-a';

async function executeMiddleware(params: PrismaMiddlewareParams): Promise<PrismaMiddlewareParams> {
  const middleware = createTenantPrismaMiddleware();

  return middleware(params, async (nextParams) => nextParams);
}

test('tenant middleware blocks tenant table access without tenant context', async () => {
  await assert.rejects(
    () => executeMiddleware({ model: 'Order', action: 'findMany', args: { where: {} } }),
    SecurityException,
  );
});

test('tenant middleware injects schoolId on create inside tenant context', async () => {
  const result = await runWithTenantContext(
    { schoolId: SCHOOL_ID, userId: 'user-1', role: 'SCHOOL_ADMIN' },
    () => executeMiddleware({ model: 'Product', action: 'create', args: { data: { name: 'Suco' } } }),
  );

  assert.deepEqual(result.args.data, { name: 'Suco', schoolId: SCHOOL_ID });
});

test('tenant middleware filters findMany by schoolId inside tenant context', async () => {
  const result = await runWithTenantContext(
    { schoolId: SCHOOL_ID, userId: 'user-1', role: 'SCHOOL_ADMIN' },
    () => executeMiddleware({ model: 'Order', action: 'findMany', args: { where: { status: 'CONFIRMED' } } }),
  );

  assert.deepEqual(result.args.where, { status: 'CONFIRMED', schoolId: SCHOOL_ID });
});

test('tenant middleware rejects findUnique for tenant tables', async () => {
  await assert.rejects(
    () =>
      runWithTenantContext(
        { schoolId: SCHOOL_ID, userId: 'user-1', role: 'SCHOOL_ADMIN' },
        () => executeMiddleware({ model: 'Order', action: 'findUnique', args: { where: { id: 'order-1' } } }),
      ),
    /findUnique is not allowed for tenant-scoped model Order/,
  );
});
