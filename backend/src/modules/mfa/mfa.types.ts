export interface UserMfaEntity {
  readonly userId: string;
  readonly totpSecretEncrypted: string;
  readonly enabledAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface UserMfaRecoveryCodeEntity {
  readonly id: string;
  readonly userId: string;
  readonly codeHash: string;
  readonly usedAt: Date | null;
  readonly createdAt: Date;
}
