import { ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AccountStatus, RoleCode } from "../../generated/prisma/enums";
import { AuthService } from "./auth.service";

describe("AuthService WeChat identity exchange", () => {
  afterEach(() => jest.restoreAllMocks());

  function service(config: Record<string, string>) {
    const configService = { get: (key: string) => config[key] } as ConfigService;
    return new AuthService({} as any, {} as any, configService);
  }

  it("exchanges a wx.login code through the real code2Session endpoint", async () => {
    const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ openid: "wx-openid-1", unionid: "wx-unionid-1", session_key: "server-only" })
    } as Response);
    const auth = service({
      WECHAT_LOGIN_MOCK: "false",
      WECHAT_APP_ID: "wx-test-app",
      WECHAT_APP_SECRET: "server-secret"
    });

    await expect((auth as any).exchangeWechatCode("one-time-code")).resolves.toEqual({
      openid: "wx-openid-1",
      unionid: "wx-unionid-1"
    });
    const calledUrl = String(fetchSpy.mock.calls[0][0]);
    expect(calledUrl).toContain("https://api.weixin.qq.com/sns/jscode2session?");
    expect(calledUrl).toContain("appid=wx-test-app");
    expect(calledUrl).toContain("js_code=one-time-code");
  });

  it("maps an invalid one-time code to a safe authentication error", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ errcode: 40029, errmsg: "invalid code" })
    } as Response);
    const auth = service({
      WECHAT_LOGIN_MOCK: "false",
      WECHAT_APP_ID: "wx-test-app",
      WECHAT_APP_SECRET: "server-secret"
    });

    await expect((auth as any).exchangeWechatCode("expired-code")).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("refuses live mode when the server-side AppSecret is absent", async () => {
    const auth = service({ WECHAT_LOGIN_MOCK: "false", WECHAT_APP_ID: "wx-test-app" });
    await expect((auth as any).exchangeWechatCode("one-time-code")).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("persists a normalized nickname and records the account audit", async () => {
    const current = {
      id: "account-1",
      nickname: "旧昵称",
      avatarUrl: null,
      status: AccountStatus.ACTIVE,
      lastLoginAt: null,
      loginCount: 1,
      roles: [{ roleCode: RoleCode.PARENT }],
      parentProfile: null,
      teacherProfile: null
    };
    const tx = {
      account: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(current),
        update: jest.fn().mockResolvedValue({ ...current, nickname: "新 昵称" })
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) }
    };
    const prisma = { $transaction: jest.fn((callback) => callback(tx)) };
    const auth = new AuthService(prisma as any, {} as any, { get: jest.fn() } as any);

    await expect(auth.updateAccount("account-1", RoleCode.PARENT, { nickname: "  新   昵称  " }))
      .resolves.toMatchObject({ nickname: "新 昵称", activeRole: RoleCode.PARENT });
    expect(tx.account.update).toHaveBeenCalledWith(expect.objectContaining({ data: { nickname: "新 昵称" } }));
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "account.nickname.update", before: { nickname: "旧昵称" }, after: { nickname: "新 昵称" } })
    }));
  });
});
