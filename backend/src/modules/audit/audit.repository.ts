import { DbQueryClient } from '../../database/database.types';

export const AUDIT_REPOSITORY = Symbol('AUDIT_REPOSITORY');

export interface AuditLogInput {
  readonly userId: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly action: string;
  readonly metadata?: Record<string, unknown>;
}

export interface AuditRepository {
  record(db: DbQueryClient, input: AuditLogInput): Promise<void>;
}
