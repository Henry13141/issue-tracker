# 项目理解报告

生成日期：2026-04-29

## 1. 项目定位

这是米伽米内部使用的协作推进与问题跟踪平台。它的核心不是单纯记录工单，而是把“任务创建、责任分配、进展同步、风险暴露、企业微信催办、管理看板”串成一个闭环。

当前系统已经从基础工单工具扩展为多模块内部运营平台，主要覆盖：

- 工单协作：问题创建、指派、评审、状态流转、进展、附件、子任务、交接与返工。
- 成员工作台：展示个人今日优先事项、待同步任务、相关动态和快捷操作。
- 管理驾驶舱：管理员查看整体推进、风险事项、成员负载、通知健康和 AI 报告。
- 企业微信集成：扫码登录、应用消息、群机器人、机器人问答、Excel 导入工单。
- 财务行政运营：周期性财务/出纳/行政人事待办、周计划、临时事项、备用金和发票台账。
- AI 能力：Kimi 问答、工单分类建议、交接草稿、管理洞察、组织记忆学习。
- Seedance 创作台：基于火山 Ark/Seedance 的视频生成任务、素材、提示词优化和成本估算。

## 2. 技术栈与运行方式

- 前端与后端一体框架：Next.js 16.2.1 App Router。
- UI：React 19.2.4、Tailwind CSS 4、shadcn/ui、Radix/Base UI、lucide-react。
- 数据与认证：Supabase PostgreSQL、Supabase Auth、RLS、Service Role 后台任务。
- 外部服务：企业微信开放平台、Moonshot Kimi、火山 Ark Seedance、Vercel Analytics/Speed Insights、Vercel Blob。
- 部署：Vercel，区域配置为 `sin1`，定时任务由 `vercel.json` 管理。
- 关键命令：`npm run dev`、`npm run build`、`npm run lint`、`npm run verify`。

AGENTS.md 特别提醒：这是 Next.js 16 项目，不能按旧 Next.js 经验直接写代码。已核对本地 `node_modules/next/dist/docs/`，Next 16 中 `Middleware` 已改称 `Proxy`，本项目也使用 `src/proxy.ts` 作为请求前置处理入口。

## 3. 应用架构

项目采用 App Router 分组结构：

- `src/app/(auth)/login/page.tsx`：登录页。
- `src/app/(main)/layout.tsx`：主应用登录门禁，未登录跳转 `/login`。
- `src/app/(main)/home/page.tsx`：成员工作台，也是日常入口。
- `src/app/(main)/issues`：工单列表与详情。
- `src/app/(main)/dashboard`：管理员驾驶舱及通知、AI 记忆、AI 报告等子页面。
- `src/app/(main)/finance-ops`：财务行政待办、周计划、备用金。
- `src/app/(main)/seedance`：视频生成创作台。
- `src/app/api`：认证、Cron、企业微信机器人、附件下载、TTS、Seedance 等 Route Handlers。

服务端写操作主要放在 `src/actions/`，例如：

- `issues.ts`：工单 CRUD、状态机校验、进度、评论、交接、子任务。
- `finance-ops.ts`：财务任务模板、实例、周计划排期、临时事项。
- `petty-cash.ts`：备用金与替票管理。
- `members.ts`：成员、角色、企业微信 userid 管理。
- `notifications.ts`：通知投递日志查询。

通用业务能力集中在 `src/lib/`，例如认证、企业微信、AI、通知服务、状态机、Dashboard 查询、财务日期计算、Supabase client 等。

## 4. 认证与权限

系统有两层登录保护：

- `src/proxy.ts`：对 `/dashboard`、`/members`、`/issues`、`/my-tasks`、`/reminders`、`/seedance` 做会话保护，并通过 Supabase `getUser()` 刷新 session。
- `src/lib/auth.ts`：业务层要求 Supabase Auth 用户必须在 `public.users` 有资料行，否则视为 `profile_missing`。

用户角色包括：

- `admin`：全局管理、Dashboard、成员管理、通知日志、AI 管理能力。
- `finance`：财务行政相关权限。
- `member`：普通成员。

