import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";
import { RequestUser } from "../interfaces/request-user";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: ConfigService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()])) {
      return true;
    }
    const request = context.switchToHttp().getRequest();
    const value = request.headers.authorization || "";
    const [type, token] = value.split(" ");
    if (type !== "Bearer" || !token) throw new UnauthorizedException("请先登录");
    try {
      const payload = await this.jwt.verifyAsync(token, {
        secret: this.config.getOrThrow<string>("JWT_ACCESS_SECRET")
      });
      request.user = {
        id: payload.sub,
        roles: payload.roles,
        activeRole: payload.activeRole
      } satisfies RequestUser;
      return true;
    } catch {
      throw new UnauthorizedException("登录已过期，请重新登录");
    }
  }
}
