import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { SupportedCurrencyCode } from '@pfm/shared-types';
import { APP_CONFIG, AppConfig } from '../../config/app-config';
import { AuthenticationException } from '../../shared-kernel/domain/domain-exceptions';
import { AuthenticatedUser } from './auth.types';

export const ACCESS_TOKEN_COOKIE = 'pfm_access_token';
export const REFRESH_TOKEN_COOKIE = 'pfm_refresh_token';

interface AccessTokenClaims {
  sub: string;
  sid: string;
  tfid: string;
  tz: string;
  bc: SupportedCurrencyCode;
}

@Injectable()
export class TokenService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  public signAccessToken(user: AuthenticatedUser): { token: string; expiresInSeconds: number } {
    const claims: AccessTokenClaims = {
      sub: user.id,
      sid: user.sessionId,
      tfid: user.tokenFamilyId,
      tz: user.timezone,
      bc: user.baseCurrencyCode,
    };

    const token = jwt.sign(claims, this.config.jwtAccessSecret, {
      expiresIn: this.config.jwtAccessTtlSeconds,
      algorithm: 'HS256',
      jwtid: randomUUID(),
    });

    return {
      token,
      expiresInSeconds: this.config.jwtAccessTtlSeconds,
    };
  }

  public verifyAccessToken(token: string): AuthenticatedUser {
    try {
      const decoded = jwt.verify(token, this.config.jwtAccessSecret, {
        algorithms: ['HS256'],
      }) as AccessTokenClaims;

      if (
        !decoded ||
        typeof decoded.sub !== 'string' ||
        decoded.sub.length === 0 ||
        typeof decoded.sid !== 'string' ||
        decoded.sid.length === 0 ||
        typeof decoded.tfid !== 'string' ||
        decoded.tfid.length === 0
      ) {
        throw new AuthenticationException('Invalid access token claims.');
      }

      return {
        id: decoded.sub,
        sessionId: decoded.sid,
        tokenFamilyId: decoded.tfid,
        timezone: decoded.tz,
        baseCurrencyCode: decoded.bc,
      };
    } catch (error) {
      if (error instanceof AuthenticationException) {
        throw error;
      }
      throw new AuthenticationException('Access token is invalid or expired.');
    }
  }

  public generateOpaqueRefreshToken(): { rawToken: string; tokenHash: string } {
    const rawToken = randomBytes(48).toString('base64url');
    const tokenHash = this.hashOpaqueToken(rawToken);
    return { rawToken, tokenHash };
  }

  public hashOpaqueToken(rawToken: string): string {
    return createHash('sha256').update(rawToken, 'utf8').digest('hex');
  }

  public hashUserAgent(userAgent: string | undefined): string | null {
    if (!userAgent || userAgent.trim().length === 0) {
      return null;
    }
    return createHash('sha256').update(userAgent.trim(), 'utf8').digest('hex');
  }

  public getRefreshExpiryDate(): Date {
    return new Date(Date.now() + this.config.refreshTokenTtlDays * 24 * 60 * 60 * 1000);
  }
}
