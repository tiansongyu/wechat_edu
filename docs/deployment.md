# Docker 部署说明

## 一键部署

服务器首次拿到 `deploy.sh` 后，在项目根目录执行：

```bash
git fetch origin main && git switch main && git pull --ff-only origin main && chmod +x deploy.sh && ./deploy.sh
```

脚本会拒绝空值、`change-me` 和默认口令；如果提示某个密钥不合格，请先只修改服务器 `.env` 中对应项，
不要把 `.env` 或密钥提交到 Git。

默认使用体验模式：保留 `GATEWAY_PORT`（默认 `4000`）上的 HTTP 网关，但强制
`NODE_ENV=production`、`WECHAT_LOGIN_MOCK=false` 和 `SEED_DEMO_DATA=false`。脚本会依次完成环境与
Compose 校验、应用镜像构建、PostgreSQL 备份、增量迁移、容器替换，并实际请求 `/health` 与
`/api/v1/platform/overview`；任一环节失败都会打印容器状态与相关日志，并且不会清库或删除数据卷。
体验模式默认把 PostgreSQL、Redis 和 MinIO 管理控制台的宿主机端口限制到 `127.0.0.1`，MinIO API
仍按 `.env` 暴露以支持现有预签名上传流程。HTTP 裸 IP 只用于服务器联调或关闭合法域名校验的开发者工具；
微信真机体验版仍应尽快切换到已配置为 request 合法域名的 HTTPS 域名。

日常更新代码并一键重新部署仍使用同一条命令。只检查环境而不修改容器或数据库：

```bash
./deploy.sh --check
```

拥有 HTTPS 域名和证书后，使用生产模式：

```bash
DEPLOY_BASE_URL=https://api.example.com ./deploy.sh production
```

生产模式要求证书位于 `infra/nginx/certs/fullchain.pem` 和
`infra/nginx/certs/privkey.pem`，并使用 `compose.production.yaml` 的 80/443 网关配置。部署前数据库备份默认
保存在 `.deploy-backups/`，可通过 `DEPLOY_BACKUP_DIR` 改到服务器的独立备份盘。证书目录已被 Git 忽略；
显式传入 `DEPLOY_BASE_URL` 时会严格校验证书有效期、信任链与域名，不会跳过 TLS 错误。

脚本要求 Docker Compose `2.24.4` 或更高版本，并默认拒绝用脏 Git 工作树构建。它只支持本仓库 Compose
管理的 PostgreSQL，且会校验应用、迁移和备份指向同一数据库。部署前 dump 是一致性快照而不是自动回滚机制；
正式生产还应启用 PostgreSQL PITR/持续归档，并保持数据库迁移向后兼容。
如果 Docker Hub 临时不可达但服务器已有所需基础镜像缓存，可显式使用
`DEPLOY_PULL_BASE_IMAGES=false ./deploy.sh`；正常部署应保留默认值以获取基础镜像安全更新。

`WECHAT_APP_SECRET` 只能写入服务器 `.env`。如果密钥曾经提交到 Git，即使最新版本删除了明文，历史提交
仍可能保留它，必须在微信公众平台轮换后再更新服务器 `.env`。

## 开发环境

```bash
cp .env.example .env
docker compose up -d --build
docker compose ps
docker compose logs -f api worker migrate
```

Docker Desktop 使用宿主机本地 HTTP 代理时，把代理地址通过构建参数传入容器：

```bash
DOCKER_BUILD_PROXY=http://host.docker.internal:7897 docker compose up -d --build
```

如果 `migrate` 容器显示 `Exited (0)`，表示迁移和种子数据已成功完成，这是预期状态。

本地端口统一使用 `4000` 段：网关 `4000`、PostgreSQL `4001`、Redis `4002`、MinIO API `4003`、MinIO 控制台 `4004`。容器内部仍使用各服务的标准端口。

停止服务但保留数据：

```bash
docker compose down
```

删除全部本地数据并重新初始化：

```bash
docker compose down -v
docker compose up -d --build
```

`down -v` 会永久删除本地 PostgreSQL、Redis 和 MinIO 数据，只能用于明确需要重建的开发环境。

### 收口本地测试数据

