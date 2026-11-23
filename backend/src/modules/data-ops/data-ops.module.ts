import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { AuthModule } from '../auth/auth.module';
import { BudgetsModule } from '../budgets/budgets.module';
import { CategoriesModule } from '../categories/categories.module';
import { ExpenseModule } from '../expense/expense.module';
import { IncomeModule } from '../income/income.module';
import { LedgerModule } from '../ledger/ledger.module';
import { TransfersModule } from '../transfers/transfers.module';
import { DataOpsController } from './data-ops.controller';
import { DataOpsService } from './data-ops.service';

@Module({
  imports: [
    AuthModule,
    AccountsModule,
    CategoriesModule,
    IncomeModule,
    ExpenseModule,
    TransfersModule,
    LedgerModule,
    BudgetsModule,
  ],
  controllers: [DataOpsController],
  providers: [DataOpsService],
  exports: [DataOpsService],
})
export class DataOpsModule {}
