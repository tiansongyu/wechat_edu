import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, IsUrl, Matches, Max, MaxLength, Min } from "class-validator";

export class UpdateTeacherProfileDto {
  @IsOptional() @IsString() @MaxLength(64) realName?: string;
  @IsOptional() @IsString() @MaxLength(2000) bio?: string;
  @IsOptional() @IsString() @MaxLength(128) school?: string;
  @IsOptional() @IsString() @MaxLength(128) major?: string;
  @IsOptional() @IsString() @MaxLength(64) education?: string;
  @IsOptional() @IsInt() @Min(0) @Max(60) teachingYears?: number;
  @IsOptional() @IsInt() @Min(0) @Max(1000000) hourlyRateCents?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) subjects?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) serviceDistricts?: string[];
  @IsInt() @Min(1) version: number;
}

export class UpdateParentProfileDto {
  @IsOptional() @IsString() @MaxLength(64) city?: string;
  @IsOptional() @IsString() @MaxLength(64) district?: string;
  @IsOptional() @IsString() @MaxLength(255) address?: string;
}

export class AddCertificationDto {
  @IsString() @MaxLength(64) type: string;
  @IsOptional() @IsUrl({ require_tld: false }) @MaxLength(500) fileUrl?: string;
  @IsOptional() @IsString() @MaxLength(500) @Matches(/^private\/[a-zA-Z0-9-]+\/.+/) objectKey?: string;
}
