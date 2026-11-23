import { DbQueryClient, DbTransactionClient } from '../../database/database.types';
import { UserMfaEntity } from './mfa.types';

export const MFA_REPOSITORY = Symbol('MFA_REPOSITORY');

export interface MfaRepository {
  findByUserId(
    db: DbQueryClient,
    userId: string,
    forUpdate?: boolean,
  ): Promise<UserMfaEntity | null>;

  upsertPendingSecret(
    tx: DbTransactionClient,
    userId: string,
    totpSecretEncrypted: string,
  ): Promise<UserMfaEntity>;

  markEnabled(
    tx: DbTransactionClient,
    userId: string,
    enabledAt: Date,
  ): Promise<UserMfaEntity>;

  replaceRecoveryCodes(
    tx: DbTransactionClient,
    userId: string,
    codeHashes: ReadonlyArray<string>,
  ): Promise<void>;

  countRemainingRecoveryCodes(db: DbQueryClient, userId: string): Promise<number>;

  consumeRecoveryCode(
    tx: DbTransactionClient,
    userId: string,
    codeHash: string,
  ): Promise<boolean>;

  deleteAllForUser(tx: DbTransactionClient, userId: string): Promise<void>;
}
