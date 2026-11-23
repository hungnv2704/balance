import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { CategoriesModule } from '../categories/categories.module';
import { LedgerModule } from '../ledger/ledger.module';
import { PgReportingRepository } from './pg-reporting.repository';
import { ReportingController } from './reporting.controller';
import { REPORTING_REPOSITORY } from './reporting.repository';
import { ReportingService } from './reporting.service';

@Module({
  imports: [AccountsModule, CategoriesModule, LedgerModule],
  controllers: [ReportingController],
  providers: [
    PgReportingRepository,
    {
      provide: REPORTING_REPOSITORY,
      useExisting: PgReportingRepository,
    },
    ReportingService,
  ],
  exports: [REPORTING_REPOSITORY, ReportingService],
})
export class ReportingModule {}
