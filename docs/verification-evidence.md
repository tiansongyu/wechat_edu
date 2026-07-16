# 2026-07-16 功能验证证据

本报告记录本轮代码在本地 Docker 环境中的实际验证结果。自动化使用临时账号和业务数据，验证完成后已删除临时 MinIO 头像并执行 `db:reset-sample`，数据库最终只保留一套外键一致的关联样例。

## 构建与静态验证

- 后端 TypeScript：`npm --prefix backend run lint`，通过。
- 后端单元测试：10 个测试套件、95 项断言全部通过。
- 后台管理端：`npm --prefix admin-web run build`，Vue 类型检查和 Vite 生产构建通过。
- 小程序页面：`node tests/smoke.js`，通过搜索防抖与旧响应隔离、多科目筛选、方形操作按钮、微信头像上传接线、角色隔离聊天、评价和命令幂等校验。

## API 与业务状态机

- `node tests/mini-api-e2e.mjs`：33/33 个小程序 API 契约通过；会话已验证发送、幂等重试、未读计数和 `/read` 已读命令。
- `node tests/workflow-e2e.mjs`：57 个不同 API 契约、数据库状态机和后台强制处理通过。
- `node tests/reviews-e2e.mjs`：双方完成合作后授权评价、评价幂等、匿名展示、展示阈值、争议排除和举报治理全部通过。

## 本轮新增场景

`node tests/platform-expansion-e2e.mjs` 在真实 PostgreSQL、MinIO、Redis、API、worker、Nginx 组合中通过：

1. 家长和老师分别上传 68 字节 PNG，MinIO PUT 成功，同源 `/media/tutor-link/avatars/...` 可读取且类型、字节数一致。
2. 学生年级、薄弱科目、学习目标，以及老师的两个省/市/区服务区域和线上/上门方式均写入并从 PostgreSQL 回读一致。
3. “函数 + 数学/物理 + 南山区 + 课结 + 价格排序”组合搜索只返回目标数学需求，排除英语对照需求。
4. 已发布信息提交修改后，审核前读取到旧标题；后台审核通过后读取到新标题。
5. 申请自动创建会话，申请说明成为第一条持久化消息；发布人回复、接受、创建预约、双方确认完成全部成功。
6. 双方各提交一条 5 星评价，老师公开评价和家长收到的评价均正确显示。

本次运行的核心临时证据 ID 为：发布修改 `45b67f18-d9c8-489a-abfa-8412d665593d`、申请 `6480b530-e423-457d-b8d5-0960b5eddfad`、会话 `6cbeb5e2-f43f-4865-b5d8-6ed18d9e97a6`、预约 `97e4720f-6e94-4b9d-b897-e79fb6482034`、家长评价 `7c9834db-5118-44d8-a158-80ba181f4ee8`、老师评价 `caa24023-364f-4946-93c2-0359e03a57f8`。这些 ID 对应的临时数据已按测试清理策略删除，测试脚本可重复生成新证据。

## 数据与部署状态

- `npm run db:verify-sample`：仅保留一套引用完整的 PostgreSQL 业务样例，通过。
- `RUN_DOCKER_PERSISTENCE_TEST=true npm --prefix backend run test:persistence`：业务摘要 `06da26d3e1baa7ac6ac970ec5ad6321a` 在 PostgreSQL、Redis、API、worker 重启前后完全一致。
- 最终 `/health` 返回 `status: ok`，`WECHAT_LOGIN_MOCK=false`，小程序提交配置为 `http://89.117.20.124:4000`。

注意：微信真机发布仍要求在微信公众平台配置 HTTPS request 合法域名；裸 IP HTTP 仅适合关闭合法域名校验的开发联调。
