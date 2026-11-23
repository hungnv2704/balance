import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ImportEntryType } from '@pfm/shared-types';

export class ImportPreviewDto {
  @IsOptional()
  @IsUUID('4')
  public accountId?: string;

  @IsString()
  public csvContent!: string;
}

export class ImportCommitRowDto {
  @IsIn(['INCOME', 'EXPENSE'])
  public entryType!: ImportEntryType;

  @IsString()
  @MinLength(1)
  @MaxLength(32)
  public transactionDate!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  public amountMinor!: string;

  @IsUUID('4')
  public categoryId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  public description?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  public counterparty?: string | null;
}

export class ImportCommitDto {
  @IsOptional()
  @IsUUID('4')
  public accountId?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportCommitRowDto)
  public rows!: ImportCommitRowDto[];
}
