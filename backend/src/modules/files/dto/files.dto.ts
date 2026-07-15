import { IsInt, IsString, Matches, Max, MaxLength, Min } from "class-validator";

export class CreateUploadUrlDto {
  @IsString()
  @MaxLength(160)
  @Matches(/^[^/\\]+$/)
  fileName: string;

  @IsString()
  @Matches(/^(image\/(jpeg|png|webp)|application\/pdf)$/)
  contentType: string;

  @IsInt()
  @Min(1)
  @Max(10 * 1024 * 1024)
  size: number;
}
