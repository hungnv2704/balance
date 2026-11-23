import { IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { CategoryKind } from '@pfm/shared-types';

export class CreateCategoryDto {
  @IsEnum(CategoryKind)
  public kind!: CategoryKind;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  public name!: string;

  @IsOptional()
  @IsUUID('4')
  public parentId?: string;
}

export class UpdateCategoryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  public name!: string;
}
