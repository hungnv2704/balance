import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { CategoriesModule } from '../categories/categories.module';
import { LedgerModule } from '../ledger/ledger.module';
import { PgRecurringRepository } from './pg-recurring.repository';
import { RecurringController } from './recurring.controller';
import { RECURRING_REPOSITORY } from './recurring.repository';
import { RecurringService } from './recurring.service';

@Module({
  imports: [AccountsModule, CategoriesModule, LedgerModule],
  controllers: [RecurringController],
  providers: [
    PgRecurringRepository,
    {
      provide: RECURRING_REPOSITORY,
      useExisting: PgRecurringRepository,
    },
    RecurringService,
  ],
  exports: [RECURRING_REPOSITORY, RecurringService],
})
export class RecurringModule {}
