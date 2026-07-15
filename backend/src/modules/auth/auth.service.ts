import { randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { BadRequestException, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import * as argon2 from "argon2";
import { PrismaService } from "../../prisma/prisma.service";
import { AccountStatus, RoleCode } from "../../generated/prisma/enums";
import { AdminLoginDto, WechatLoginDto } from "./dto/auth.dto";

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService
  ) {}

  async wechatLogin(dto: WechatLoginDto, ip?: string, userAgent?: string) {
    const wxIdentity = await this.exchangeWechatCode(dto.code);
    const account = await this.prisma.account.upsert({
      where: { openid: wxIdentity.openid },
      update: {
        unionid: wxIdentity.unionid || undefined,
        nickname: dto.nickname || undefined,
        avatarUrl: dto.avatarUrl || undefined
      },
      create: {
        openid: wxIdentity.openid,
        unionid: wxIdentity.unionid,
        nickname: dto.nickname || "微信用户",
        avatarUrl: dto.avatarUrl,
        roles: {
          create: [{ roleCode: RoleCode.PARENT }, { roleCode: RoleCode.TEACHER }]
        },
        parentProfile: { create: {} },
        teacherProfile: { create: {} }
      },
      include: { roles: true, teacherProfile: true, parentProfile: true }
    });
    this.assertActive(account.status);
    const roles = account.roles.map((item) => item.roleCode);
    const requested = dto.activeRole || RoleCode.PARENT;
    const activeRole = roles.includes(requested) && requested !== RoleCode.ADMIN ? requested : RoleCode.PARENT;
    return this.createSession(account, roles, activeRole, ip, userAgent);
  }

  async adminLogin(dto: AdminLoginDto, ip?: string, userAgent?: string) {
    const account = await this.prisma.account.findUnique({
      where: { username: dto.username },
      include: { roles: true }
    });
    if (!account?.passwordHash || !(await argon2.verify(account.passwordHash, dto.password))) {
      throw new UnauthorizedException("用户名或密码错误");
    }
    this.assertActive(account.status);
    const roles = account.roles.map((item) => item.roleCode);
    if (!roles.includes(RoleCode.ADMIN)) throw new UnauthorizedException("该账号不是管理员");
    return this.createSession(account, roles, RoleCode.ADMIN, ip, userAgent);
  }

  async refresh(refreshToken: string, ip?: string, userAgent?: string, requestedRole?: RoleCode) {
    const { sessionId, secret } = this.parseRefreshToken(refreshToken);
    const session = await this.prisma.refreshSession.findUnique({
      where: { id: sessionId },
      include: { account: { include: { roles: true } } }
    });
    if (!session || session.revokedAt || session.expiresAt <= new Date()) {
      throw new UnauthorizedException("刷新凭证已过期");
    }
    if (!this.safeEqual(session.tokenHash, this.hash(secret))) {
      await this.prisma.refreshSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
      throw new UnauthorizedException("刷新凭证无效");
    }
    this.assertActive(session.account.status);
    const roles = session.account.roles.map((item) => item.roleCode);
    const defaultRole = roles.includes(RoleCode.ADMIN) && session.account.username ? RoleCode.ADMIN : roles[0];
    const activeRole = requestedRole && roles.includes(requestedRole) ? requestedRole : defaultRole;
    const nextSecret = randomBytes(32).toString("base64url");
    await this.prisma.refreshSession.update({
      where: { id: session.id },
      data: { tokenHash: this.hash(nextSecret), ipAddress: ip, userAgent }
    });
    return {
      accessToken: await this.signAccess(session.account.id, roles, activeRole),
      refreshToken: `${session.id}.${nextSecret}`,
      expiresIn: 900
    };
  }

  async logout(accountId: string, refreshToken: string) {
    const { sessionId } = this.parseRefreshToken(refreshToken);
    await this.prisma.refreshSession.updateMany({
      where: { id: sessionId, accountId },
      data: { revokedAt: new Date() }
    });
    return { success: true };
  }

  async switchRole(accountId: string, role: RoleCode) {
    if (role === RoleCode.ADMIN) throw new BadRequestException("请从管理后台登录管理员角色");
    const account = await this.prisma.account.findUniqueOrThrow({
      where: { id: accountId },
      include: { roles: true }
    });
    const roles = account.roles.map((item) => item.roleCode);
    if (!roles.includes(role)) throw new BadRequestException("账号尚未开通该角色");
    return {
      accessToken: await this.signAccess(account.id, roles, role),
      activeRole: role,
      roles
    };
  }

  async getAccount(accountId: string, activeRole: RoleCode) {
    const account = await this.prisma.account.findUniqueOrThrow({
      where: { id: accountId },
      include: { roles: true, parentProfile: true, teacherProfile: true }
    });
    return this.presentAccount(account, activeRole);
  }

  private async createSession(
    account: any,
    roles: RoleCode[],
    activeRole: RoleCode,
    ip?: string,
    userAgent?: string
  ) {
    const secret = randomBytes(32).toString("base64url");
    const days = Number(this.config.get("REFRESH_TOKEN_DAYS") || 30);
    const session = await this.prisma.refreshSession.create({
      data: {
        accountId: account.id,
        tokenHash: this.hash(secret),
        ipAddress: ip,
        userAgent,
        expiresAt: new Date(Date.now() + days * 86_400_000)
      }
    });
    return {
      accessToken: await this.signAccess(account.id, roles, activeRole),
      refreshToken: `${session.id}.${secret}`,
      expiresIn: 900,
      account: this.presentAccount(account, activeRole)
    };
  }

  private presentAccount(account: any, activeRole: RoleCode) {
    return {
      id: account.id,
      nickname: account.nickname,
      avatarUrl: account.avatarUrl,
      status: account.status,
      roles: account.roles.map((item: any) => item.roleCode),
      activeRole,
      parentProfile: account.parentProfile || null,
      teacherProfile: account.teacherProfile || null
    };
  }

  private async signAccess(accountId: string, roles: RoleCode[], activeRole: RoleCode) {
    return this.jwt.signAsync(
      { sub: accountId, roles, activeRole },
      {
        secret: this.config.getOrThrow<string>("JWT_ACCESS_SECRET"),
        expiresIn: this.config.get("ACCESS_TOKEN_TTL") || "15m"
      } as any
    );
  }

  private async exchangeWechatCode(code: string): Promise<{ openid: string; unionid?: string }> {
    const appid = this.config.get<string>("WECHAT_APP_ID");
    const secret = this.config.get<string>("WECHAT_APP_SECRET");
    const mock = this.config.get<string>("WECHAT_LOGIN_MOCK") === "true";
    if (mock || !secret) {
      return { openid: `mock_${this.hash(code).slice(0, 48)}` };
    }
    const params = new URLSearchParams({ appid: appid || "", secret, js_code: code, grant_type: "authorization_code" });
    const response = await fetch(`https://api.weixin.qq.com/sns/jscode2session?${params}`);
    const data = await response.json() as any;
    if (!response.ok || !data.openid) throw new UnauthorizedException(data.errmsg || "微信登录失败");
    return { openid: data.openid, unionid: data.unionid };
  }

  private parseRefreshToken(token: string) {
    const separator = token.indexOf(".");
    if (separator < 1) throw new UnauthorizedException("刷新凭证格式错误");
    return { sessionId: token.slice(0, separator), secret: token.slice(separator + 1) };
  }

  private hash(value: string) {
    return createHash("sha256").update(value).digest("hex");
  }

  private safeEqual(left: string, right: string) {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private assertActive(status: AccountStatus) {
    if (status !== AccountStatus.ACTIVE) throw new UnauthorizedException("账号当前不可用");
  }
}
