import { Type } from "class-transformer";
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import { AccountStatus, AuditStatus } from "../../../generated/prisma/enums";

export class AdminListDto {
  @IsOptional() @IsString() keyword?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
}

export class AuditDecisionDto {
  @IsEnum(AuditStatus) status: AuditStatus;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class UpdateAccountStatusDto {
  @IsEnum(AccountStatus) status: AccountStatus;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}
