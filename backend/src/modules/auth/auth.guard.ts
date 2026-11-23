import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { DATABASE_EXECUTOR, DatabaseExecutor } from '../../database/database.types';
import { AuthenticationException } from '../../shared-kernel/domain/domain-exceptions';
import { AUTH_REPOSITORY, AuthRepository } from './auth.repository';
import { AuthenticatedUser } from './auth.types';
import { ACCESS_TOKEN_COOKIE, TokenService } from './token.service';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly tokenService: TokenService,
    @Inject(DATABASE_EXECUTOR) private readonly db: DatabaseExecutor,
    @Inject(AUTH_REPOSITORY) private readonly authRepo: AuthRepository,
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractToken(request);

    if (!token) {
      throw new AuthenticationException('Missing authentication credentials.');
    }

    // Never trust client-provided user_id headers/body; derive exclusively from verified token
    const verified = this.tokenService.verifyAccessToken(token);
    if (!UUID_REGEX.test(verified.id) || !UUID_REGEX.test(verified.sessionId)) {
      throw new AuthenticationException('Invalid access token claims.');
    }

    // Enforce immediate access-token revocation & account deletion lock via active session check
    const activeSession = await this.authRepo.findActiveSessionForAuth(
      this.db,
      verified.sessionId,
      verified.id,
    );

    if (!activeSession || activeSession.tokenFamilyId !== verified.tokenFamilyId) {
      throw new AuthenticationException('Session is invalid, expired, or has been revoked.');
    }

    request.user = {
      id: activeSession.userId,
      sessionId: activeSession.sessionId,
      tokenFamilyId: activeSession.tokenFamilyId,
      timezone: activeSession.timezone,
      baseCurrencyCode: activeSession.baseCurrencyCode,
    };
    return true;
  }

  private extractToken(request: Request): string | undefined {
    const cookies = request.cookies as Record<string, string | undefined> | undefined;
    if (cookies && typeof cookies[ACCESS_TOKEN_COOKIE] === 'string' && cookies[ACCESS_TOKEN_COOKIE]) {
      return cookies[ACCESS_TOKEN_COOKIE];
    }

    const authHeader = request.headers.authorization;
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice('Bearer '.length).trim();
      return token.length > 0 ? token : undefined;
    }

    return undefined;
  }
}
