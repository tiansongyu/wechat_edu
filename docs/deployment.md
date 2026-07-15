# Docker 部署说明

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

1. 准备 Linux 服务器、域名、Docker Engine 和 Compose Plugin。
2. 将 `.env.example` 复制为 `.env`，替换所有 `change-me` 和默认密码。
3. 设置 `WECHAT_APP_SECRET`；生产覆盖配置会强制关闭模拟登录，并禁止写入演示数据。
4. 设置 `MINIO_PUBLIC_ENDPOINT` 为认证文件使用的公网 HTTPS 文件域名，同时设置 `MINIO_PUBLIC_PORT=443`、`MINIO_PUBLIC_USE_SSL=true`，并通过反向代理或对象存储网关转发到 MinIO。
5. 把证书保存为 `infra/nginx/certs/fullchain.pem` 和 `infra/nginx/certs/privkey.pem`；生产配置会启用 TLS 1.2/1.3 和 HTTP 到 HTTPS 跳转。
6. 执行：

```bash
docker compose -f compose.yaml -f compose.production.yaml up -d --build
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
- 管理后台默认密码已经修改。

## 备份建议

生产环境建议使用托管 PostgreSQL 的自动备份；自建环境至少每天运行一次 `pg_dump -Fc`，保留 7 个日备份和 4 个周备份。MinIO Bucket 需要配置版本控制或同步到异地对象存储。
