import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { CategoriesModule } from '../categories/categories.module';
import { LedgerModule } from '../ledger/ledger.module';
import { INCOME_SOURCES_REPOSITORY } from './income-sources.repository';
import { IncomeController } from './income.controller';
import { IncomeService } from './income.service';
import { PgIncomeSourcesRepository } from './pg-income-sources.repository';

@Module({
  imports: [AccountsModule, CategoriesModule, LedgerModule],
  controllers: [IncomeController],
  providers: [
    PgIncomeSourcesRepository,
    {
      provide: INCOME_SOURCES_REPOSITORY,
      useExisting: PgIncomeSourcesRepository,
    },
    IncomeService,
  ],
  exports: [IncomeService, INCOME_SOURCES_REPOSITORY],
})
export class IncomeModule {}
