import { Injectable } from '@nestjs/common';
import { DbQueryClient } from '../../database/database.types';
import { sanitizeForLog } from '../../shared-kernel/logging/redacted-logger';
import { AuditLogInput, AuditRepository } from './audit.repository';

@Injectable()
export class PgAuditRepository implements AuditRepository {
  public async record(db: DbQueryClient, input: AuditLogInput): Promise<void> {
    const redactedMetadata = sanitizeForLog(input.metadata ?? {});
    await db.query(
      `INSERT INTO audit_logs (user_id, entity_type, entity_id, action, metadata)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        input.userId,
        input.entityType,
        input.entityId,
        input.action,
        JSON.stringify(redactedMetadata),
      ],
    );
  }
}
