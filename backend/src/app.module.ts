import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { AccountsModule } from './modules/accounts/accounts.module';
import { AttachmentsModule } from './modules/attachments/attachments.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthContextModule } from './modules/auth/auth-context.module';
import { AuthModule } from './modules/auth/auth.module';
import { BudgetsModule } from './modules/budgets/budgets.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { DataOpsModule } from './modules/data-ops/data-ops.module';
import { ExpenseModule } from './modules/expense/expense.module';
import { HealthController } from './modules/health/health.controller';
import { ImportsModule } from './modules/imports/imports.module';
import { IncomeModule } from './modules/income/income.module';
import { LedgerModule } from './modules/ledger/ledger.module';
import { MfaModule } from './modules/mfa/mfa.module';
import { RecurringModule } from './modules/recurring/recurring.module';
import { ReportingModule } from './modules/reporting/reporting.module';
import { TransfersModule } from './modules/transfers/transfers.module';
import { SharedKernelModule } from './shared-kernel/shared-kernel.module';

@Module({
  imports: [
    DatabaseModule,
    SharedKernelModule,
    AuthContextModule,
    AuditModule,
    LedgerModule,
    CategoriesModule,
    AccountsModule,
    MfaModule,
    AuthModule,
    IncomeModule,
    ExpenseModule,
    TransfersModule,
    ReportingModule,
    BudgetsModule,
    RecurringModule,
    DataOpsModule,
    ImportsModule,
    AttachmentsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
