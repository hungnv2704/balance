import { IsString, MaxLength, MinLength } from 'class-validator';

export class UploadAttachmentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  public filename!: string;

  @IsString()
  public contentBase64!: string;
}
