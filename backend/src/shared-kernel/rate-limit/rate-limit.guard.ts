import { CanActivate, ExecutionContext, Inject, Injectable, Optional } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { APP_CONFIG, AppConfig } from '../../config/app-config';
import type { AuthenticatedRequest } from '../../modules/auth/auth.guard';
import { RateLimitExceededException } from '../domain/domain-exceptions';
import { RATE_LIMIT_POLICY_KEY, RateLimitPolicy } from './rate-limit.decorator';
import { RateLimitService } from './rate-limit.service';

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly rateLimitService: RateLimitService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Optional() private readonly reflector?: Reflector,
  ) {}

  public canActivate(context: ExecutionContext): boolean {
    const reflector = this.reflector ?? new Reflector();
    const policy = reflector.getAllAndOverride<RateLimitPolicy | undefined>(
      RATE_LIMIT_POLICY_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!policy) {
      return true;
    }

    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const response = http.getResponse<Response>();

    const { key, maxRequests, windowSeconds } = this.resolvePolicy(policy, context, request);
    const decision = this.rateLimitService.consume(key, maxRequests, windowSeconds);

    response.setHeader('X-RateLimit-Limit', String(decision.limit));
    response.setHeader('X-RateLimit-Remaining', String(decision.remaining));
    response.setHeader('X-RateLimit-Reset', String(decision.resetEpochSeconds));

    if (!decision.allowed) {
      response.setHeader('Retry-After', String(decision.retryAfterSeconds));
      throw new RateLimitExceededException(decision.retryAfterSeconds);
    }

    return true;
  }

  private resolvePolicy(
    policy: RateLimitPolicy,
    context: ExecutionContext,
    request: AuthenticatedRequest,
  ): { key: string; maxRequests: number; windowSeconds: number } {
    const clientIp = this.extractClientIp(request);

    if (policy === 'auth') {
      const handlerName = context.getHandler().name || 'unknown';
      return {
        key: `auth:${handlerName}:ip:${clientIp}`,
        maxRequests: this.config.rateLimitAuthMax,
        windowSeconds: this.config.rateLimitAuthWindowSeconds,
      };
    }

    const actorKey = request.user?.id ? `user:${request.user.id}` : `ip:${clientIp}`;
    return {
      key: `${policy}:${actorKey}`,
      maxRequests: this.config.rateLimitExportMax,
      windowSeconds: this.config.rateLimitExportWindowSeconds,
    };
  }

  private extractClientIp(request: Request): string {
    return request.ip || request.socket?.remoteAddress || 'unknown';
  }
}