自动化回归会产生大量账号与业务记录。需要把本地数据库收口为一套外键一致的样例时，先停止会写业务数据的容器，再使用数据库名进行二次确认：

```bash
docker compose build migrate
docker compose stop api worker
docker compose run --rm \
  -e RESET_SAMPLE_DATA=true \
  -e RESET_SAMPLE_DATABASE=tutor_link \
  migrate npm run db:reset-sample
docker compose start api worker
```

该命令会永久删除当前开发数据库中的账号和业务数据，然后创建一套关联的家长、老师、家教单、报名、双方已完成预约、评价、举报、会话、消息与通知样例，并立即执行数量和外键校验。脚本会拒绝在 `NODE_ENV=production` 下运行，也会拒绝未确认数据库名或未经额外确认的远程数据库。生产环境不得执行此命令。

只读验证现有数据库是否恰好为这套样例：

```bash
docker compose run --rm migrate npm run db:verify-sample
```

### Docker 重启持久化验证

以下测试不会删除或改写业务数据，但会依次重启本地 PostgreSQL、Redis、API 和 Worker。它只比较 PostgreSQL 核心业务状态的不可逆摘要，不输出用户资料内容：

```bash
RUN_DOCKER_PERSISTENCE_TEST=true npm --prefix backend run test:persistence
```

运行期间不要同时执行 E2E 或人工写入；若摘要在重启前后不同，测试会失败。此验证同时确认 Redis 不是业务事实来源，API/Worker 重启后仍从 PostgreSQL 恢复账号、资料、发布、报名、预约、评价、举报、会话与消息状态。

## 生产环境

1. 准备 Linux 服务器、域名、Docker Engine 和 Compose Plugin 2.24.4 以上版本。
2. 将 `.env.example` 复制为 `.env`，替换所有 `change-me` 和默认密码。
3. 设置 `WECHAT_APP_SECRET`；生产覆盖配置会强制关闭模拟登录，并禁止写入演示数据。
4. 设置 `MINIO_PUBLIC_ENDPOINT` 为 API 使用的公网 HTTPS 域名，同时设置 `MINIO_PUBLIC_PORT=443`、`MINIO_PUBLIC_USE_SSL=true`。仓库内 Nginx 已将同源 `/tutor-link/` 签名上传转发到 MinIO，并将只读头像 `/media/` 转发到公开头像前缀；认证材料仍为私有对象。
5. 把证书保存为 `infra/nginx/certs/fullchain.pem` 和 `infra/nginx/certs/privkey.pem`；生产配置会启用 TLS 1.2/1.3 和 HTTP 到 HTTPS 跳转。
6. 执行：

```bash
DEPLOY_BASE_URL=https://api.example.com ./deploy.sh production
```

生产配置不会将 PostgreSQL、Redis 和 MinIO 暴露到公网，也不会写入演示家长、教师和家教单。迁移阶段只幂等初始化角色、系统设置及首次管理员账号，已存在管理员不会被部署过程重置密码。API 容器为无状态设计，可以通过 Compose scale 或编排平台增加副本：

```bash
docker compose -f compose.yaml -f compose.production.yaml up -d --scale api=2 --scale worker=2
```

## 上线检查

- `/health` 返回 200。
- `migrate` 容器退出码为 0。
- `.env` 未提交到 Git。
- `WECHAT_LOGIN_MOCK=false`。
- 微信公众平台已配置 HTTPS request 合法域名。
- PostgreSQL、Redis、MinIO 没有公网端口。
- 数据库备份已执行恢复演练。
- 使用 `tests/load/apply-concurrency.js` 完成压测。
- `workflow-e2e` 与 `reviews-e2e` 已在目标数据库验证命令幂等、身份隔离及评价举报治理闭环。
- `platform-expansion-e2e` 已验证 MinIO 头像、详细资料、省市区服务范围、搜索/多选筛选、发布修改审核、申请内沟通、确认合作和双向评价。
- 管理后台默认密码已经修改。

## 备份建议

生产环境建议使用托管 PostgreSQL 的自动备份；自建环境至少每天运行一次 `pg_dump -Fc`，保留 7 个日备份和 4 个周备份。MinIO Bucket 需要配置版本控制或同步到异地对象存储。
