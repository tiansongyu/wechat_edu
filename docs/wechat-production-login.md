# 微信真实登录部署说明

小程序登录链路固定为：`wx.login` 获取一次性 `code`，小程序只把该 `code` 发送给本项目 API；API 使用服务器端保存的 AppID/AppSecret 调用微信 `code2Session`，再以 `openid`/`unionid` 在 PostgreSQL 注册或登录账号。AppSecret 和微信返回的 `session_key` 都不会下发到小程序。

## 启用真实登录

1. 在微信公众平台确认项目 AppID 为 `wx02054be10e52aff0`，获取对应 AppSecret。
2. 在服务器的 `.env` 中设置：
   - `WECHAT_APP_ID=wx02054be10e52aff0`
   - `WECHAT_APP_SECRET=<仅保存在服务器的密钥>`
   - `WECHAT_LOGIN_MOCK=false`
   - `SEED_DEMO_DATA=false`
3. 把 HTTPS API 域名加入小程序的 request 合法域名，并将 `utils/config.js` 的生产地址指向该域名。
4. 使用 `docker compose -f compose.yaml -f compose.production.yaml up -d --build` 部署。
5. 后台数据看板必须显示“微信真实登录已启用”，再使用真机或微信开发者工具清除缓存后登录。

## 官方接口

- [wx.login](https://developers.weixin.qq.com/miniprogram/dev/api/open-api/login/wx.login.html)
- [code2Session](https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/user-login/code2Session.html)
- [wx.chooseLocation](https://developers.weixin.qq.com/miniprogram/dev/api/location/wx.chooseLocation.html)

不要把 AppSecret 写入小程序源码、提交到 Git，或通过前端请求直接传输。
