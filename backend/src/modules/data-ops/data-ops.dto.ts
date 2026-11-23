import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ExportFormat } from '@pfm/shared-types';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class CreateExportDto {
  @IsIn(['CSV', 'JSON'])
  public format!: ExportFormat;

  @IsOptional()
  @IsString()
  @Matches(DATE_PATTERN, { message: 'fromDate must be in YYYY-MM-DD format.' })
  public fromDate?: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_PATTERN, { message: 'toDate must be in YYYY-MM-DD format.' })
  public toDate?: string;

  @IsOptional()
  @IsUUID('4')
  public accountId?: string;

  @IsOptional()
  @IsBoolean()
  public includeArchived?: boolean;
}

export class ScheduleAccountDeletionDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  public password?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  public currentPassword?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  public reason?: string;
}
