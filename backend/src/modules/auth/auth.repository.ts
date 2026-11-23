import { SupportedCurrencyCode } from '@pfm/shared-types';
import { DbQueryClient, DbTransactionClient } from '../../database/database.types';
import { UserEntity, UserSessionEntity } from './auth.types';

export const AUTH_REPOSITORY = Symbol('AUTH_REPOSITORY');

export interface CreateUserInput {
  readonly email: string;
  readonly passwordHash: string;
  readonly fullName: string;
  readonly baseCurrencyCode: SupportedCurrencyCode;
  readonly timezone: string;
}

export interface CreateSessionInput {
  readonly userId: string;
  readonly tokenFamilyId: string;
  readonly refreshTokenHash: string;
  readonly userAgentHash: string | null;
  readonly expiresAt: Date;
}

export interface ActiveSessionAuthContext {
  readonly sessionId: string;
  readonly userId: string;
  readonly tokenFamilyId: string;
  readonly timezone: string;
  readonly baseCurrencyCode: SupportedCurrencyCode;
}

export interface AuthRepository {
  findUserByEmail(db: DbQueryClient, email: string): Promise<UserEntity | null>;

  findUserById(db: DbQueryClient, userId: string): Promise<UserEntity | null>;

  createUser(tx: DbTransactionClient, input: CreateUserInput): Promise<UserEntity>;

  updateUserPreferences(
    tx: DbTransactionClient,
    userId: string,
    updates: { baseCurrencyCode?: SupportedCurrencyCode; timezone?: string },
  ): Promise<UserEntity>;

  scheduleDeletion(
    tx: DbTransactionClient,
    userId: string,
    deletionScheduledAt: Date,
  ): Promise<UserEntity>;

  setMfaEnabled(
    tx: DbTransactionClient,
    userId: string,
    enabled: boolean,
  ): Promise<void>;

  createSession(tx: DbTransactionClient, input: CreateSessionInput): Promise<UserSessionEntity>;

  findSessionByTokenHash(
    db: DbQueryClient,
    refreshTokenHash: string,
    forUpdate?: boolean,
  ): Promise<UserSessionEntity | null>;

  findActiveSessionForAuth(
    db: DbQueryClient,
    sessionId: string,
    userId: string,
  ): Promise<ActiveSessionAuthContext | null>;

  revokeSession(tx: DbTransactionClient, sessionId: string): Promise<void>;

  revokeSessionByTokenHash(db: DbQueryClient, refreshTokenHash: string): Promise<void>;

  revokeTokenFamily(tx: DbTransactionClient, tokenFamilyId: string): Promise<void>;

  revokeAllUserSessions(tx: DbTransactionClient, userId: string): Promise<void>;
}
