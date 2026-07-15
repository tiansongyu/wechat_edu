import { IsInt, IsString, Matches, Max, MaxLength, Min } from "class-validator";

export const CERTIFICATION_CONTENT_TYPES = ["image/jpeg", "image/png", "application/pdf"] as const;

export class CreateUploadUrlDto {
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
