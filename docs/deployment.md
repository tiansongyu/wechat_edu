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
- 管理后台默认密码已经修改。

## 备份建议

生产环境建议使用托管 PostgreSQL 的自动备份；自建环境至少每天运行一次 `pg_dump -Fc`，保留 7 个日备份和 4 个周备份。MinIO Bucket 需要配置版本控制或同步到异地对象存储。
