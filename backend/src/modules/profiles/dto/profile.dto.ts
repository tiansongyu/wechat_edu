import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsInt, IsLatitude, IsLongitude, IsOptional, IsString, IsUrl, Matches, Max, MaxLength, Min, ValidateNested } from "class-validator";

export class ServiceAreaDto {
  @IsString() @MaxLength(64) province: string;
  @IsString() @MaxLength(64) city: string;
  @IsString() @MaxLength(64) district: string;
}

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
  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => ServiceAreaDto) serviceAreas?: ServiceAreaDto[];
  @IsOptional() @IsString() @MaxLength(120) displayTitle?: string;
  @IsOptional() @IsString() @MaxLength(1000) teachingStyle?: string;
  @IsOptional() @IsString() @MaxLength(1000) teachingAchievements?: string;
  @IsOptional() @IsString() @MaxLength(1000) examExperience?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) languages?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) availableTimes?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(5) @IsString({ each: true }) serviceModes?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) lessonFormats?: string[];
  @IsInt() @Min(1) version: number;
}

export class UpdateParentProfileDto {
  @IsOptional() @IsString() @MaxLength(64) province?: string;
  @IsOptional() @IsString() @MaxLength(64) city?: string;
  @IsOptional() @IsString() @MaxLength(64) district?: string;
  @IsOptional() @IsString() @MaxLength(255) address?: string;
  @IsOptional() @Type(() => Number) @IsLatitude() latitude?: number;
  @IsOptional() @Type(() => Number) @IsLongitude() longitude?: number;
  @IsOptional() @IsString() @MaxLength(64) studentNickname?: string;
  @IsOptional() @IsString() @MaxLength(20) studentGender?: string;
  @IsOptional() @IsString() @MaxLength(64) studentGrade?: string;
  @IsOptional() @IsString() @MaxLength(128) schoolName?: string;
  @IsOptional() @IsString() @MaxLength(255) currentLevel?: string;
  @IsOptional() @IsString() @MaxLength(255) targetGoal?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) weakSubjects?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) learningGoals?: string[];
  @IsOptional() @IsString() @MaxLength(64) learningStyle?: string;
  @IsOptional() @IsString() @MaxLength(500) personalityNotes?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) preferredSchedule?: string[];
  @IsOptional() @IsString() @MaxLength(1000) tutorExpectations?: string;
}

export class AddCertificationDto {
  @IsString() @MaxLength(64) type: string;
  @IsOptional() @IsUrl({ require_tld: false }) @MaxLength(500) fileUrl?: string;
  @IsOptional() @IsString() @MaxLength(500) @Matches(/^private\/[a-zA-Z0-9-]+\/.+/) objectKey?: string;
}