财务行政模块还额外支持 `users.can_access_finance_ops`，实际访问由 `src/lib/permissions.ts` 判断。

数据库开启 RLS。普通业务使用 anon session client，后台 Cron 和通知日志等使用 service role admin client 绕过 RLS。

## 5. 核心业务模块

### 工单模块

工单状态包括 `todo`、`in_progress`、`blocked`、`pending_review`、`pending_rework`、`resolved`、`closed`。服务端状态机位于 `src/lib/issue-state-machine.ts`，关键规则包括：

- 进入 `blocked` 必须填写阻塞原因。
- 进入 `closed` 必须填写关闭原因。
- 进入 `pending_review` 必须有评审人。
- 提交验证前必须完成子任务。
- 进入 `pending_review` 或 `resolved` 前必须有至少一条人工进度。
- 非管理员情况下，负责人处理推进状态，评审人在待验证阶段执行审核结果。

工单更新会写入 `issue_events`，并触发事件驱动通知。列表页支持全部、待我处理、高风险筛选，并按终态后置排序。

### 通知与提醒

通知统一通过 `src/lib/notification-service.ts`，会先写 `notification_deliveries` pending 记录，再发送企业微信或群机器人消息，最后更新成功/失败结果。

通知来源包括：

- Cron：早间负责人摘要、每日提醒、周日晚间预览、AI 学习、延迟通知刷新。
- 事件驱动：创建、负责人/评审人变化、状态变化、紧急优先级、截止日期提前、交接、返工。
- 生命周期：新成员欢迎。
- 手动测试与管理员重试。

非 Cron、非测试的事件通知会受工作时间限制，工作时间外会延迟到下一个工作开始时间。

### 企业微信机器人

`src/app/api/wecom/robot/route.ts` 支持：

- 单聊文本问答，按企业微信 userid 保留最近 5 轮上下文。
- 群聊仅在 @机器人 后单轮回复。
- “新建问题”多轮建单。
- “取消新建问题”退出草稿流。
- Excel 文件导入工单。
- “清空上下文/重置对话”清理机器人记忆。

企业微信 API 封装在 `src/lib/wecom.ts`，支持应用消息、群机器人 Webhook、OAuth、签名校验、回调解密、媒体下载和代理/反代配置。

### 财务行政模块

`finance-ops` 包含三种模式：

- `tasks`：固定周期任务模板和实例，支持周/月/季/年规则。
- `weekly-plan`：按周排布财务、出纳、行政人事事项，支持临时事项并入周视图。
- `petty-cash`：备用金登记、报销状态、发票收集、替票池。

该模块有 schema readiness 检查，数据库迁移未完成时会展示初始化提示，而不是直接崩溃。

### AI 与组织记忆

AI 默认走 Moonshot API，模型为 `kimi-k2.6`。能力包括：

- 企业微信机器人问答。
- 工单分类/模块建议。
- 优先级建议。
- 交接草稿、描述草稿。
- 管理洞察和长期报告。
- `ai_memory` 与 `ai_interaction_events` 形成组织记忆。

### Seedance 创作台

Seedance 模块封装火山 Ark 任务接口，支持：

- 视频生成任务创建、查询、删除。
- 参考素材上传与任务关联。
- 提示词结构化构建与优化。
- Token/成本估算。

## 6. 数据模型概览

核心表和迁移显示真实模型已明显超过 README 基础版本：

- `users`：用户资料、角色、头像、企业微信 userid、财务权限。
- `issues`：工单主体，含状态、负责人、评审人、父子任务、分类、模块、来源、阻塞/关闭原因、重开次数、最后活动时间和终态排序生成列。
- `issue_updates`：人工/系统进度，支持状态变更和更新类型。
- `issue_events`：审计事件。
- `issue_attachments`：附件元数据。
- `issue_update_comments`：进度评论。
- `issue_handovers`、`issue_participants`：交接和参与者。
- `reminders`：提醒中心。
- `notification_deliveries`：通知投递审计。
- `wecom_robot_messages`、`wecom_robot_issue_drafts`：机器人上下文和建单草稿。
- `finance_task_templates`、`finance_task_instances`、`finance_task_week_schedules`、`finance_week_plan_items`：财务行政任务体系。
- `petty_cash_entries`、`petty_cash_replacement_invoices`：备用金和替票。
- `ai_memory`、`ai_interaction_events`、`ai_chat_messages`：AI 记忆与对话。
- `seedance_task_prompts` 和 Supabase Storage buckets：Seedance 任务提示词和素材。

