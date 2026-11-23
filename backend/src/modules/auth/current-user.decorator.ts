import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticationException } from '../../shared-kernel/domain/domain-exceptions';
import { AuthenticatedRequest } from './auth.guard';
import { AuthenticatedUser } from './auth.types';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user) {
      throw new AuthenticationException('Authenticated user context is missing.');
    }
    return request.user;
  },
);
