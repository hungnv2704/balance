import { SetMetadata } from '@nestjs/common';

export type RateLimitPolicy = 'auth' | 'export' | 'import';

export const RATE_LIMIT_POLICY_KEY = 'pfm:rate_limit_policy';

export const RateLimitPolicy = (policy: RateLimitPolicy): MethodDecorator =>
  SetMetadata(RATE_LIMIT_POLICY_KEY, policy);
