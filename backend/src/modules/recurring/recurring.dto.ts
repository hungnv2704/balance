import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  CategoryKind,
  RECURRING_FREQUENCIES,
  RecurringFrequency,
} from '@pfm/shared-types';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class CreateRecurringRuleDto {
  @IsEnum(CategoryKind)
  public ruleKind!: CategoryKind;

  @IsOptional()
  @IsUUID('4')
  public accountId?: string;

  @IsUUID('4')
  public categoryId!: string;

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

  @IsIn(RECURRING_FREQUENCIES)
  public frequency!: RecurringFrequency;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(32767)
  public intervalCount?: number;

  @IsOptional()
  @IsString()
  @Matches(DATE_PATTERN, { message: 'nextRunDate must be in YYYY-MM-DD format.' })
  public nextRunDate?: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_PATTERN, { message: 'endDate must be in YYYY-MM-DD format.' })
  public endDate?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  public timezone?: string;

  @IsOptional()
  @IsBoolean()
  public isActive?: boolean;
}

export class UpdateRecurringRuleDto {
  @IsOptional()
  @IsUUID('4')
  public accountId?: string;

  @IsOptional()
  @IsUUID('4')
  public categoryId?: string;

  @IsOptional()
  public amountMinor?: string | number;

  @IsOptional()
  @IsString()
  public amount?: string;

  @IsOptional()
  @IsIn(RECURRING_FREQUENCIES)
  public frequency?: RecurringFrequency;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(32767)
  public intervalCount?: number;

  @IsOptional()
  @IsString()
  @Matches(DATE_PATTERN, { message: 'nextRunDate must be in YYYY-MM-DD format.' })
  public nextRunDate?: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_PATTERN, { message: 'endDate must be in YYYY-MM-DD format.' })
  public endDate?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  public timezone?: string;
}

export class RunDueRecurringDto {
  @IsOptional()
  @IsString()
  @Matches(DATE_PATTERN, { message: 'asOfDate must be in YYYY-MM-DD format.' })
  public asOfDate?: string;
}
