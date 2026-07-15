import { IsBoolean, IsOptional } from "class-validator";

export class UpdatePreferencesDto {
  @IsOptional()
  @IsBoolean()
  jobNotice?: boolean;

  @IsOptional()
  @IsBoolean()
  chatNotice?: boolean;

  @IsOptional()
  @IsBoolean()
  privacyMode?: boolean;
}
