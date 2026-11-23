import { Inject, Injectable } from '@nestjs/common';
import {
  MfaDisableResponseDto,
  MfaSetupResponseDto,
  MfaStatusDto,
  MfaVerifyResponseDto,
} from '@pfm/shared-types';
import { APP_CONFIG, AppConfig } from '../../config/app-config';
import {
  DATABASE_EXECUTOR,
  DatabaseExecutor,
  DbTransactionClient,
} from '../../database/database.types';
import {
  AuthenticationException,
  DomainConflictException,
  ResourceNotFoundException,
  ValidationDomainException,
} from '../../shared-kernel/domain/domain-exceptions';
import { AUDIT_REPOSITORY, AuditRepository } from '../audit/audit.repository';
import { AUTH_REPOSITORY, AuthRepository } from '../auth/auth.repository';
import { PasswordHasherService } from '../auth/password-hasher.service';
import { MFA_REPOSITORY, MfaRepository } from './mfa.repository';
import { UserMfaEntity } from './mfa.types';
import {
  buildOtpauthUri,
  decryptTotpSecret,
  encryptTotpSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  normalizeRecoveryCode,
  RECOVERY_CODE_COUNT,
  verifyTotpCode,
} from './totp.crypto';

export interface MfaVerificationOutcome {
  readonly valid: boolean;
  readonly method: 'TOTP' | 'RECOVERY_CODE' | null;
}

