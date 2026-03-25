# 内部问题追踪与催办系统 V1.0 最终交付文档

> 项目：米伽米 · 工单管理系统  
> 版本：V1.0（P0 / P1 / P2 / P3 / P3.1 全部完成）  
> 技术栈：Next.js 16 (App Router) · TypeScript · Tailwind CSS · shadcn/ui · Supabase · Vercel · 企业微信开放平台  
> 线上地址：https://tracker.megami-tech.com

---

## 目录

1. [系统定位与核心能力](#一系统定位与核心能力)
2. [技术栈与项目结构](#二技术栈与项目结构)
3. [数据库表结构总览](#三数据库表结构总览)
4. [核心业务流程](#四核心业务流程)
5. [状态机规则与治理约束](#五状态机规则与治理约束)
6. [通知体系说明](#六通知体系说明)
7. [Dashboard 管理指标说明](#七dashboard-管理指标说明)
8. [权限模型说明](#八权限模型说明)
9. [环境变量清单](#九环境变量清单)
10. [Supabase Migration 执行顺序](#十supabase-migration-执行顺序)
11. [本地运行与验证步骤](#十一本地运行与验证步骤)
12. [上线检查清单](#十二上线检查清单)
13. [后续可迭代方向](#十三后续可迭代方向)

---

## 一、系统定位与核心能力

本系统是面向内部团队的**工单协同与催办平台**，定位为"可管理、可决策、可暴露风险的后台驾驶舱"。

核心能力分为四个层次：

| 层次 | 能力 |
|------|------|
| **工单管理** | 创建、指派、评审人、优先级、状态流转、进度更新、附件上传、批量导入 |
| **治理与审计** | 严格状态机约束（服务端权威）、全量事件日志、字段变更追溯 |
| **通知体系** | Cron 定时催办 + 事件驱动实时通知，全部经过统一投递服务，支持失败追踪与重试 |
| **管理驾驶舱** | 风险总览、高风险工单排名、成员压力榜、模块分布、7天趋势、通知健康监控 |

系统已从"能跑"阶段升级为"可追踪、可控制、可观测"。

---

## 二、技术栈与项目结构

### 技术栈

| 层次 | 选型 |
|------|------|
| 前端框架 | Next.js 16 (App Router)，Server Components + Server Actions |
| 样式 | Tailwind CSS + shadcn/ui |
| 类型安全 | TypeScript（严格模式） |
| 数据库 | Supabase PostgreSQL + Row Level Security |
| 认证 | Supabase Auth + 企业微信 OAuth 扫码登录 |
| 部署 | Vercel（含 Cron Jobs） |
| 通知 | 企业微信应用消息（wecom_app）+ 群机器人 Webhook（wecom_bot） |

### 关键目录结构

```
src/
├── app/
│   ├── (main)/              # 主应用（需登录）
│   │   ├── dashboard/       # 管理驾驶舱（admin only）
│   │   │   └── notifications/  # 通知投递日志（admin only）
│   │   ├── issues/          # 工单列表 + 详情
│   │   ├── my-tasks/        # 我的任务
│   │   ├── members/         # 成员管理（admin only 部分功能）
│   │   └── reminders/       # 提醒中心
│   ├── api/
│   │   ├── admin/notifications/[id]/retry/  # 通知重试 API
│   │   ├── auth/            # 企业微信 OAuth 回调
│   │   └── cron/            # 定时任务
│   │       ├── daily-reminder/         # 每日17:30工单催办
│   │       ├── morning-assignee-digest/ # 早间负责人摘要
│   │       └── admin-escalation/        # 管理员督促
│   └── login/
├── actions/                 # Server Actions（服务端权威逻辑）
│   ├── issues.ts            # 工单 CRUD + 状态机校验
│   ├── members.ts           # 成员管理
│   ├── reminders.ts         # 提醒读写
│   └── notifications.ts     # 通知日志查询
├── lib/
│   ├── issue-state-machine.ts   # 状态机定义与校验
│   ├── event-notification.ts    # P3 事件驱动通知派发器
│   ├── notification-service.ts  # P1 统一通知发送服务
│   ├── notification-error.ts    # 错误归一化
│   ├── issue-dingtalk-notify.ts # 进度更新通知（管理员）
│   ├── issue-events.ts          # issue_events 写入 helper
│   ├── dashboard-queries.ts     # P2 Dashboard 聚合查询
│   ├── wecom.ts                 # 企业微信 API 封装
│   └── supabase/
│       ├── server.ts            # 用户会话 client
│       └── admin.ts             # service_role client（绕过 RLS）
├── components/              # UI 组件
└── types/index.ts           # 全局 TypeScript 类型定义
supabase/
└── migrations/              # 数据库迁移文件（见第十节）
```

---

## 三、数据库表结构总览

### `public.users`（Supabase Auth 同步表）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | uuid PK | 与 auth.users 关联 |
| `email` | text | 登录邮箱 |
| `name` | text | 显示名 |
| `role` | text | `admin` \| `member` |
| `avatar_url` | text | 头像 |
| `wecom_userid` | text | 企业微信通讯录 userid（发通知必须有） |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

### `public.issues`（工单主表）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | uuid PK | |
| `title` | text | 工单标题 |
| `description` | text | 描述 |
| `status` | text | 见状态机章节 |
| `priority` | text | `low` \| `medium` \| `high` \| `urgent` |
| `assignee_id` | uuid FK→users | 负责人 |
| `reviewer_id` | uuid FK→users | 评审人（P0 新增） |
| `creator_id` | uuid FK→users | 创建者 |
| `due_date` | date | 截止日期 |
| `resolved_at` | timestamptz | 解决时间 |
| `closed_at` | timestamptz | 关闭时间 |
| `category` | text | 分类（P0 新增） |
| `module` | text | 模块（P0 新增） |
| `source` | text | 来源：`manual`\|`import`，默认 `manual`（P0 新增） |
| `blocked_reason` | text | 阻塞原因，进入 blocked 必填，离开时自动清空（P0 新增） |
| `closed_reason` | text | 关闭原因，进入 closed 必填（P0 新增） |
| `reopen_count` | integer | 重开次数，`closed→in_progress` 时+1（P0 新增） |
| `last_activity_at` | timestamptz | 最后人工活动时间，系统催办不刷新（P0 新增） |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

**索引**：`status`、`priority`、`assignee_id`、`reviewer_id`、`due_date`、`last_activity_at DESC`

### `public.issue_updates`（进度更新）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | uuid PK | |
| `issue_id` | uuid FK→issues | |
| `user_id` | uuid FK→users | |
| `content` | text | 更新内容 |
| `status_from` | text | 更新前状态 |
| `status_to` | text | 更新后状态 |
| `update_type` | text | `comment`\|`status_change`\|`system_reminder`\|`assignment`\|`due_date_change`\|`priority_change`（P0 新增） |
| `is_system_generated` | boolean | 系统自动写入则为 true，不触发 last_activity_at 刷新（P0 新增） |
| `created_at` | timestamptz | |

**索引**：`(issue_id, created_at DESC)`

### `public.reminders`（提醒）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | uuid PK | |
| `issue_id` | uuid FK→issues | |
| `user_id` | uuid FK→users | 接收人 |
| `type` | text | `no_update_today`\|`overdue`\|`stale_3_days` |
| `message` | text | 提醒内容 |
| `is_read` | boolean | 是否已读 |
| `created_at` | timestamptz | |

**幂等保护**：同一 `issue_id + user_id + type + 当天` 最多一条，Cron 每次运行检查后才写入。

**索引**：`(user_id, is_read, created_at DESC)`

### `public.issue_events`（事件审计日志，P0 新增）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | uuid PK | |
| `issue_id` | uuid FK→issues CASCADE | |
| `actor_id` | uuid FK→users | 操作者（Cron 为 null） |
| `event_type` | text | 见下方事件类型列表 |
| `event_payload` | jsonb | 变更详情 |
| `created_at` | timestamptz | |

**事件类型**：`issue_created` / `issue_updated` / `assignee_changed` / `reviewer_changed` / `status_changed` / `priority_changed` / `due_date_changed` / `reminder_created` / `notification_delivery_success` / `notification_delivery_failed` / `issue_reopened` / `issue_closed`

**RLS**：只能查看自己有权访问的工单对应的事件（与 issues RLS 联动）。

**索引**：`(issue_id, created_at DESC)`

### `public.notification_deliveries`（通知投递日志，P1 新增）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | uuid PK | |
| `channel` | text | `wecom_app`\|`wecom_bot` |
| `target_user_id` | uuid FK→users | 接收人（内部用户） |
| `target_wecom_userid` | text | 企业微信 userid |
| `issue_id` | uuid FK→issues | 关联工单（可为 null） |
| `reminder_id` | uuid FK→reminders | 关联提醒（可为 null） |
| `trigger_source` | text | 触发来源（见通知体系章节） |
| `title` | text | 消息标题 |
| `content` | text | 消息内容（Markdown） |
| `provider_response` | jsonb | 企业微信原始响应 |
| `status` | text | `pending`\|`success`\|`failed` |
| `error_code` | text | 归一化错误码 |
| `error_message` | text | 错误描述 |
| `attempt_count` | integer | 发送/重试次数（默认1） |
| `created_at` | timestamptz | |
| `sent_at` | timestamptz | 成功送达时间 |

**RLS**：仅 admin 可读；写入由 service_role（admin client）执行，绕过 RLS。

**索引**：`(status, created_at DESC)` / `(target_user_id, created_at DESC)` / `(issue_id, created_at DESC)` / `(reminder_id, created_at DESC)` / `(trigger_source, created_at DESC)`

---

## 四、核心业务流程

### 4.1 创建工单

```
用户填写表单（title / priority / assignee / reviewer / due_date / category / module / source）
  → Server Action: createIssue()
    → 写入 public.issues
    → 写 issue_events: issue_created
    → dispatchEventNotifications({ changes: [{ type: "issue_created" }] })
      → 通知 assignee + reviewer（排除操作者）
      → trigger_source = "issue_event.created"
    → revalidatePath("/issues", "/dashboard", "/my-tasks")
```

### 4.2 更新工单

```
用户修改字段（状态 / 负责人 / 评审人 / 优先级 / 截止日期等）
  → Server Action: updateIssue()
    → 读取 beforeRow（获取变更前快照）
    → 服务端状态机校验 validateTransition()（权威校验，前端只做辅助提示）
    → 写入 public.issues（含 last_activity_at = now()）
    → 写 issue_events（状态变更 / 指派变更 / 优先级变更 / 截止日期变更等）
    → blocked_reason 清理：从 blocked 离开时自动置 null
    → reopen_count 累加：仅 closed→in_progress 时 +1，且只累加一次
    → dispatchEventNotifications()（合并本次所有变更为一条消息）
```

### 4.3 提交进度更新（addIssueUpdate）

```
用户提交进度（含可选状态切换）
  → Server Action: addIssueUpdate()
    → 服务端状态机校验（进度内容本身计为一次人工更新）
    → 写入 public.issue_updates（is_system_generated = false）
    → 触发器自动刷新 last_activity_at（仅非系统生成）
    → 写 issue_events
    → dingtalkAfterProgressUpdate()：进度内容通知→全体管理员（排除操作者）
    → dispatchEventNotifications()：状态变更事件通知→assignee / reviewer / creator
    → 若 status→blocked：额外发 dingtalkAfterIssueUpdateToBlocked()（含进度上下文）
```

### 4.4 Cron 每日催办

```
每天 17:30 触发 /api/cron/daily-reminder
  步骤一：写 reminders（幂等）
    → 扫描非终态工单
    → no_update_today：今日无人工更新（is_system_generated=false）
    → overdue：due_date < 今天且非 resolved/closed
    → stale_3_days：last_activity_at < 3天前（与 dashboard 口径一致）
    → 三类 reminder 每条最多写一次/天（hasReminderToday 幂等检查）
    → 写 issue_events: reminder_created（仅 insert 成功后写）
  步骤二：发通知（独立于步骤一）
    → 逐人发 wecom_app 消息（通过 notification-service，留日志）
    → 发群机器人 Markdown 汇总（通过 notification-service）
```

### 4.5 通知失败重试

```
管理员在 /dashboard/notifications 看到 failed 记录
  → 点击"重试"按钮
  → POST /api/admin/notifications/[id]/retry（admin only）
    → 校验：status=failed 且 attempt_count < 5
    → 更新原记录 status=pending，attempt_count+1
    → 重新调用 sendNotification()（使用原始参数）
    → 更新原记录为 success/failed，写 issue_events
```

---

## 五、状态机规则与治理约束

### 合法状态流转表

| 当前状态 | 可切换到 |
|----------|----------|
| `todo`（待处理） | `in_progress` / `blocked` / `closed` |
| `in_progress`（处理中） | `blocked` / `pending_review` / `resolved` / `closed` |
| `blocked`（阻塞） | `in_progress` / `closed` |
| `pending_review`（待验证） | `in_progress` / `resolved` / `closed` |
| `resolved`（已解决） | `closed` / `in_progress` |
| `closed`（已关闭） | `in_progress`（重开） |

### 业务约束（服务端强制执行）

| 规则 | 说明 |
|------|------|
| **blocked_reason 必填** | 切换到 `blocked` 时必须提供阻塞原因 |
| **closed_reason 必填** | 切换到 `closed` 时必须提供关闭原因 |
| **人工更新前置** | 切换到 `pending_review` 或 `resolved` 前，工单必须已存在至少一条非系统生成的进度更新；在 `addIssueUpdate` 中，当次内容本身计为满足 |
| **blocked_reason 自动清空** | 从 `blocked` 切换到其他任何状态时，`blocked_reason` 无条件清空 |
| **closed_reason 保留** | 重开（`closed→in_progress`）时 `closed_reason` 保留历史值，UI 仅在 `status=closed` 时展示 |
| **reopen_count 精确+1** | 仅在 `closed→in_progress` 时累加一次，`validateTransition` 不修改数据，无重复累加风险 |
| **服务端权威** | 所有校验在 Server Action 执行，前端仅做辅助提示，不能绕过 |

### 实现位置

- 状态机定义：`src/lib/issue-state-machine.ts`
- 调用点：`updateIssue()` 和 `addIssueUpdate()`（两个入口均覆盖，无法绕过）

---

## 六、通知体系说明

### 6.1 通知渠道

| 渠道 | 标识 | 说明 |
|------|------|------|
| 企业微信应用消息 | `wecom_app` | 发送到个人，支持个人微信接收 |
| 企业微信群机器人 | `wecom_bot` | 发送 Markdown 到指定群 |

### 6.2 触发来源（trigger_source）

| trigger_source | 来源 |
|----------------|------|
| `cron_daily` | 每日17:30工单催办 Cron |
| `cron_morning` | 早间负责人摘要 Cron |
| `cron_admin` | 管理员督促 Cron |
| `issue_event.created` | P3 工单创建事件 |
| `issue_event.status` | P3 状态变更事件 |
| `issue_event.priority` | P3 优先级提升为紧急事件 |
| `issue_event.due_date` | P3 截止日期提前事件 |
| `issue_event.assignment` | P3 负责人/评审人变更事件 |
| `issue_event`（旧） | P1 遗留记录（已被 P3 子类型替代） |

### 6.3 Cron 催办体系

| Cron 任务 | 触发时间 | 说明 |
|-----------|----------|------|
| `daily-reminder` | 每天 17:30 | 扫描工单写 reminders，逐人发催办应用消息 + 群机器人汇总 |
| `morning-assignee-digest` | 早间（按 vercel.json 配置） | 给每位负责人发今日待处理工单摘要 |
| `admin-escalation` | 按 vercel.json 配置 | 向管理员发督促汇总 |

**鉴权**：所有 Cron 接口支持 `x-vercel-cron: 1` 头（Vercel 调用）或 `Authorization: Bearer CRON_SECRET`（手动调用），两者均允许。

### 6.4 P3 事件驱动通知

事件驱动通知由 `src/lib/event-notification.ts` 统一处理，核心特性：

**接收人路由**

| 事件 | 通知对象 |
|------|----------|
| 工单创建 | assignee、reviewer |
| 负责人变更 | 新 assignee、reviewer |
| 评审人变更 | 新 reviewer、assignee |
| 状态→blocked | assignee、reviewer |
| 状态→pending_review | reviewer、assignee |
| 状态→resolved/closed | assignee、reviewer、creator、全体管理员 |
| 重新打开 | assignee、reviewer |
| 优先级→urgent | assignee、reviewer |
| 截止日期提前 | assignee、reviewer |

**所有事件**：操作者本人不收通知；creator/assignee/reviewer 同一人时自动去重。

**10 分钟防抖**（按事件桶粒度）：

防抖键 = `issue_id + target_user_id + trigger_source（事件桶）`，10 分钟内同桶只发一条。不同桶事件不互相阻塞（例：指派变更和状态阻塞可在10分钟内分别发出）。

桶优先级（高→低）：`status > priority > due_date > assignment > created`

**同次更新合并**：一次 `updateIssue` 中的所有变更（如状态+评审人+优先级）合并为单条摘要消息，每个接收人只收一条。

**wecom_userid 缺失**：静默跳过，不写 failed 记录，避免污染失败统计（根因应通过 /members 页修复）。

### 6.5 统一通知发送服务（notification-service）

所有通知必须经过 `src/lib/notification-service.ts`：

```
sendNotification()
  → 写 notification_deliveries: pending
  → 检查配置（config_missing 短路）
  → 调用 wecom.ts（sendWecomWorkNotice / sendWecomMarkdown）
  → 更新记录为 success/failed（含 provider_response 原文）
  → 写 issue_events: notification_delivery_success/failed
```

### 6.6 错误归一化

`src/lib/notification-error.ts` 将企业微信原始错误码归一化：

| error_code | 含义 |
|------------|------|
| `invalid_userid` | 企业微信 userid 无效或用户未关注 |
| `access_token_error` | Token 失效，检查 WECOM_CORPSECRET |
| `ip_not_allowed` | 服务器 IP 未加白 |
| `rate_limited` | 接口频率限制 |
| `config_missing` | 环境变量未配置 |
| `provider_unknown_error` | 其他未归类错误 |

### 6.7 通知后台页面

路径：`/dashboard/notifications`（admin only）

功能：查看所有通知投递记录，支持按 status / channel / trigger_source / 目标用户 / 日期范围筛选；failed 记录提供"重试"按钮（最多重试5次）；分页展示。

---

## 七、Dashboard 管理指标说明

路径：`/dashboard`（admin only），数据由 `src/lib/dashboard-queries.ts` 提供，使用 admin client 确保统计口径不受 RLS 影响。

### 今日风险总览（8 个指标卡片）

| 指标 | 说明 | 定义 |
|------|------|------|
| 今日未更新 | 活跃工单今日无人工更新 | status in (in_progress/blocked/pending_review)，今日无 is_system_generated=false 的 issue_updates |
| 已逾期 | 超过截止日期未完结 | due_date < 今天，status not in (resolved/closed) |
| 阻塞中 | 当前阻塞工单 | status = blocked |
| 紧急 | 高优先级工单 | priority = urgent，status not in (resolved/closed) |
| 3天未更新 | 连续无人工活动 | last_activity_at < 3天前，status not in (resolved/closed) |
| 今日通知总量 | 今日发送通知数 | notification_deliveries.created_at 在今天 |
| 今日通知失败 | 今日 failed 记录 | status = failed |
| 今日提醒生成 | 今日新增 reminders 数 | reminders.created_at 在今天 |

### 高风险工单列表（Top 20）

按 `riskRankScore`（启发式排名分，仅用于排序，非流程规则）降序展示：

| 因素 | 加分 |
|------|------|
| priority = urgent | +4 |
| 已逾期 | +3 |
| stale（3天无人工活动） | +2 |
| blocked | +2 |
| 每7天增龄 | +1 |

展示字段：标题、状态、优先级、负责人、评审人、截止日期、距上次活动天数、风险标签。

### 成员压力榜

按 assignee 聚合展示：在办数、逾期数、3天未更新数、阻塞数、紧急数、7天人工更新次数（排除 is_system_generated=true）、最后活动时间。

### 模块 / 分类分布

按 `module` 和 `category` 分别聚合非终态工单，展示总数、逾期数、阻塞数、紧急数。`null` / 空字符串统一显示为「（未设置）」。

### 近7天趋势

日度聚合（上海时区）：新增工单数、关闭工单数、提醒生成数、通知失败数，用简单 CSS 迷你条形图展示，无需引入图表库。

### 通知链路健康

- 今日总量 / 成功数 / 失败数
- 今日失败率（%），>10% 红色告警
- 近7天失败率（%）+ 失败/总量
- 近7天错误类型 Top 5
- 最近10条失败记录（error_code / 触发来源 / 目标用户 / 时间）

---

## 八、权限模型说明

### 角色定义

| 角色 | 标识 | 说明 |
|------|------|------|
| 管理员 | `admin` | 可访问 Dashboard / 通知日志 / 成员管理 |
| 普通成员 | `member` | 可访问工单、我的任务、提醒中心 |

### 权限执行层次

权限在**三个层次**同时收口，不依赖单一入口：

1. **页面层**：Server Component 中调用 `getCurrentUser()`，`role !== "admin"` 时 `redirect("/issues")`
2. **Server Action 层**：涉及管理功能的 action（如 `getMemberWorkloadForPage`）内部校验 role
3. **数据库层（RLS）**：
   - `notification_deliveries`：仅 admin（通过 `is_admin()` 函数校验）可 SELECT
   - `issue_events`：登录用户可查看自己有权访问的工单对应的事件
   - `issues`、`issue_updates`：登录用户可读写
4. **API 层**：`/api/admin/*` 接口内部校验 admin role，Cron 接口校验 `CRON_SECRET`

### 关键说明

- 管理员通过 sidebar 不显示只是 UI 层辅助，不能替代服务端校验
- Dashboard 查询使用 `createAdminClient()`（service_role）绕过 RLS 进行统计，但页面入口已做 role 校验
- 普通用户无法直接访问 `/dashboard`、`/dashboard/notifications`、`/api/admin/*`

---

## 九、环境变量清单

| 变量名 | 必填 | 说明 |
|--------|------|------|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Supabase 项目 URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | Supabase anon key（客户端） |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Supabase service role key（服务端，绝不暴露到客户端） |
| `NEXT_PUBLIC_APP_URL` | ✅ | 部署域名（用于通知消息中生成链接），如 `https://tracker.megami-tech.com` |
| `CRON_SECRET` | 推荐 | Cron 鉴权密钥，Vercel 调用时通过 `Authorization: Bearer` 传入 |
| `WECOM_CORPID` | 通知必填 | 企业微信企业 ID |
| `WECOM_CORPSECRET` | 通知必填 | 企业微信应用 Secret |
| `WECOM_AGENTID` | 通知必填 | 企业微信应用 AgentId |
| `WECOM_WEBHOOK_URL` | 可选 | 企业微信群机器人 Webhook URL（群通知） |

> **注意**：`SUPABASE_SERVICE_ROLE_KEY` 仅在服务端（Server Action / API Route / Cron）使用，绝对不能出现在 `NEXT_PUBLIC_` 前缀变量中或暴露给浏览器。

---

## 十、Supabase Migration 执行顺序

以下迁移文件在 Supabase Dashboard → SQL Editor 中按顺序执行（均支持幂等重复执行）：

```
1. （初始）schema.sql                    ← 基础表结构（users / issues / issue_updates / reminders）
2. add_dingtalk_userid.sql              ← 历史：添加 wecom_userid 字段前置
3. add_wecom_userid.sql                 ← 添加 users.wecom_userid 字段
4. add_issue_attachments.sql            ← 添加附件支持
5. add_update_comments.sql              ← 添加进度评论支持
6. issues_update_all_authenticated.sql  ← 修复 RLS：允许登录用户更新工单
7. p0_governance.sql                    ← P0 治理字段 + issue_events + 触发器 + 索引
8. p1_notification_deliveries.sql       ← P1 通知投递日志表 + RLS
```

> **执行提示**：如果 Supabase 项目使用了 CLI 管理迁移（`supabase migration up`），请按上述顺序管理迁移文件版本号，避免重复执行。

---

## 十一、本地运行与验证步骤

### 启动开发服务

```bash
# 安装依赖
npm install  # 或 pnpm install

# 配置环境变量
cp .env.local.example .env.local
# 填写 Supabase URL / keys / 企业微信配置

# 执行数据库迁移（Supabase Dashboard SQL Editor 按第十节顺序执行）

# 启动开发服务
npm run dev
```

### 核心功能验证路径

```bash
# 1. 登录验证
#    访问 /login → 邮箱登录或企业微信扫码

# 2. 工单 CRUD
#    /issues → 新建工单 → 填写 assignee/reviewer/priority/due_date
#    → 编辑工单 → 尝试违规状态跳转（如不填 blocked_reason 切换到 blocked）
#    → 应被服务端拦截并返回错误

# 3. 状态机验证
#    → todo→blocked（不填原因）：被拒
#    → in_progress→pending_review（无进度更新）：被拒
#    → in_progress→pending_review（有进度更新）：通过
#    → closed→in_progress：reopen_count +1（只加一次）

# 4. 提醒中心
#    /reminders → 查看提醒 → 按类型筛选 → 批量标记已读

# 5. Cron 手动触发验证
curl -H "Authorization: Bearer YOUR_CRON_SECRET" \
  http://localhost:3000/api/cron/daily-reminder

# 6. Dashboard（admin 账号）
#    /dashboard → 确认6个板块全部渲染
#    → 点击风险卡片 → 跳转 /issues?risk=overdue 等

# 7. 通知日志后台（admin）
#    /dashboard/notifications → 查看投递记录 → 按来源筛选
#    → failed 记录点"重试"按钮 → 确认 attempt_count 递增

# 8. 成员管理
#    /members → 企业微信配置 Tab → 填写 wecom_userid
#    → 成员负载 Tab → 查看工作负载统计

# 9. 事件驱动通知验证（需企业微信配置完整）
#    → 创建工单指定 assignee：assignee 收到"新工单已分配"
#    → 10分钟内再次更新：触发防抖，不重复推送
#    → 状态→blocked：assignee + reviewer 收通知
#    → 优先级→urgent：assignee + reviewer 收通知
```

---

## 十二、上线检查清单

### 必做项

- [ ] Supabase 数据库迁移按顺序全部执行完毕
- [ ] 所有必填环境变量已配置（`NEXT_PUBLIC_SUPABASE_URL` / `ANON_KEY` / `SERVICE_ROLE_KEY` / `APP_URL`）
- [ ] `SUPABASE_SERVICE_ROLE_KEY` 确认未出现在任何 `NEXT_PUBLIC_` 变量中
- [ ] `CRON_SECRET` 已设置，Vercel Cron 配置中已同步
- [ ] Vercel `vercel.json` 中 Cron 时间配置正确（时区为 UTC，上海时间需换算）
- [ ] 企业微信应用消息已配置（CORPID / CORPSECRET / AGENTID），发送测试通过
- [ ] 企业微信 IP 白名单已添加 Vercel 出站 IP（或使用固定 IP 代理）
- [ ] 所有成员的 `wecom_userid` 已填写（`/members` 页确认）
- [ ] `NEXT_PUBLIC_APP_URL` 设为生产域名（通知消息中链接生效）
- [ ] admin 账号至少一个，role = admin 已在数据库中设置

### 推荐检查项

- [ ] 手动触发 daily-reminder Cron，确认 reminders 写入、通知发出、notification_deliveries 有记录
- [ ] 访问 `/dashboard`，确认所有板块数据正常（无空白无报错）
- [ ] 触发一条失败通知（如临时填错 userid），确认 `/dashboard/notifications` 能看到 failed 记录并重试
- [ ] 普通成员账号验证：无法访问 `/dashboard`、`/dashboard/notifications`、`/members`（admin 功能）
- [ ] `is_admin()` PostgreSQL 函数存在且正确（`notification_deliveries` RLS 依赖此函数）

---

## 十三、后续可迭代方向

以下均为**后续建议**，当前代码库中未实现：

### 短期（低成本高价值）

| 方向 | 说明 |
|------|------|
| 通知频率配置 | 当前防抖固定10分钟，可做成可配置（per-user 或全局） |
| 成员级通知不可达聚合 | 长期无 wecom_userid 的成员，在 Dashboard 醒目提示+统计 |
| 管理员 resolved/closed 通知控制 | 当前所有 resolved/closed 都通知管理员，可增加开关 |
| per-recipient 消息裁剪 | 当前所有接收人收同一摘要，未来可针对角色差异化内容（如评审人消息更突出"请验证"） |

### 中期

| 方向 | 说明 |
|------|------|
| 通知订阅配置 | 成员可自行选择接收哪些事件类型的通知 |
| 工单 SLA 监控 | 基于 due_date 和 last_activity_at 建立 SLA 预警 |
| 批量工单操作 | 在工单列表支持批量更改状态、批量指派 |
| 企业微信机器人指令扩展 | 当前支持 Excel 导入，可扩展状态查询、快速更新等指令 |
| 通知模板管理 | 管理员可配置各类事件的通知文案模板 |

### 长期

| 方向 | 说明 |
|------|------|
| 多团队 / 多项目隔离 | 当前所有工单在同一空间，可引入 team/project 维度 |
| 工单关联与依赖 | 支持工单间的 blocking / blocked-by 关系 |
| 历史趋势报表 | 超过7天的长期趋势，支持导出 |
| 移动端适配 | 当前以桌面端为主，响应式布局可进一步优化 |
| 消息队列引入 | 当前通知为同步/fire-and-forget，高并发场景可引入轻量队列（如 Upstash QStash） |

---

*文档生成时间：2026-03-25*  
*基于代码库真实实现整理，标注「后续建议」的部分为迭代方向，当前代码中未实现。*
