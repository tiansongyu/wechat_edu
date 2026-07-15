import { ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
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
});
