import { Global, Module } from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { AUTH_REPOSITORY } from './auth.repository';
import { PasswordHasherService } from './password-hasher.service';
import { PgAuthRepository } from './pg-auth.repository';
import { TokenService } from './token.service';

@Global()
@Module({
  providers: [
    PgAuthRepository,
    {
      provide: AUTH_REPOSITORY,
      useExisting: PgAuthRepository,
    },
    PasswordHasherService,
    TokenService,
    AuthGuard,
  ],
  exports: [PgAuthRepository, AUTH_REPOSITORY, PasswordHasherService, TokenService, AuthGuard],
})
export class AuthContextModule {}
