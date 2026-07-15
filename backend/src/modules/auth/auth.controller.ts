import { Body, Controller, Get, Headers, Ip, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Public } from "../../common/decorators/public.decorator";
import { RequestUser } from "../../common/interfaces/request-user";
import { AdminLoginDto, RefreshDto, SwitchRoleDto, WechatLoginDto } from "./dto/auth.dto";
import { AuthService } from "./auth.service";

@ApiTags("小程序认证")
@Controller("api/v1/auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post("wechat-login")
  login(
    @Body() dto: WechatLoginDto,
    @Ip() ip: string,
    @Headers("user-agent") userAgent?: string
  ) {
    return this.auth.wechatLogin(dto, ip, userAgent);
  }

  @Public()
  @Post("refresh")
  refresh(
    @Body() dto: RefreshDto,
    @Ip() ip: string,
    @Headers("user-agent") userAgent?: string,
    @Headers("x-device-id") deviceId?: string
  ) {
    return this.auth.refresh(dto.refreshToken, ip, userAgent, dto.activeRole, deviceId);
  }

  @ApiBearerAuth()
  @Post("logout")
  logout(@Body() dto: RefreshDto, @CurrentUser() user: RequestUser) {
    return this.auth.logout(user.id, dto.refreshToken);
  }

  @ApiBearerAuth()
  @Get("me")
  me(@CurrentUser() user: RequestUser) {
    return this.auth.getAccount(user.id, user.activeRole);
  }

  @ApiBearerAuth()
  @Post("switch-role")
  switchRole(@CurrentUser() user: RequestUser, @Body() dto: SwitchRoleDto) {
    return this.auth.switchRole(user.id, dto.role);
  }
}

@ApiTags("管理员认证")
@Controller("admin-api/v1/auth")
export class AdminAuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post("login")
  login(@Body() dto: AdminLoginDto, @Ip() ip: string, @Headers("user-agent") userAgent?: string) {
    return this.auth.adminLogin(dto, ip, userAgent);
  }

  @Public()
  @Post("refresh")
  refresh(@Body() dto: RefreshDto, @Ip() ip: string, @Headers("user-agent") userAgent?: string) {
    return this.auth.refresh(dto.refreshToken, ip, userAgent, dto.activeRole);
  }
}
