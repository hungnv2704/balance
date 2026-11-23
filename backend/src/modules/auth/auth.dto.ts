import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @IsEmail()
  @MaxLength(255)
  public email!: string;

  @IsString()
  @MinLength(12, { message: 'Password must be at least 12 characters long.' })
  @MaxLength(128)
  public password!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  public fullName!: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(3)
  public baseCurrencyCode?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  public timezone?: string;
}

export class LoginDto {
  @IsEmail()
  @MaxLength(255)
  public email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  public password!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  public mfaCode?: string;
}

export class RefreshTokenDto {
  @IsOptional()
  @IsString()
  @MinLength(16)
  @MaxLength(512)
  public refreshToken?: string;
}

export class UpdatePreferencesDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(3)
  public baseCurrencyCode?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  public timezone?: string;
}