@Injectable()
export class MfaService {
  constructor(
    @Inject(DATABASE_EXECUTOR) private readonly db: DatabaseExecutor,
    @Inject(AUTH_REPOSITORY) private readonly authRepo: AuthRepository,
    @Inject(MFA_REPOSITORY) private readonly mfaRepo: MfaRepository,
    @Inject(AUDIT_REPOSITORY) private readonly auditRepo: AuditRepository,
    private readonly passwordHasher: PasswordHasherService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  public async getStatus(userId: string): Promise<MfaStatusDto> {
    const user = await this.authRepo.findUserById(this.db, userId);
    if (!user) {
      throw new ResourceNotFoundException('User');
    }

    const mfa = await this.mfaRepo.findByUserId(this.db, userId);
    if (!user.mfaEnabled || !mfa || mfa.enabledAt === null) {
      return {
        enabled: false,
        enabledAt: null,
        remainingRecoveryCodes: 0,
      };
    }

    const remainingRecoveryCodes = await this.mfaRepo.countRemainingRecoveryCodes(this.db, userId);
    return {
      enabled: true,
      enabledAt: mfa.enabledAt.toISOString(),
      remainingRecoveryCodes,
    };
  }

  public async setup(userId: string): Promise<MfaSetupResponseDto> {
    return this.db.withTransaction(async (tx) => {
      const user = await this.authRepo.findUserById(tx, userId);
      if (!user) {
        throw new ResourceNotFoundException('User');
      }

      const existing = await this.mfaRepo.findByUserId(tx, userId, true);
      if (user.mfaEnabled || existing?.enabledAt !== null && existing?.enabledAt !== undefined) {
        throw new DomainConflictException(
          'MFA is already enabled for this account. Disable MFA before reconfiguring.',
          'MFA_ALREADY_ENABLED',
        );
      }

      const { raw, base32 } = generateTotpSecret();
      const encrypted = encryptTotpSecret(raw, userId, this.getMasterKey());
      await this.mfaRepo.upsertPendingSecret(tx, userId, encrypted);

      return {
        secretBase32: base32,
        otpauthUri: buildOtpauthUri(user.email, base32),
      };
    });
  }

  public async verifyAndEnable(userId: string, code: string): Promise<MfaVerifyResponseDto> {
    return this.db.withTransaction(async (tx) => {
      const user = await this.authRepo.findUserById(tx, userId);
      if (!user) {
        throw new ResourceNotFoundException('User');
      }

      const mfa = await this.mfaRepo.findByUserId(tx, userId, true);
      if (user.mfaEnabled || mfa?.enabledAt !== null && mfa?.enabledAt !== undefined) {
        throw new DomainConflictException('MFA is already enabled.', 'MFA_ALREADY_ENABLED');
      }

      if (!mfa) {
        throw new ValidationDomainException(
          'MFA setup has not been initiated. Call setup first.',
          'MFA_NOT_SETUP',
        );
      }

      const secret = decryptTotpSecret(mfa.totpSecretEncrypted, userId, this.getMasterKey());
      if (!verifyTotpCode(secret, code)) {
        throw new AuthenticationException('Invalid TOTP verification code.', 'MFA_INVALID_CODE');
      }

      const recoveryPairs = generateRecoveryCodes(RECOVERY_CODE_COUNT);
      await this.mfaRepo.replaceRecoveryCodes(
        tx,
        userId,
        recoveryPairs.map((pair) => pair.codeHash),
      );

      await this.mfaRepo.markEnabled(tx, userId, new Date());
      await this.authRepo.setMfaEnabled(tx, userId, true);

      await this.auditRepo.record(tx, {
        userId,
        entityType: 'user_mfa',
        entityId: userId,
        action: 'MFA_ENABLED',
        metadata: { recoveryCodesCount: recoveryPairs.length },
      });

      return {
        enabled: true,
        recoveryCodes: recoveryPairs.map((pair) => pair.displayCode),
      };
    });
  }

  public async disable(
    userId: string,
    password: string,
    code: string,
  ): Promise<MfaDisableResponseDto> {
    const user = await this.authRepo.findUserById(this.db, userId);
    if (!user) {
      throw new ResourceNotFoundException('User');
    }

    const validPassword = await this.passwordHasher.verify(password, user.passwordHash);
    if (!validPassword) {
      throw new AuthenticationException('Invalid password.', 'INVALID_CREDENTIALS');
    }

    if (!user.mfaEnabled) {
      throw new ValidationDomainException('MFA is not enabled for this account.', 'MFA_NOT_ENABLED');
    }

    return this.db.withTransaction(async (tx) => {
      const currentUser = await this.authRepo.findUserById(tx, userId);
      const mfa = await this.mfaRepo.findByUserId(tx, userId, true);
      if (!currentUser?.mfaEnabled || !mfa || mfa.enabledAt === null) {
        throw new ValidationDomainException(
          'MFA is not enabled for this account.',
          'MFA_NOT_ENABLED',
        );
      }

      const verification = await this.verifyCodeAgainstMfaRecordInTx(tx, userId, mfa, code);
      if (!verification.valid) {
        throw new AuthenticationException('Invalid MFA verification code.', 'MFA_INVALID_CODE');
      }

      await this.mfaRepo.deleteAllForUser(tx, userId);
      await this.authRepo.setMfaEnabled(tx, userId, false);

      await this.auditRepo.record(tx, {
        userId,
        entityType: 'user_mfa',
        entityId: userId,
        action: 'MFA_DISABLED',
        metadata: { verificationMethod: verification.method },
      });

      return { enabled: false };
    });
  }

  public async verifyLoginCodeInTx(
    tx: DbTransactionClient,
    userId: string,
    code: string,
  ): Promise<MfaVerificationOutcome> {
    const mfa = await this.mfaRepo.findByUserId(tx, userId, false);
    if (!mfa || mfa.enabledAt === null) {
      return { valid: false, method: null };
    }
    return this.verifyCodeAgainstMfaRecordInTx(tx, userId, mfa, code);
  }

  private async verifyCodeAgainstMfaRecordInTx(
    tx: DbTransactionClient,
    userId: string,
    mfa: UserMfaEntity,
    code: string,
  ): Promise<MfaVerificationOutcome> {
    const secret = decryptTotpSecret(mfa.totpSecretEncrypted, userId, this.getMasterKey());
    if (verifyTotpCode(secret, code)) {
      return { valid: true, method: 'TOTP' };
    }

    const normalized = normalizeRecoveryCode(code);
    if (normalized.length > 0) {
      const codeHash = hashRecoveryCode(normalized);
      const consumed = await this.mfaRepo.consumeRecoveryCode(tx, userId, codeHash);
      if (consumed) {
        return { valid: true, method: 'RECOVERY_CODE' };
      }
    }

    return { valid: false, method: null };
  }

  private getMasterKey(): string {
    return this.config.mfaEncryptionKey ?? this.config.jwtAccessSecret;
  }
}
