import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  AccountType,
  AuthResponseDto,
  UserProfileDto,
} from '@pfm/shared-types';
import { DATABASE_EXECUTOR, DatabaseExecutor } from '../../database/database.types';
import {
  assertValidTimezone,
  getLocalDateInTimezone,
} from '../../shared-kernel/domain/date-time';
import {
  AuthenticationException,
  DomainConflictException,
  ResourceNotFoundException,
  ValidationDomainException,
} from '../../shared-kernel/domain/domain-exceptions';
import { Money } from '../../shared-kernel/domain/money';
import { summarizeAccountBalances } from '../../shared-kernel/domain/posted-balance';
import { ACCOUNTS_REPOSITORY, AccountsRepository } from '../accounts/accounts.repository';
import { toAccountWithBalanceDto } from '../accounts/accounts.types';
import { AUDIT_REPOSITORY, AuditRepository } from '../audit/audit.repository';
import { CATEGORIES_REPOSITORY, CategoriesRepository } from '../categories/categories.repository';
import { LEDGER_REPOSITORY, LedgerRepository } from '../ledger/ledger.repository';
import { MfaService } from '../mfa/mfa.service';
import { LoginDto, RegisterDto, UpdatePreferencesDto } from './auth.dto';
import { AUTH_REPOSITORY, AuthRepository } from './auth.repository';
import { toUserProfileDto } from './auth.types';
import { PasswordHasherService } from './password-hasher.service';
import { TokenService } from './token.service';

export const DEFAULT_ACCOUNT_NAME = 'Sổ chung';

