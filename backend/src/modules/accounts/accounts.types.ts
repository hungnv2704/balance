import {
  AccountDto,
  AccountType,
  AccountWithBalanceDto,
  SupportedCurrencyCode,
} from '@pfm/shared-types';
import { AccountBalanceSummary } from '../../shared-kernel/domain/posted-balance';

export interface AccountEntity {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly accountType: AccountType;
  readonly currencyCode: SupportedCurrencyCode;
  readonly openingBalanceMinor: bigint;
  readonly openingBalanceDate: string;
  readonly isDefault: boolean;
  readonly archivedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export function toAccountDto(entity: AccountEntity): AccountDto {
  return {
    id: entity.id,
    name: entity.name,
    accountType: entity.accountType,
    currencyCode: entity.currencyCode,
    openingBalanceMinor: entity.openingBalanceMinor.toString(),
    openingBalanceDate: entity.openingBalanceDate,
    isDefault: entity.isDefault,
    archivedAt: entity.archivedAt ? entity.archivedAt.toISOString() : null,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

export function toAccountWithBalanceDto(
  entity: AccountEntity,
  summary: AccountBalanceSummary,
): AccountWithBalanceDto {
  return {
    ...toAccountDto(entity),
    postedBalanceMinor: summary.postedBalanceMinor.toString(),
    pendingInMinor: summary.pendingInMinor.toString(),
    pendingOutMinor: summary.pendingOutMinor.toString(),
    transactionCount: summary.totalTransactionCount,
  };
}
