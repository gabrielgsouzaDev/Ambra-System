import { getTenantContext } from './tenant-context.ts';

export interface PrismaMiddlewareParams {
  model?: string;
  action: string;
  args: {
    where?: Record<string, unknown>;
    data?: Record<string, unknown> | Array<Record<string, unknown>>;
    [key: string]: unknown;
  };
}

export type PrismaMiddlewareNext = (params: PrismaMiddlewareParams) => Promise<PrismaMiddlewareParams>;

export class SecurityException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecurityException';
  }
}

const DEFAULT_TENANT_MODELS = new Set([
  'Canteen',
  'User',
  'Student',
  'Guardian',
  'UserConsent',
  'Category',
  'Product',
  'InventoryItem',
  'InventoryMove',
  'Wallet',
  'WalletTransaction',
  'Order',
  'OrderItem',
  'OrderStatusHistory',
  'PaymentRequest',
  'AuditLog',
]);

const UNIQUE_ACTIONS = new Set(['findUnique', 'findUniqueOrThrow', 'update', 'delete', 'upsert']);
const WHERE_ACTIONS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'updateMany',
  'deleteMany',
]);

export function createTenantPrismaMiddleware(tenantModels = DEFAULT_TENANT_MODELS) {
  return async function tenantPrismaMiddleware(
    params: PrismaMiddlewareParams,
    next: PrismaMiddlewareNext,
  ): Promise<PrismaMiddlewareParams> {
    if (!params.model || !tenantModels.has(params.model)) {
      return next(params);
    }

    const tenantContext = getTenantContext();
    if (!tenantContext) {
      throw new SecurityException(`Query on ${params.model} without tenant context`);
    }

    if (UNIQUE_ACTIONS.has(params.action)) {
      throw new SecurityException(
        `${params.action} is not allowed for tenant-scoped model ${params.model}; use a tenant-aware filter instead`,
      );
    }

    const nextParams = cloneParams(params);

    if (params.action === 'create') {
      nextParams.args.data = injectSchoolId(nextParams.args.data, tenantContext.schoolId);
    }

    if (params.action === 'createMany') {
      nextParams.args.data = injectSchoolId(nextParams.args.data, tenantContext.schoolId);
    }

    if (WHERE_ACTIONS.has(params.action)) {
      nextParams.args.where = {
        ...(nextParams.args.where ?? {}),
        schoolId: tenantContext.schoolId,
      };
    }

    return next(nextParams);
  };
}

function cloneParams(params: PrismaMiddlewareParams): PrismaMiddlewareParams {
  return {
    ...params,
    args: {
      ...params.args,
      where: params.args.where ? { ...params.args.where } : undefined,
      data: Array.isArray(params.args.data)
        ? params.args.data.map((item) => ({ ...item }))
        : params.args.data
          ? { ...params.args.data }
          : undefined,
    },
  };
}

function injectSchoolId(
  data: Record<string, unknown> | Array<Record<string, unknown>> | undefined,
  schoolId: string,
): Record<string, unknown> | Array<Record<string, unknown>> {
  if (Array.isArray(data)) {
    return data.map((item) => ({ ...item, schoolId }));
  }

  return { ...(data ?? {}), schoolId };
}
