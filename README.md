# 家教直聘全栈系统

一个包含家长端、老师端、管理员后台和完整 Docker 基础设施的家教匹配系统。微信小程序使用同一个 AppID，通过角色切换进入家长版或老师版；服务端采用 NestJS、PostgreSQL/PostGIS、Redis/BullMQ、MinIO 和 Vue 3。PostgreSQL 是全部业务状态的唯一真相源，小程序不会用本地模拟数据替代接口结果。

## 已实现

- 微信登录、稳定设备标识、Access Token、旋转 Refresh Token、会话撤销
- 同一微信账号的家长/老师双角色切换，接口按当前 `activeRole` 授权
- 家长发布需求、老师发布求带、管理员内容审核
- 教师资料、认证材料及管理员认证审核
- 需求筛选、详情、地图附近查询、收藏、关闭与重新提交审核
- 老师报名、取消后重报，家长统一查看报名并执行接受/拒绝
- 预约履约的教师确认、双方完课确认、取消和争议状态流转
- 真实合作互评、1–5 星级、角色标签、低分说明、匿名明细与低样本保护
- 幂等报名、唯一约束、串行化事务、名额锁定及操作原因留痕
- 数据库用户偏好、通知、会话未读数、聊天已读、幂等消息和 Outbox 异步事件
- MinIO 私有文件上传签名
- Vue 管理后台：看板、用户、教师审核、发布审核、报名/预约履约、审计日志
- 管理后台 Access Token 过期时自动单次刷新并重放原请求
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

## 数据来源与本地缓存边界

资料、发布、收藏、报名、预约、聊天、通知和用户偏好均通过 API 读写 PostgreSQL。Redis 仅用于队列、短期缓存和协调，不能替代数据库中的业务记录；MinIO 保存私有文件对象，其对象键和审核状态仍由数据库关联。

微信小程序本地只保存 `accessToken`、`refreshToken`、当前 `activeRole` 和稳定 `deviceId`。页面进入或重试时从接口重新获取数据，不保留发布、报名、预约、消息等本地业务副本。

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

- 管理后台：<http://localhost:4000>
- Swagger API：<http://localhost:4000/docs>
- API 健康检查：<http://localhost:4000/health>
- PostgreSQL：`localhost:4001`
- Redis：`localhost:4002`
- MinIO API：<http://localhost:4003>
- MinIO 控制台：<http://localhost:4004>

本地默认管理员账号来自 `.env`：

```text
用户名：admin
密码：Admin123456!
```

首次启动会自动执行数据库迁移和幂等种子脚本。正式部署前必须修改全部密码、JWT 密钥和数据加密密钥。

## 微信小程序

1. 使用微信开发者工具导入仓库根目录。
2. 当前 AppID 已配置为 `wx02054be10e52aff0`。
3. 当前代码提交使用服务器 Docker 网关 `http://89.117.20.124:4000`；本地回归时可临时改为 `http://127.0.0.1:4000`，但不得提交本地地址。
4. 微信体验版真机请求仍要求已备案的 HTTPS 合法域名；正式体验前应将 [`utils/config.js`](utils/config.js) 替换为映射到该网关的 HTTPS API 域名，不能把裸 IP/HTTP 当作正式配置。
5. 在微信公众平台配置相同的 `request` 合法域名。
6. 正式环境设置 `WECHAT_APP_SECRET`，并将 `WECHAT_LOGIN_MOCK=false`。

Docker 负责部署 API、管理后台和数据服务；微信小程序本身仍需通过微信开发者工具上传和提交审核。

## 常用验证命令

```bash
node tests/smoke.js
node tests/architecture.js
node tests/mini-api-e2e.mjs  # Docker 服务启动后，回归原有小程序接口
node tests/workflow-e2e.mjs  # 验证角色权限、取消/重报、履约状态机和后台操作
node tests/reviews-e2e.mjs   # 验证双方完课、互评权限、幂等、匿名聚合和争议排除

cd backend
npm run build
npm run lint

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
├── utils/                     # API、鉴权和本地会话辅助（不保存业务数据）
├── backend/                   # NestJS API、Worker、Prisma
│   ├── prisma/                # Schema、迁移、种子数据
│   └── src/modules/           # 业务模块
├── admin-web/                 # Vue 3 管理后台
├── infra/nginx/               # Nginx 网关
├── tests/load/                # k6 并发压测
├── compose.yaml               # 本地/通用 Docker 编排
└── compose.production.yaml    # 生产覆盖配置
```
