import { Type } from "class-transformer";
import { IsEnum, IsInt, IsLatitude, IsLongitude, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from "class-validator";
import { JobType } from "../../../generated/prisma/enums";

export const CONTACT_PATTERN = /^(?=.*[\p{L}\p{N}])[\p{L}\p{N}@._+%#:/：()（）\- ]+$/u;

export class ListJobsDto {
  @IsOptional() @IsEnum(JobType) type?: JobType;
  @IsOptional() @IsString() @MaxLength(64) district?: string;
  @IsOptional() @IsString() @MaxLength(64) grade?: string;
  @IsOptional() @IsString() @MaxLength(64) subject?: string;
  @IsOptional() @IsString() @MaxLength(120) keyword?: string;
  @IsOptional() @IsUUID() cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit = 20;
}

export class NearbyJobsDto extends ListJobsDto {
  @Type(() => Number) @IsLatitude() latitude: number;
  @Type(() => Number) @IsLongitude() longitude: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0.1) @Max(50) radiusKm = 10;
}

export class CreateJobDto {
  @IsEnum(JobType) type: JobType;
  @IsString() @Matches(/\S/) @MaxLength(120) title: string;
  @IsOptional() @IsString() @Matches(/\S/) @MaxLength(64) province?: string;
  @IsOptional() @IsString() @Matches(/\S/) @MaxLength(64) city?: string;
  @IsString() @Matches(/\S/) @MaxLength(64) district: string;
  @IsOptional() @IsString() @MaxLength(128) area?: string;
  @IsString() @Matches(/\S/) @MaxLength(64) grade: string;
  @IsString() @Matches(/\S/) @MaxLength(64) subject: string;
  @IsInt() @Min(1) @Max(100000000) priceCents: number;
  @IsOptional() @IsString() @Matches(/\S/) @MaxLength(32) priceUnit?: string;
  @IsOptional() @IsString() @Matches(/\S/) @MaxLength(32) settlement?: string;
  @IsString() @Matches(/\S/) @MaxLength(255) schedule: string;
  @IsString() @Matches(/\S/) @MaxLength(3000) description: string;
  @IsOptional() @IsString() @MaxLength(500) studentInfo?: string;
  @IsOptional() @IsString() @MaxLength(255) address?: string;
  @IsOptional() @IsString() @MinLength(3) @MaxLength(100) @Matches(CONTACT_PATTERN) contact?: string;
  @IsOptional() @Type(() => Number) @IsLatitude() latitude?: number;
  @IsOptional() @Type(() => Number) @IsLongitude() longitude?: number;
  @IsOptional() @IsInt() @Min(1) @Max(20) capacity = 1;
}

export class UpdateJobDto {
  @IsOptional() @IsString() @Matches(/\S/) @MaxLength(120) title?: string;
  @IsOptional() @IsString() @Matches(/\S/) @MaxLength(64) province?: string;
  @IsOptional() @IsString() @Matches(/\S/) @MaxLength(64) city?: string;
  @IsOptional() @IsString() @Matches(/\S/) @MaxLength(64) district?: string;
  @IsOptional() @IsString() @MaxLength(128) area?: string;
  @IsOptional() @IsString() @Matches(/\S/) @MaxLength(64) grade?: string;
  @IsOptional() @IsString() @Matches(/\S/) @MaxLength(64) subject?: string;
  @IsOptional() @IsInt() @Min(1) @Max(100000000) priceCents?: number;
  @IsOptional() @IsString() @Matches(/\S/) @MaxLength(32) priceUnit?: string;
  @IsOptional() @IsString() @Matches(/\S/) @MaxLength(32) settlement?: string;
  @IsOptional() @IsString() @Matches(/\S/) @MaxLength(255) schedule?: string;
  @IsOptional() @IsString() @Matches(/\S/) @MaxLength(3000) description?: string;
  @IsOptional() @IsString() @MaxLength(500) studentInfo?: string;
  @IsOptional() @IsString() @MaxLength(255) address?: string;
  @IsOptional() @IsString() @MinLength(3) @MaxLength(100) @Matches(CONTACT_PATTERN) contact?: string;
  @IsOptional() @IsInt() @Min(1) @Max(20) capacity?: number;
  @IsOptional() @Type(() => Number) @IsLatitude() latitude?: number;
  @IsOptional() @Type(() => Number) @IsLongitude() longitude?: number;
  @IsInt() @Min(1) version: number;
}
