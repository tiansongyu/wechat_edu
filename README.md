# 家教直聘全栈系统

一个包含家长端、老师端、管理员后台和完整 Docker 基础设施的家教匹配系统。微信小程序使用同一个 AppID，通过角色切换进入家长版或老师版；服务端采用 NestJS、PostgreSQL/PostGIS、Redis/BullMQ、MinIO 和 Vue 3。

## 已实现

- 微信登录、Access Token、旋转 Refresh Token、会话撤销
- 同一微信账号的家长/老师双角色切换
- 家长发布需求、老师发布求带、管理员内容审核
- 教师资料、认证材料及管理员认证审核
- 需求筛选、详情、地图坐标、收藏和游标分页
- 老师报名、家长接受/拒绝、合作记录
- 幂等报名、唯一约束、串行化事务、名额锁定
- 通知、会话、幂等消息和 Outbox 异步事件
- MinIO 私有文件上传签名
- Vue 管理后台：看板、用户、教师审核、发布审核、审计日志
- Nginx、PgBouncer、PostGIS、Redis、MinIO 的 Docker Compose 部署

## 系统组成

```text
微信小程序 ─┐
            ├─ Nginx ─ NestJS API (可多副本) ─ PgBouncer ─ PostgreSQL + PostGIS
Vue 管理后台 ┘                    │
                                  ├─ Redis + BullMQ Worker
                                  └─ MinIO 私有文件
```

详细设计见 [系统架构](docs/architecture.md) 和 [部署说明](docs/deployment.md)。

## 本地启动

需要先启动 Docker Desktop，然后执行：

```bash
cp .env.example .env
docker compose up -d --build
docker compose ps
```

如果 Docker Desktop 使用宿主机本地代理（例如端口 `7897`），构建时可执行：

```bash
DOCKER_BUILD_PROXY=http://host.docker.internal:7897 docker compose up -d --build
```

启动后：

- 管理后台：<http://localhost:8080>
- Swagger API：<http://localhost:8080/docs>
- API 健康检查：<http://localhost:8080/health>
- MinIO 控制台：<http://localhost:9001>

本地默认管理员账号来自 `.env`：

```text
用户名：admin
密码：Admin123456!
```

首次启动会自动执行数据库迁移和幂等种子脚本。正式部署前必须修改全部密码、JWT 密钥和数据加密密钥。

## 微信小程序

1. 使用微信开发者工具导入仓库根目录。
2. 当前 AppID 已配置为 `wx02054be10e52aff0`。
3. 开发者工具中可使用 `http://127.0.0.1:8080` 调试。
4. 真机或发布版本需要修改 [`utils/config.js`](utils/config.js) 为已备案的 HTTPS API 域名。
5. 在微信公众平台配置相同的 `request` 合法域名。
6. 正式环境设置 `WECHAT_APP_SECRET`，并将 `WECHAT_LOGIN_MOCK=false`。

Docker 负责部署 API、管理后台和数据服务；微信小程序本身仍需通过微信开发者工具上传和提交审核。

## 常用验证命令

```bash
node tests/smoke.js
node tests/architecture.js

cd backend
npm run build

cd ../admin-web
npm run build

cd ..
docker compose config --quiet
```

## 目录

```text
.
├── pages/                     # 微信小程序页面
├── components/                # 小程序组件
├── utils/                     # API、鉴权、本地回退数据
├── backend/                   # NestJS API、Worker、Prisma
│   ├── prisma/                # Schema、迁移、种子数据
│   └── src/modules/           # 业务模块
├── admin-web/                 # Vue 3 管理后台
├── infra/nginx/               # Nginx 网关
├── tests/load/                # k6 并发压测
├── compose.yaml               # 本地/通用 Docker 编排
└── compose.production.yaml    # 生产覆盖配置
```
