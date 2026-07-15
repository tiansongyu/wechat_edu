import { Transform, Type } from "class-transformer";
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import { AccountStatus, ApplicationStatus, AppointmentStatus, AuditStatus } from "../../../generated/prisma/enums";

export class AdminListDto {
  @IsOptional() @IsString() keyword?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
}

export class AuditDecisionDto {
  @IsEnum(AuditStatus) status: AuditStatus;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  @IsOptional() @IsInt() @Min(1) version?: number;
}

export class AdminApplicationListDto extends AdminListDto {
  @IsOptional() @Transform(({ value }) => value || undefined) @IsEnum(ApplicationStatus) status?: ApplicationStatus;
}

export class AdminAppointmentListDto extends AdminListDto {
  @IsOptional() @Transform(({ value }) => value || undefined) @IsEnum(AppointmentStatus) status?: AppointmentStatus;
}

export class AdminApplicationStatusDto {
  @IsEnum(ApplicationStatus) status: ApplicationStatus;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
  @IsInt() @Min(1) version: number;
}

export class AdminAppointmentStatusDto {
  @IsEnum(AppointmentStatus) status: AppointmentStatus;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
  @IsInt() @Min(1) version: number;
}

export class UpdateAccountStatusDto {
  @IsEnum(AccountStatus) status: AccountStatus;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}
