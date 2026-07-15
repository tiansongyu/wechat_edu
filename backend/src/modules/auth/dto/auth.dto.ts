import { Transform } from "class-transformer";
import { IsEnum, IsNotEmpty, IsOptional, IsString, Length, MaxLength } from "class-validator";
import { RoleCode } from "../../../generated/prisma/enums";

export class WechatLoginDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  deviceId?: string;

  @IsOptional()
  @IsString()
  nickname?: string;

  @IsOptional()
  @IsString()
  avatarUrl?: string;

  @IsOptional()
  @IsEnum(RoleCode)
  activeRole?: RoleCode;
}

export class AdminLoginDto {
  @IsString()
  @Length(3, 64)
  username: string;

  @IsString()
  @Length(8, 128)
  password: string;
}

export class RefreshDto {
  @IsString()
  @IsNotEmpty()
  refreshToken: string;

  @IsOptional()
  @IsEnum(RoleCode)
  activeRole?: RoleCode;
}

export class SwitchRoleDto {
  @IsEnum(RoleCode)
  role: RoleCode;
}

export class UpdateAccountDto {
  @Transform(({ value }) => typeof value === "string" ? value.trim().replace(/\s+/g, " ") : value)
  @IsString({ message: "昵称格式不正确" })
  @Length(1, 30, { message: "昵称长度应为1到30个字符" })
  nickname: string;
}
