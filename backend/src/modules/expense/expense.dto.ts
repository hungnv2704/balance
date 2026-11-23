import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { TransactionStatus } from '@pfm/shared-types';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CREATABLE_STATUSES = [
  TransactionStatus.DRAFT,
  TransactionStatus.PENDING,
  TransactionStatus.POSTED,
] as const;

export class CreateExpenseDto {
  @IsOptional()
  @IsUUID('4')
  public accountId?: string;

  @IsUUID('4')
  public categoryId!: string;

  @IsOptional()
  @IsUUID('4')
  public merchantId?: string;

  @IsOptional()
  public amountMinor?: string | number;

  @IsOptional()
  @IsString()
  public amount?: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(3)
  public currencyCode?: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_PATTERN, { message: 'transactionDate must be in YYYY-MM-DD format.' })
  public transactionDate?: string;

  @IsOptional()
  @IsIn(CREATABLE_STATUSES)
  public status?: TransactionStatus.DRAFT | TransactionStatus.PENDING | TransactionStatus.POSTED;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  public description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  public note?: string;
}

export class UpdateExpenseDto {
  @IsOptional()
  @IsUUID('4')
  public accountId?: string;

  @IsOptional()
  @IsUUID('4')
  public categoryId?: string;

  @IsOptional()
  @IsUUID('4')
  public merchantId?: string | null;

  @IsOptional()
  public amountMinor?: string | number;

  @IsOptional()
  @IsString()
  public amount?: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(3)
  public currencyCode?: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_PATTERN, { message: 'transactionDate must be in YYYY-MM-DD format.' })
  public transactionDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  public description?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  public note?: string | null;
}

export class CreateExpenseRefundDto {
  @IsOptional()
  @IsUUID('4')
  public accountId?: string;

  @IsOptional()
  public amountMinor?: string | number;

  @IsOptional()
  @IsString()
  public amount?: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(3)
  public currencyCode?: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_PATTERN, { message: 'transactionDate must be in YYYY-MM-DD format.' })
  public transactionDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  public description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  public note?: string;
}

export class CreateMerchantDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  public name!: string;
}

export class ExpenseLifecycleActionDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  public reasonCode?: string;
}