export interface AuthTokenResult {
  readonly response: AuthResponseDto;
  readonly rawRefreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DATABASE_EXECUTOR) private readonly db: DatabaseExecutor,
    @Inject(AUTH_REPOSITORY) private readonly authRepo: AuthRepository,
    @Inject(ACCOUNTS_REPOSITORY) private readonly accountsRepo: AccountsRepository,
    @Inject(CATEGORIES_REPOSITORY) private readonly categoriesRepo: CategoriesRepository,
    @Inject(LEDGER_REPOSITORY) private readonly ledgerRepo: LedgerRepository,
    @Inject(AUDIT_REPOSITORY) private readonly auditRepo: AuditRepository,
    private readonly passwordHasher: PasswordHasherService,
    private readonly tokenService: TokenService,
    @Optional() private readonly mfaService?: MfaService,
  ) {}

  public async register(dto: RegisterDto, userAgent?: string): Promise<AuthTokenResult> {
    const normalizedEmail = dto.email.trim().toLowerCase();
    const trimmedName = dto.fullName.trim();
    if (trimmedName.length === 0) {
      throw new ValidationDomainException('Full name cannot be empty.');
    }

    const baseCurrency = Money.zero(dto.baseCurrencyCode ?? 'VND').currencyCode;
    const timezone = assertValidTimezone(dto.timezone ?? 'Asia/Ho_Chi_Minh');
    const passwordHash = await this.passwordHasher.hash(dto.password);
    const openingDate = getLocalDateInTimezone(new Date(), timezone);

    const { rawToken: rawRefreshToken, tokenHash: refreshTokenHash } =
      this.tokenService.generateOpaqueRefreshToken();
    const tokenFamilyId = randomUUID();
    const userAgentHash = this.tokenService.hashUserAgent(userAgent);
    const refreshExpiresAt = this.tokenService.getRefreshExpiryDate();

    const { user, defaultAccount, session } = await this.db.withTransaction(async (tx) => {
      const existing = await this.authRepo.findUserByEmail(tx, normalizedEmail);
      if (existing) {
        throw new DomainConflictException(
          'An account with this email already exists.',
          'EMAIL_ALREADY_EXISTS',
        );
      }

      const createdUser = await this.authRepo.createUser(tx, {
        email: normalizedEmail,
        passwordHash,
        fullName: trimmedName,
        baseCurrencyCode: baseCurrency,
        timezone,
      });

      // BR-ACC-06: Atomically provision default "Sổ chung" account on user registration
      const createdAccount = await this.accountsRepo.create(tx, {
        userId: createdUser.id,
        name: DEFAULT_ACCOUNT_NAME,
        accountType: AccountType.CASH,
        currencyCode: baseCurrency,
        openingBalanceMinor: 0n,
        openingBalanceDate: openingDate,
        isDefault: true,
      });

      await this.categoriesRepo.seedDefaultCategories(tx, createdUser.id);

      const createdSession = await this.authRepo.createSession(tx, {
        userId: createdUser.id,
        tokenFamilyId,
        refreshTokenHash,
        userAgentHash,
        expiresAt: refreshExpiresAt,
      });

      await this.auditRepo.record(tx, {
        userId: createdUser.id,
        entityType: 'user',
        entityId: createdUser.id,
        action: 'USER_REGISTERED',
        metadata: { defaultAccountId: createdAccount.id },
      });

      return {
        user: createdUser,
        defaultAccount: createdAccount,
        session: createdSession,
      };
    });

    const access = this.tokenService.signAccessToken({
      id: user.id,
      sessionId: session.id,
      tokenFamilyId: session.tokenFamilyId,
      timezone: user.timezone,
      baseCurrencyCode: user.baseCurrencyCode,
    });

    const summary = summarizeAccountBalances(0n, [], defaultAccount.currencyCode);

    return {
      rawRefreshToken,
      response: {
        user: toUserProfileDto(user),
        defaultAccount: toAccountWithBalanceDto(defaultAccount, summary),
        accessToken: access.token,
        expiresInSeconds: access.expiresInSeconds,
      },
    };
  }

  public async login(dto: LoginDto, userAgent?: string): Promise<AuthTokenResult> {
    const normalizedEmail = dto.email.trim().toLowerCase();
    const user = await this.authRepo.findUserByEmail(this.db, normalizedEmail);

    if (!user) {
      await this.passwordHasher.verifyDummy(dto.password);
      throw new AuthenticationException('Invalid email or password.', 'INVALID_CREDENTIALS');
    }

    if (user.deletionScheduledAt !== null) {
      throw new AuthenticationException(
        'Account login is disabled because deletion has been scheduled.',
        'ACCOUNT_DELETION_SCHEDULED',
      );
    }

    const valid = await this.passwordHasher.verify(dto.password, user.passwordHash);
    if (!valid) {
      throw new AuthenticationException('Invalid email or password.', 'INVALID_CREDENTIALS');
    }

    if (user.mfaEnabled && (!dto.mfaCode || dto.mfaCode.trim().length === 0)) {
      throw new AuthenticationException(
        'Multi-factor authentication code is required.',
        'MFA_REQUIRED',
      );
    }

    const { rawToken: rawRefreshToken, tokenHash: refreshTokenHash } =
      this.tokenService.generateOpaqueRefreshToken();
    const tokenFamilyId = randomUUID();
    const userAgentHash = this.tokenService.hashUserAgent(userAgent);
    const refreshExpiresAt = this.tokenService.getRefreshExpiryDate();

    const session = await this.db.withTransaction(async (tx) => {
      if (user.mfaEnabled) {
        if (!this.mfaService) {
          throw new AuthenticationException(
            'Multi-factor authentication verification is unavailable.',
            'MFA_UNAVAILABLE',
          );
        }
        const mfaOutcome = await this.mfaService.verifyLoginCodeInTx(
          tx,
          user.id,
          dto.mfaCode ?? '',
        );
        if (!mfaOutcome.valid) {
          throw new AuthenticationException(
            'Invalid multi-factor authentication code.',
            'MFA_INVALID_CODE',
          );
        }
        if (mfaOutcome.method === 'RECOVERY_CODE') {
          await this.auditRepo.record(tx, {
            userId: user.id,
            entityType: 'user_mfa',
            entityId: user.id,
            action: 'MFA_RECOVERY_CODE_USED',
          });
        }
      }

      const created = await this.authRepo.createSession(tx, {
        userId: user.id,
        tokenFamilyId,
        refreshTokenHash,
        userAgentHash,
        expiresAt: refreshExpiresAt,
      });

      await this.auditRepo.record(tx, {
        userId: user.id,
        entityType: 'user_session',
        entityId: created.id,
        action: 'USER_LOGIN',
      });

      return created;
    });

    const access = this.tokenService.signAccessToken({
      id: user.id,
      sessionId: session.id,
      tokenFamilyId: session.tokenFamilyId,
      timezone: user.timezone,
      baseCurrencyCode: user.baseCurrencyCode,
    });

    return {
      rawRefreshToken,
      response: {
        user: toUserProfileDto(user),
        accessToken: access.token,
        expiresInSeconds: access.expiresInSeconds,
      },
    };
  }

  /**
   * Implements Refresh Token Rotation with Reuse Detection (docs/05 T-01):
   * Presenting an already-revoked refresh token immediately revokes the entire token_family_id
   * and commits the revocation + audit event before rejecting with 401.
   */
  public async refresh(rawRefreshToken?: string, userAgent?: string): Promise<AuthTokenResult> {
    if (!rawRefreshToken || rawRefreshToken.trim().length === 0) {
      throw new AuthenticationException('Refresh token is required.', 'MISSING_REFRESH_TOKEN');
    }

    const tokenHash = this.tokenService.hashOpaqueToken(rawRefreshToken);
    const { rawToken: newRawRefreshToken, tokenHash: newRefreshTokenHash } =
      this.tokenService.generateOpaqueRefreshToken();
    const userAgentHash = this.tokenService.hashUserAgent(userAgent);
    const newExpiresAt = this.tokenService.getRefreshExpiryDate();

    type TxOutcome =
      | { readonly kind: 'NOT_FOUND' }
      | { readonly kind: 'REUSED' }
      | { readonly kind: 'EXPIRED' }
      | { readonly kind: 'USER_LOCKED' }
      | {
          readonly kind: 'ROTATED';
          readonly user: NonNullable<Awaited<ReturnType<AuthRepository['findUserById']>>>;
          readonly session: Awaited<ReturnType<AuthRepository['createSession']>>;
        };

    const outcome: TxOutcome = await this.db.withTransaction(async (tx) => {
      const existing = await this.authRepo.findSessionByTokenHash(tx, tokenHash, true);
      if (!existing) {
        return { kind: 'NOT_FOUND' };
      }

      if (existing.revokedAt !== null) {
        // Token reuse detected -> revoke entire token family and commit before throwing 401
        await this.authRepo.revokeTokenFamily(tx, existing.tokenFamilyId);
        await this.auditRepo.record(tx, {
          userId: existing.userId,
          entityType: 'user_session',
          entityId: existing.id,
          action: 'REFRESH_TOKEN_REUSE_DETECTED',
          metadata: { tokenFamilyId: existing.tokenFamilyId },
        });
        return { kind: 'REUSED' };
      }

      if (existing.expiresAt.getTime() <= Date.now()) {
        await this.authRepo.revokeSession(tx, existing.id);
        return { kind: 'EXPIRED' };
      }

      const user = await this.authRepo.findUserById(tx, existing.userId);
      if (!user || user.deletionScheduledAt !== null) {
        await this.authRepo.revokeTokenFamily(tx, existing.tokenFamilyId);
        return { kind: 'USER_LOCKED' };
      }

      await this.authRepo.revokeSession(tx, existing.id);

      const rotated = await this.authRepo.createSession(tx, {
        userId: user.id,
        tokenFamilyId: existing.tokenFamilyId,
        refreshTokenHash: newRefreshTokenHash,
        userAgentHash,
        expiresAt: newExpiresAt,
      });

      return {
        kind: 'ROTATED',
        user,
        session: rotated,
      };
    });

    if (outcome.kind === 'NOT_FOUND') {
      throw new AuthenticationException('Invalid refresh token.', 'INVALID_REFRESH_TOKEN');
    }
    if (outcome.kind === 'REUSED') {
      throw new AuthenticationException(
        'Refresh token reuse detected. All sessions in this family have been revoked.',
        'REFRESH_TOKEN_REUSED',
      );
    }
    if (outcome.kind === 'EXPIRED') {
      throw new AuthenticationException('Refresh token has expired.', 'REFRESH_TOKEN_EXPIRED');
    }
    if (outcome.kind === 'USER_LOCKED') {
      throw new AuthenticationException('Account is unavailable.', 'ACCOUNT_UNAVAILABLE');
    }

    const access = this.tokenService.signAccessToken({
      id: outcome.user.id,
      sessionId: outcome.session.id,
      tokenFamilyId: outcome.session.tokenFamilyId,
      timezone: outcome.user.timezone,
      baseCurrencyCode: outcome.user.baseCurrencyCode,
    });

    return {
      rawRefreshToken: newRawRefreshToken,
      response: {
        user: toUserProfileDto(outcome.user),
        accessToken: access.token,
        expiresInSeconds: access.expiresInSeconds,
      },
    };
  }

  public async logout(rawRefreshToken?: string): Promise<void> {
    if (!rawRefreshToken || rawRefreshToken.trim().length === 0) {
      return;
    }
    const tokenHash = this.tokenService.hashOpaqueToken(rawRefreshToken);
    await this.authRepo.revokeSessionByTokenHash(this.db, tokenHash);
  }

  public async logoutAll(userId: string): Promise<void> {
    await this.db.withTransaction(async (tx) => {
      await this.authRepo.revokeAllUserSessions(tx, userId);
      await this.auditRepo.record(tx, {
        userId,
        entityType: 'user',
        entityId: userId,
        action: 'LOGOUT_ALL_SESSIONS',
      });
    });
  }

  public async getProfile(
    userId: string,
  ): Promise<{ user: UserProfileDto; activeAccountCount: number }> {
    const user = await this.authRepo.findUserById(this.db, userId);
    if (!user) {
      throw new ResourceNotFoundException('User');
    }
    const activeAccountCount = await this.accountsRepo.countActiveByUser(this.db, userId);
    return {
      user: toUserProfileDto(user),
      activeAccountCount,
    };
  }

  /**
   * BR-ACC-04 exception: Updating baseCurrencyCode updates the default account's
   * currencyCode ONLY if the default account has 0 recorded transactions.
   */
  public async updatePreferences(
    userId: string,
    dto: UpdatePreferencesDto,
  ): Promise<UserProfileDto> {
    const baseCurrencyCode =
      dto.baseCurrencyCode !== undefined
        ? Money.zero(dto.baseCurrencyCode).currencyCode
        : undefined;
    const timezone =
      dto.timezone !== undefined ? assertValidTimezone(dto.timezone) : undefined;

    const updated = await this.db.withTransaction(async (tx) => {
      const existing = await this.authRepo.findUserById(tx, userId);
      if (!existing) {
        throw new ResourceNotFoundException('User');
      }

      const nextUser = await this.authRepo.updateUserPreferences(tx, userId, {
        baseCurrencyCode,
        timezone,
      });

      if (baseCurrencyCode && baseCurrencyCode !== existing.baseCurrencyCode) {
        const defaultAccount = await this.accountsRepo.findDefaultActiveByUser(tx, userId);
        if (defaultAccount) {
          const txCount = await this.ledgerRepo.countTransactionsForAccount(
            tx,
            userId,
            defaultAccount.id,
          );
          if (txCount === 0) {
            await this.accountsRepo.update(tx, userId, defaultAccount.id, {
              currencyCode: baseCurrencyCode,
            });
          }
        }
      }

      return nextUser;
    });

    return toUserProfileDto(updated);
  }
}
