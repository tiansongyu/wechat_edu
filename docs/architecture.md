# 系统架构

## 架构决策

当前采用模块化单体，而不是直接拆分微服务。API 与异步 Worker 使用同一套代码和镜像，但作为不同容器运行。这能保证事务边界清晰、部署成本低，同时保留后续拆分通知、聊天或搜索服务的能力。

微信小程序使用一个 AppID 和一套账号体系。`account_roles` 允许同一账号同时拥有 `PARENT`、`TEACHER` 角色，Access Token 中记录当前活动角色。受角色保护的接口以 `activeRole` 为准，不会因为账号还拥有另一个角色就越权；管理员使用独立 Web 入口和 `ADMIN` 活动角色。

## 数据边界

PostgreSQL 是资料、发布、收藏、报名、预约、通知、聊天、用户偏好和审核记录的唯一真相源。小程序页面只消费 API 返回的数据，本地存储仅用于 `accessToken`、`refreshToken`、`activeRole` 和稳定 `deviceId`，不提供模拟业务数据或离线成功回退。

Redis 承担 BullMQ、短期缓存和协调，不保存不可恢复的业务状态。MinIO 保存私有文件对象，数据库保存对象键、归属及审核状态。因此重启小程序、API 或 Worker 后，业务状态均由 PostgreSQL 恢复。

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
- `jobs`：发布、审核、筛选、附近查询、收藏、关闭和重新提交审核。
- `applications`：报名、取消、重报、录用、拒绝及父端统一报名视图。
- `appointments`：教师确认、家长完成、双方取消或发起争议的履约状态机。
- `communications`：通知、会话未读数、聊天已读和消息幂等。
- `preferences`：数据库中的接单通知、聊天通知和隐私偏好。
- `files`：MinIO 私有对象的短期上传 URL。
- `admin`：看板、用户状态、教师/发布审核、报名与预约履约、审计日志。
- `worker`：Outbox 事件投递、BullMQ 重试、通知落库。

管理后台客户端在 Access Token 过期后使用旋转 Refresh Token 执行单次并发刷新，并重放原请求；刷新失败才清理会话并返回登录页。

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
4. 更新报名、创建预约记录；名额用完后关闭需求，并拒绝其余待处理报名。

### 取消、重报与发布生命周期

- 教师只能取消自己的待处理报名；取消原因写入 `statusNote`，状态和版本在同一事务更新。
- 已取消报名再次提交时复用 `(jobId, teacherId)` 唯一记录，恢复为 `PENDING` 并增加 `version`，不会制造重复报名。
- 发布者关闭需求时，待处理报名同步拒绝并记录原因；重新开启后发布回到 `PENDING`，必须重新经过管理员审核才能发布。
- 家长端通过统一报名列表查看自己全部发布下的报名，并在允许的状态中执行接受或拒绝。

### 预约履约

`appointments` 使用 `PENDING → CONFIRMED → COMPLETED` 主路径，也允许参与双方在规则允许的阶段取消或发起争议。教师负责确认，发布者负责确认完成；取消和争议必须填写原因。每次状态变化都写入 `statusNote`、`handledAt`、`version`、Outbox 和审计日志。

后台报名与预约操作同样校验当前状态和请求携带的 `version`。若记录已被其他人处理，更新以冲突响应结束，避免后到的审核覆盖先到的结果。

### 消息与异步任务

- 消息唯一约束为 `(conversationId, senderId, clientMessageId)`。
- `conversation_members.lastReadAt` 保存聊天已读位置，会话列表中的未读数由数据库消息计算。
- 业务事务只写 Outbox，不直接依赖 Redis 成功。
- Worker 将 Outbox 投递到 BullMQ，按事件 ID 去重并指数退避重试。
- 通知使用唯一 `sourceEventId` 关联事件，Worker 重试不会生成重复通知。
- PostgreSQL 是最终数据源，Redis 不保存不可恢复的业务状态。

## 数据安全

- Refresh Token 仅保存 SHA-256 摘要，并在刷新时轮换。
- 管理员密码使用 Argon2id。
- 联系方式使用 AES-256-GCM 加密。
- 认证文件位于 MinIO 私有 Bucket，通过十分钟签名 URL 上传。
- 管理员审核、封禁和恢复操作写入 `audit_logs`。
- 每个受保护请求都会从数据库检查账号状态；账号被停用后，已有 Access Token 立即失效，同时全部 Refresh Session 被撤销。
- 角色守卫同时校验令牌中的 `activeRole` 与账号角色集合，避免双角色账号跨角色调用接口。

## 主要数据表

```text
accounts ─ account_roles ─ roles
   ├─ parent_profiles
   ├─ teacher_profiles ─ teacher_certifications
   ├─ job_posts ─ applications ─ appointments
   ├─ favorites
   ├─ user_preferences
   ├─ refresh_sessions
   ├─ notifications
   └─ conversation_members ─ conversations ─ messages

idempotency_records
outbox_events
audit_logs
system_settings
```

地理坐标同时保留 Decimal 经纬度和 PostGIS `geography(Point, 4326)`，附近查询使用 GiST 索引和 `ST_DWithin`。

报名和预约记录使用 `statusNote` 保存拒绝、取消或争议原因，使用 `handledAt` 保存处理时间，并以递增 `version` 实现乐观并发控制。发布和教师资料同样有 `version`，管理员审核只允许命中待审核且版本一致的记录。`notifications.sourceEventId` 具有唯一约束，为异步事件到通知的落库提供去重保障。
