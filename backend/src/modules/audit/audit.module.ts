import { Global, Module } from '@nestjs/common';
import { AUDIT_REPOSITORY } from './audit.repository';
import { PgAuditRepository } from './pg-audit.repository';

@Global()
@Module({
  providers: [
    PgAuditRepository,
    {
      provide: AUDIT_REPOSITORY,
      useExisting: PgAuditRepository,
    },
  ],
  exports: [AUDIT_REPOSITORY],
})
export class AuditModule {}
