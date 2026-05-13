import { AsyncLocalStorage } from 'node:async_hooks';

export type UserRole = 'SCHOOL_ADMIN' | 'CANTEEN_OP' | 'GUARDIAN' | 'STUDENT';

export interface TenantContext {
  schoolId: string;
  userId: string;
  role: UserRole;
}

const tenantStorage = new AsyncLocalStorage<TenantContext>();

export function runWithTenantContext<T>(context: TenantContext, callback: () => T): T {
  return tenantStorage.run(context, callback);
}

export function getTenantContext(): TenantContext | undefined {
  return tenantStorage.getStore();
}
