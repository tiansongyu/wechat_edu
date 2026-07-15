import { randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { BadRequestException, Injectable, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import * as argon2 from "argon2";
import { PrismaService } from "../../prisma/prisma.service";
import { AccountStatus, RoleCode } from "../../generated/prisma/enums";
import { AdminLoginDto, UpdateAccountDto, WechatLoginDto } from "./dto/auth.dto";

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService
  ) {}

  async wechatLogin(dto: WechatLoginDto, ip?: string, userAgent?: string) {
    const wxIdentity = await this.exchangeWechatCode(dto.code, dto.deviceId);
    const existing = await this.prisma.account.findFirst({
      where: {
        OR: [
          { openid: wxIdentity.openid },
          ...(wxIdentity.unionid ? [{ unionid: wxIdentity.unionid }] : [])
        ]
      },
      select: { id: true }
    });
    const isNewAccount = !existing;
    const accountId = await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const current = existing
        ? await tx.account.update({
            where: { id: existing.id },
            data: {
              openid: wxIdentity.openid,
              unionid: wxIdentity.unionid || undefined,
              nickname: dto.nickname || undefined,
              avatarUrl: dto.avatarUrl || undefined,
              lastLoginAt: now,
              loginCount: { increment: 1 }
            }
          })
        : await tx.account.create({
            data: {
              openid: wxIdentity.openid,
              unionid: wxIdentity.unionid,
              nickname: dto.nickname || "微信用户",
              avatarUrl: dto.avatarUrl,
              lastLoginAt: now,
              loginCount: 1
            }
          });

      this.assertActive(current.status);

      for (const roleCode of [RoleCode.PARENT, RoleCode.TEACHER]) {
        await tx.accountRole.upsert({
          where: { accountId_roleCode: { accountId: current.id, roleCode } },
          update: {},
          create: { accountId: current.id, roleCode }
        });
      }
      // Interactive transactions share one PostgreSQL connection. Keep these
      // writes sequential so pg never receives overlapping queries on it.
      await tx.parentProfile.upsert({ where: { accountId: current.id }, update: {}, create: { accountId: current.id } });
      await tx.teacherProfile.upsert({ where: { accountId: current.id }, update: {}, create: { accountId: current.id } });
      await tx.userPreference.upsert({ where: { accountId: current.id }, update: {}, create: { accountId: current.id } });
      await tx.auditLog.create({
        data: {
          actorId: current.id,
          action: isNewAccount ? "auth.wechat.register" : "auth.wechat.login",
          targetType: "Account",
          targetId: current.id,
          after: { provider: "WECHAT", isNewAccount }
        }
      });
      return current.id;
    });
    // Prisma may load several included relations concurrently. Resolve those
    // after the interactive transaction has released its single pg client so
    // relation reads cannot overlap on the transaction connection.
    const account = await this.prisma.account.findUniqueOrThrow({
      where: { id: accountId },
      include: { roles: true, teacherProfile: true, parentProfile: true }
    });
    const roles = account.roles.map((item) => item.roleCode);
    const requested = dto.activeRole || RoleCode.PARENT;
    const activeRole = roles.includes(requested) && requested !== RoleCode.ADMIN ? requested : RoleCode.PARENT;
    return {
      ...(await this.createSession(account, roles, activeRole, ip, userAgent, dto.deviceId)),
      isNewAccount,
      loginProvider: "WECHAT"
    };
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

  async refresh(refreshToken: string, ip?: string, userAgent?: string, requestedRole?: RoleCode, deviceId?: string) {
    const { sessionId, secret } = this.parseRefreshToken(refreshToken);
    const session = await this.prisma.refreshSession.findUnique({
      where: { id: sessionId },
      include: { account: { include: { roles: true } } }
    });
    if (!session || session.revokedAt || session.expiresAt <= new Date()) {
      throw new UnauthorizedException("刷新凭证已过期");
    }
    const tokenHash = this.hash(secret);
    if (!this.safeEqual(session.tokenHash, tokenHash)) {
      await this.prisma.refreshSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
      throw new UnauthorizedException("刷新凭证无效");
    }
    if (session.deviceIdHash && (!deviceId || !this.safeEqual(session.deviceIdHash, this.hash(deviceId)))) {
      await this.prisma.refreshSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
      throw new UnauthorizedException("登录设备校验失败，请重新使用微信登录");
    }
    this.assertActive(session.account.status);
    const roles = session.account.roles.map((item) => item.roleCode);
    const defaultRole = roles.includes(RoleCode.ADMIN) && session.account.username ? RoleCode.ADMIN : roles[0];
    const activeRole = requestedRole && roles.includes(requestedRole) ? requestedRole : defaultRole;
    const nextSecret = randomBytes(32).toString("base64url");
    const rotated = await this.prisma.refreshSession.updateMany({
      where: { id: session.id, tokenHash, revokedAt: null, expiresAt: { gt: new Date() } },
      data: { tokenHash: this.hash(nextSecret), ipAddress: ip, userAgent }
    });
    if (!rotated.count) throw new UnauthorizedException("刷新凭证已被使用，请重新登录");
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

  async updateAccount(accountId: string, activeRole: RoleCode, dto: UpdateAccountDto) {
    const nickname = dto.nickname.trim().replace(/\s+/g, " ");
    if (!nickname) throw new BadRequestException("昵称不能为空");
    if (nickname.length > 30) throw new BadRequestException("昵称长度不能超过30个字符");

    const updatedAccountId = await this.prisma.$transaction(async (tx) => {
      const current = await tx.account.findUniqueOrThrow({
        where: { id: accountId },
        select: { id: true, nickname: true, status: true }
      });
      this.assertActive(current.status);
      if (current.nickname === nickname) return current.id;

      await tx.account.update({
        where: { id: accountId },
        data: { nickname }
      });
      await tx.auditLog.create({
        data: {
          actorId: accountId,
          action: "account.nickname.update",
          targetType: "Account",
          targetId: accountId,
          before: { nickname: current.nickname },
          after: { nickname }
        }
      });
      return current.id;
    });
    const updated = await this.prisma.account.findUniqueOrThrow({
      where: { id: updatedAccountId },
      include: { roles: true, parentProfile: true, teacherProfile: true }
    });
    return this.presentAccount(updated, activeRole);
  }

  private async createSession(
    account: any,
    roles: RoleCode[],
    activeRole: RoleCode,
    ip?: string,
    userAgent?: string,
    deviceId?: string
  ) {
    const secret = randomBytes(32).toString("base64url");
    const days = Number(this.config.get("REFRESH_TOKEN_DAYS") || 30);
    const session = await this.prisma.refreshSession.create({
      data: {
        accountId: account.id,
        tokenHash: this.hash(secret),
        ipAddress: ip,
        userAgent,
        deviceIdHash: deviceId ? this.hash(deviceId) : null,
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
      lastLoginAt: account.lastLoginAt,
      loginCount: account.loginCount,
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

  private async exchangeWechatCode(code: string, deviceId?: string): Promise<{ openid: string; unionid?: string }> {
    const appid = this.config.get<string>("WECHAT_APP_ID");
    const secret = this.config.get<string>("WECHAT_APP_SECRET");
    const mock = this.config.get<string>("WECHAT_LOGIN_MOCK") === "true";
    if (mock) {
      return { openid: `mock_${this.hash(deviceId || code).slice(0, 48)}` };
    }
    if (!appid || !secret) {
      throw new ServiceUnavailableException("微信登录配置不完整");
    }
    const params = new URLSearchParams({ appid, secret, js_code: code, grant_type: "authorization_code" });
    let response: Response;
    try {
      response = await fetch(`https://api.weixin.qq.com/sns/jscode2session?${params}`, {
        signal: AbortSignal.timeout(8000)
      });
    } catch {
      throw new ServiceUnavailableException("暂时无法连接微信登录服务，请稍后重试");
    }
    const data = await response.json() as any;
    if (!response.ok || data.errcode || !data.openid) {
      if ([40029, 40163].includes(Number(data.errcode))) {
        throw new UnauthorizedException("微信登录凭证无效，请重新登录");
      }
      if (Number(data.errcode) === 45011) {
        throw new ServiceUnavailableException("微信登录请求过于频繁，请稍后重试");
      }
      throw new UnauthorizedException("微信身份校验失败，请重新登录");
    }
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
