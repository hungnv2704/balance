import { Module } from '@nestjs/common';
import { CategoriesModule } from '../categories/categories.module';
import { LedgerModule } from '../ledger/ledger.module';
import { BudgetsController } from './budgets.controller';
import { BUDGETS_REPOSITORY } from './budgets.repository';
import { BudgetsService } from './budgets.service';
import { PgBudgetsRepository } from './pg-budgets.repository';

@Module({
  imports: [CategoriesModule, LedgerModule],
  controllers: [BudgetsController],
  providers: [
    PgBudgetsRepository,
    {
      provide: BUDGETS_REPOSITORY,
      useExisting: PgBudgetsRepository,
    },
    BudgetsService,
  ],
  exports: [BUDGETS_REPOSITORY, BudgetsService],
})
export class BudgetsModule {}
