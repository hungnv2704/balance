import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { CategoriesModule } from '../categories/categories.module';
import { LedgerModule } from '../ledger/ledger.module';
import { PgTransfersRepository } from './pg-transfers.repository';
import { TransfersController } from './transfers.controller';
import { TRANSFERS_REPOSITORY } from './transfers.repository';
import { TransfersService } from './transfers.service';

@Module({
  imports: [AccountsModule, CategoriesModule, LedgerModule],
  controllers: [TransfersController],
  providers: [
    PgTransfersRepository,
    {
      provide: TRANSFERS_REPOSITORY,
      useExisting: PgTransfersRepository,
    },
    TransfersService,
  ],
  exports: [TRANSFERS_REPOSITORY, TransfersService],
})
export class TransfersModule {}
