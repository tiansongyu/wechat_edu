import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";
import { RequestUser } from "../interfaces/request-user";
import { AccountStatus } from "../../generated/prisma/enums";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()])) {
      return true;
    }
    const request = context.switchToHttp().getRequest();
    const value = request.headers.authorization || "";
    const [type, token] = value.split(" ");
    if (type !== "Bearer" || !token) throw new UnauthorizedException("请先登录");
    let payload: { sub?: string; roles?: RequestUser["roles"]; activeRole?: RequestUser["activeRole"] };
    try {
      payload = await this.jwt.verifyAsync(token, {
        secret: this.config.getOrThrow<string>("JWT_ACCESS_SECRET")
      });
    } catch {
      throw new UnauthorizedException("登录已过期，请重新登录");
    }
    if (!payload.sub || !Array.isArray(payload.roles) || !payload.activeRole) {
      throw new UnauthorizedException("登录凭证无效");
    }
    const account = await this.prisma.account.findUnique({
      where: { id: payload.sub },
      select: { status: true }
    });
    if (!account || account.status !== AccountStatus.ACTIVE) {
      throw new UnauthorizedException("账号当前不可用");
    }
    request.user = {
      id: payload.sub,
      roles: payload.roles,
      activeRole: payload.activeRole
    } satisfies RequestUser;
    return true;
  }
}
