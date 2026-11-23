import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { CategoriesModule } from '../categories/categories.module';
import { LedgerModule } from '../ledger/ledger.module';
import { MfaModule } from '../mfa/mfa.module';
import { AuthContextModule } from './auth-context.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [AuthContextModule, AccountsModule, CategoriesModule, LedgerModule, MfaModule],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthContextModule, AuthService],
})
export class AuthModule {}
