import { Global, Module } from '@nestjs/common';
import { Rfc9457ExceptionFilter } from './filters/rfc9457-exception.filter';
import { IdempotencyService } from './idempotency/idempotency.service';
import { IDEMPOTENCY_REPOSITORY } from './idempotency/idempotency.types';
import { PgIdempotencyRepository } from './idempotency/pg-idempotency.repository';
import { RedactedLogger } from './logging/redacted-logger';
import { RateLimitGuard } from './rate-limit/rate-limit.guard';
import { RateLimitService } from './rate-limit/rate-limit.service';

@Global()
@Module({
  providers: [
    {
      provide: RedactedLogger,
      useFactory: () => new RedactedLogger(),
    },
    Rfc9457ExceptionFilter,
    RateLimitService,
    RateLimitGuard,
    PgIdempotencyRepository,
    {
      provide: IDEMPOTENCY_REPOSITORY,
      useExisting: PgIdempotencyRepository,
    },
    IdempotencyService,
  ],
  exports: [
    RedactedLogger,
    Rfc9457ExceptionFilter,
    RateLimitService,
    RateLimitGuard,
    IDEMPOTENCY_REPOSITORY,
    IdempotencyService,
  ],
})
export class SharedKernelModule {}
