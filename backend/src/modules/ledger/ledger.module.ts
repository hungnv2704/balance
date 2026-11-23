import { Module } from '@nestjs/common';
import { LEDGER_REPOSITORY } from './ledger.repository';
import { PgLedgerRepository } from './pg-ledger.repository';

@Module({
  providers: [
    PgLedgerRepository,
    {
      provide: LEDGER_REPOSITORY,
      useExisting: PgLedgerRepository,
    },
  ],
  exports: [LEDGER_REPOSITORY],
})
export class LedgerModule {}
