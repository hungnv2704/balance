import { IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class CreateTransferDto {
  @IsUUID('4')
  public fromAccountId!: string;

  @IsUUID('4')
  public toAccountId!: string;

  @IsOptional()
  public fromAmountMinor?: string | number;

  @IsOptional()
  @IsString()
  public fromAmount?: string;

  @IsOptional()
  public toAmountMinor?: string | number;

  @IsOptional()
  @IsString()
  public toAmount?: string;

  @IsOptional()
  @IsString()
  public exchangeRate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  public rateSource?: string;

  @IsOptional()
  public feeMinor?: string | number;

  @IsOptional()
  @IsString()
  public fee?: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_PATTERN, { message: 'transferDate must be in YYYY-MM-DD format.' })
  public transferDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  public note?: string;
}

export class TransferLifecycleActionDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  public reasonCode?: string;
}
