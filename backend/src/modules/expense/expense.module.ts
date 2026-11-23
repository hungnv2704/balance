import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { CategoriesModule } from '../categories/categories.module';
import { LedgerModule } from '../ledger/ledger.module';
import { ExpenseController } from './expense.controller';
import { ExpenseService } from './expense.service';
import { MERCHANTS_REPOSITORY } from './merchants.repository';
import { PgMerchantsRepository } from './pg-merchants.repository';

@Module({
  imports: [AccountsModule, CategoriesModule, LedgerModule],
  controllers: [ExpenseController],
  providers: [
    PgMerchantsRepository,
    {
      provide: MERCHANTS_REPOSITORY,
      useExisting: PgMerchantsRepository,
    },
    ExpenseService,
  ],
  exports: [ExpenseService, MERCHANTS_REPOSITORY],
})
export class ExpenseModule {}
