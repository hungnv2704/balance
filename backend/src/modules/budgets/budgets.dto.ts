import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export class CreateBudgetDto {
  @IsUUID('4')
  public categoryId!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(3)
  public currencyCode!: string;

  @IsOptional()
  public limitMinor?: string | number;

  @IsOptional()
  @IsString()
  public limit?: string;

  @IsOptional()
  @IsString()
  @Matches(MONTH_PATTERN, { message: 'month must be in YYYY-MM format.' })
  public month?: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_PATTERN, { message: 'periodStart must be in YYYY-MM-DD format.' })
  public periodStart?: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_PATTERN, { message: 'periodEnd must be in YYYY-MM-DD format.' })
  public periodEnd?: string;
}

export class UpdateBudgetDto {
  @IsOptional()
  public limitMinor?: string | number;

  @IsOptional()
  @IsString()
  public limit?: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_PATTERN, { message: 'periodStart must be in YYYY-MM-DD format.' })
  public periodStart?: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_PATTERN, { message: 'periodEnd must be in YYYY-MM-DD format.' })
  public periodEnd?: string;

  @IsOptional()
  @IsBoolean()
  public archived?: boolean;
}
