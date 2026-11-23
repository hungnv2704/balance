import { IsString, MaxLength, MinLength } from 'class-validator';

export class VerifyMfaDto {
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  public code!: string;
}

export class DisableMfaDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  public password!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(32)
  public code!: string;
}
