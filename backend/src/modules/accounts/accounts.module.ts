import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { AccountsController } from './accounts.controller';
import { ACCOUNTS_REPOSITORY } from './accounts.repository';
import { AccountsService } from './accounts.service';
import { DefaultAccountResolver } from './default-account.resolver';
import { PgAccountsRepository } from './pg-accounts.repository';

@Module({
  imports: [LedgerModule],
  controllers: [AccountsController],
  providers: [
    PgAccountsRepository,
    {
      provide: ACCOUNTS_REPOSITORY,
      useExisting: PgAccountsRepository,
    },
    DefaultAccountResolver,
    AccountsService,
  ],
  exports: [ACCOUNTS_REPOSITORY, DefaultAccountResolver, AccountsService],
})
export class AccountsModule {}
