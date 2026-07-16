import { IsEnum, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from "class-validator";

export const CERTIFICATION_CONTENT_TYPES = ["image/jpeg", "image/png", "application/pdf"] as const;
export const AVATAR_CONTENT_TYPES = ["image/jpeg", "image/png"] as const;

export enum UploadPurpose {
  CERTIFICATION = "CERTIFICATION",
  AVATAR = "AVATAR"
}

export class CreateUploadUrlDto {
  @IsOptional()
  @IsEnum(UploadPurpose)
  purpose: UploadPurpose = UploadPurpose.CERTIFICATION;

  @IsString()
  @MaxLength(160)
  @Matches(/^[^/\\]+$/)
  fileName: string;

  @IsString()
  @Matches(/^(image\/(jpeg|png)|application\/pdf)$/)
  contentType: string;

  @IsInt()
  @Min(1)
  @Max(10 * 1024 * 1024)
  size: number;
}
