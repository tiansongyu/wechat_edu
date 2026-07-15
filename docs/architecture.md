# 系统架构

## 架构决策

当前采用模块化单体，而不是直接拆分微服务。API 与异步 Worker 使用同一套代码和镜像，但作为不同容器运行。这能保证事务边界清晰、部署成本低，同时保留后续拆分通知、聊天或搜索服务的能力。

微信小程序使用一个 AppID 和一套账号体系。`account_roles` 允许同一账号同时拥有 `PARENT`、`TEACHER` 角色，Access Token 中记录当前活动角色。管理员使用独立 Web 入口和 `ADMIN` 权限。

## 服务拓扑

| 服务 | 职责 | 扩容方式 |
|---|---|---|
| `gateway` | HTTPS、反向代理、限流、WebSocket 升级 | 通常 1–2 个入口实例 |
| `api` | 无状态 REST API | 水平增加容器 |
| `worker` | Outbox、通知、异步任务 | 按队列积压增加容器 |
| `admin-web` | Vue 静态管理后台 | CDN 或多个 Nginx 实例 |
| `pgbouncer` | 数据库事务连接池 | 单实例起步，高可用时双实例 |
| `postgres` | 业务真相源、事务、PostGIS | 主从、托管 PostgreSQL |
| `redis` | BullMQ、短期缓存、协调 | Sentinel/Cluster |
| `minio` | 私有认证材料和图片 | 分布式 MinIO 或迁移 COS |

## 后端模块

- `auth`：微信 code2session、管理员登录、Access/Refresh Token、角色切换。
- `profiles`：家长资料、教师资料、认证材料、乐观锁。
- `jobs`：发布、审核、筛选、附近查询、收藏。
- `applications`：报名、录用、拒绝、合作记录。
- `communications`：通知、会话、消息幂等。
- `files`：MinIO 私有对象的短期上传 URL。
- `admin`：看板、用户状态、教师/发布审核、审计日志。
- `worker`：Outbox 事件投递、BullMQ 重试、通知落库。

## 核心并发策略

### 报名

1. 小程序为每次提交生成 `Idempotency-Key`。
2. 后端首先查询 `idempotency_records`。
3. PostgreSQL 串行化事务锁定目标需求。
4. 数据库唯一约束 `(jobId, teacherId)` 阻止重复报名。
5. 报名、计数器和 Outbox 事件在同一事务提交。
6. 重复请求返回第一次保存的响应。

### 录用

1. 锁定报名记录和需求记录。
2. 验证发布人所有权及报名状态。
3. 重新统计已录用人数并检查 `capacity`。
4. 更新报名、创建合作记录；名额用完后关闭需求。

### 消息与异步任务

- 消息唯一约束为 `(conversationId, senderId, clientMessageId)`。
- 业务事务只写 Outbox，不直接依赖 Redis 成功。
- Worker 将 Outbox 投递到 BullMQ，按事件 ID 去重并指数退避重试。
- PostgreSQL 是最终数据源，Redis 不保存不可恢复的业务状态。

## 数据安全

- Refresh Token 仅保存 SHA-256 摘要，并在刷新时轮换。
- 管理员密码使用 Argon2id。
- 联系方式使用 AES-256-GCM 加密。
- 认证文件位于 MinIO 私有 Bucket，通过十分钟签名 URL 上传。
- 管理员审核、封禁和恢复操作写入 `audit_logs`。
- 非活动账号登录时被拒绝，停用账号会撤销全部 Refresh Session。

## 主要数据表

```text
accounts ─ account_roles ─ roles
   ├─ parent_profiles
   ├─ teacher_profiles ─ teacher_certifications
   ├─ job_posts ─ applications ─ appointments
   ├─ favorites
   ├─ refresh_sessions
   ├─ notifications
   └─ conversation_members ─ conversations ─ messages

idempotency_records
outbox_events
audit_logs
system_settings
```

地理坐标同时保留 Decimal 经纬度和 PostGIS `geography(Point, 4326)`，附近查询使用 GiST 索引和 `ST_DWithin`。