## 7. 定时任务

`vercel.json` 当前配置：

- `09:30` 北京时间：`/api/cron/morning-assignee-digest`。
- `09:30` 北京时间：`/api/cron/flush-deferred`。
- `17:30` 北京时间：`/api/cron/daily-reminder`。
- `周日 21:00` 北京时间：`/api/cron/sunday-week-preview`。
- `每日 18:30` 北京时间：`/api/cron/ai-learning`。
- 另有一次性/历史注册通知任务：`/api/cron/notify-register`。

多数 Cron 支持 `Authorization: Bearer $CRON_SECRET` 手动调用，也接受 Vercel Cron header。

## 8. 关键环境变量

主要环境变量包括：

- Supabase：`NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`。
- 应用地址与 Cron：`NEXT_PUBLIC_APP_URL`、`CRON_SECRET`。
- 企业微信：`WECOM_CORPID`、`WECOM_CORPSECRET`、`WECOM_AGENTID`、`WECOM_WEBHOOK_URL`、`WECOM_TOKEN`、`WECOM_ENCODING_AES_KEY`、`WECOM_API_BASE_URL`、`WECOM_PROXY_URL`。
- AI：`MOONSHOT_API_KEY`。
- Seedance：`ARK_API_KEY`。
- Blob 与运维：`BLOB_READ_WRITE_TOKEN`、`UPTIME_KUMA_NOTIFY_SECRET`、`UPTIME_KUMA_NOTIFY_USERID`。
- 历史钉钉兼容变量仍存在，但 README 标注主线已迁往企业微信。

## 9. 当前工作区状态

当前 git 工作区不是完全干净：

- 已修改：`src/components/issue-detail-client.tsx`
- 未跟踪：`.cursor/debug-70638a.log`

本次只读分析和新增报告，没有改动这些已有变化。

## 10. 主要风险与改进建议

1. `supabase/schema.sql` 与 migrations/类型定义存在信息差。README 和基础 schema 描述偏旧，真实模型依赖迁移叠加，建议定期生成一份“当前数据库基线 schema”。
2. `README.md` 仍有少量旧钉钉命名和过期目录说明，例如 `test-dingtalk` 路由仍用于测试企业微信消息，容易误导新维护者。
3. 企业微信链路配置多，且依赖可信 IP、应用可见范围、userid 绑定。建议将已有的通知健康能力继续强化为配置检查清单。
4. 通知服务采用 fire-and-forget 和延迟发送，用户操作链路体验好，但排障依赖 `notification_deliveries` 和日志，建议管理员页继续突出 failed/pending/deferred 的处理路径。
5. 财务行政、Seedance、AI 能力增长很快，产品边界已经超过“issue-tracker”仓库名，后续文档需要按模块维护，避免所有知识堆在 README。
6. `src/components/issue-detail-client.tsx` 当前有未提交修改，后续若要改工单详情页，需要先确认这部分变化属于谁、是否要保留。

## 11. 快速上手路线

新维护者建议按以下顺序读代码：

1. `README.md` 和本报告：先了解业务闭环。
2. `src/app/(main)/layout.tsx`、`src/proxy.ts`、`src/lib/auth.ts`：理解登录和门禁。
3. `src/actions/issues.ts`、`src/lib/issue-state-machine.ts`：理解工单主流程。
4. `src/lib/notification-service.ts`、`src/lib/event-notification.ts`、`src/app/api/cron/daily-reminder/route.ts`：理解通知和提醒闭环。
5. `src/lib/wecom.ts`、`src/app/api/wecom/robot/route.ts`：理解企业微信集成。
6. `src/app/(main)/finance-ops/page.tsx`、`src/actions/finance-ops.ts`：理解财务行政模块。
7. `supabase/migrations/`：核对真实数据库能力。

