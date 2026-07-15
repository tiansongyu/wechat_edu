import { Transform, Type } from "class-transformer";
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength
} from "class-validator";
import {
  ReviewReportCategory,
  ReviewReportStatus,
  ReviewStatus
} from "../../../generated/prisma/enums";

const trimText = ({ value }: { value: unknown }) => typeof value === "string" ? value.trim() : value;

export class CreateReviewReportDto {
  @IsEnum(ReviewReportCategory)
  category: ReviewReportCategory;

  @Transform(trimText)
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  description: string;
}

export class ReviewReportPaginationDto {
  @IsOptional()
  @IsUUID()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

export class AdminReviewListDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  @IsOptional()
  @IsEnum(ReviewStatus)
  status?: ReviewStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @IsOptional()
  @Transform(trimText)
  @IsString()
  @MaxLength(80)
  keyword?: string;
}

export class AdminReviewReportListDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  @IsOptional()
  @IsEnum(ReviewReportStatus)
  status?: ReviewReportStatus;

  @IsOptional()
  @IsEnum(ReviewReportCategory)
  category?: ReviewReportCategory;

  @IsOptional()
  @Transform(trimText)
  @IsString()
  @MaxLength(80)
  keyword?: string;
}

export class ChangeReviewVisibilityDto {
  @Transform(trimText)
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  version: number;
}

export class ResolveReviewReportDto {
  @IsIn([ReviewReportStatus.ACTION_TAKEN, ReviewReportStatus.NO_VIOLATION])
  resolution: ReviewReportStatus;

  @Transform(trimText)
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  note: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  version: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  reviewVersion: number;
}
