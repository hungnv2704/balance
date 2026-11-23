import { Module } from '@nestjs/common';
import { MfaController } from './mfa.controller';
import { MFA_REPOSITORY } from './mfa.repository';
import { MfaService } from './mfa.service';
import { PgMfaRepository } from './pg-mfa.repository';

@Module({
  controllers: [MfaController],
  providers: [
    PgMfaRepository,
    {
      provide: MFA_REPOSITORY,
      useExisting: PgMfaRepository,
    },
    MfaService,
  ],
  exports: [MFA_REPOSITORY, MfaService],
})
export class MfaModule {}
