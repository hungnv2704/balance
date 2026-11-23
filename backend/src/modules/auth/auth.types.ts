import { SupportedCurrencyCode, UserProfileDto } from '@pfm/shared-types';

export interface AuthenticatedUser {
  readonly id: string;
  readonly sessionId: string;
  readonly tokenFamilyId: string;
  readonly timezone: string;
  readonly baseCurrencyCode: SupportedCurrencyCode;
}

export interface UserEntity {
  readonly id: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly fullName: string;
  readonly baseCurrencyCode: SupportedCurrencyCode;
  readonly timezone: string;
  readonly mfaEnabled: boolean;
  readonly deletionScheduledAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface UserSessionEntity {
  readonly id: string;
  readonly userId: string;
  readonly tokenFamilyId: string;
  readonly refreshTokenHash: string;
  readonly userAgentHash: string | null;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly createdAt: Date;
}

export function toUserProfileDto(user: UserEntity): UserProfileDto {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    baseCurrencyCode: user.baseCurrencyCode,
    timezone: user.timezone,
    mfaEnabled: user.mfaEnabled,
    createdAt: user.createdAt.toISOString(),
  };
}
