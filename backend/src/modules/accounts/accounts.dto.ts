import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { AccountType } from '@pfm/shared-types';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class CreateAccountDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  public name!: string;

  @IsEnum(AccountType)
  public accountType!: AccountType;

  @IsString()
  @MinLength(3)
  @MaxLength(3)
  public currencyCode!: string;

  @IsOptional()
  public openingBalanceMinor?: string | number;

  @IsOptional()
  @IsString()
  public openingBalance?: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_PATTERN, { message: 'openingBalanceDate must be in YYYY-MM-DD format.' })
  public openingBalanceDate?: string;

  @IsOptional()
  @IsBoolean()
  public isDefault?: boolean;
}

export class UpdateAccountDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  public name?: string;

  @IsOptional()
  @IsEnum(AccountType)
  public accountType?: AccountType;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(3)
  public currencyCode?: string;

  @IsOptional()
  @IsBoolean()
  public isDefault?: boolean;
}

export class ArchiveAccountDto {
  @IsOptional()
  @IsUUID('4')
  public replacementDefaultAccountId?: string;
}

export class CreateBalanceAdjustmentDto {
  @IsOptional()
  public actualBalanceMinor?: string | number;

  @IsOptional()
  @IsString()
  public actualBalance?: string;

  @IsOptional()
  @IsEnum(['CREDIT', 'DEBIT'] as const)
  public direction?: 'CREDIT' | 'DEBIT';

  @IsOptional()
  public amountMinor?: string | number;

  @IsOptional()
  @IsString()
  public amount?: string;

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
  @MaxLength(1000)
  public note?: string;
}
