export type IssueStatus =
  | "todo"
  | "in_progress"
  | "blocked"
  | "pending_review"
  | "resolved"
  | "closed";

export type IssuePriority = "low" | "medium" | "high" | "urgent";

export type UserRole = "admin" | "finance" | "member";

export type ReminderType = "no_update_today" | "overdue" | "stale_3_days";

export type FinanceTaskCadence = "weekly" | "monthly" | "quarterly" | "yearly";

export type FinanceTaskArea = "finance" | "cashier" | "admin_hr" | "other";

export type FinanceTaskSource = "template" | "manual";

export type FinanceTaskInstanceStatus = "pending" | "in_progress" | "completed" | "skipped";

export type FinanceTaskDisplayStatus = FinanceTaskInstanceStatus | "overdue";

export type PettyCashExpenseProject =
  | "admin_procurement_invoice"
  | "office_supplies_invoice"
  | "employee_benefits_invoice"
  | "hospitality_replacement"
  | "logistics_invoice"
  | "travel_mixed"
  | "maintenance_mixed"
  | "other";

export type PettyCashPaymentMethod = "wechat" | "alipay" | "bank_transfer" | "cash" | "other";

export type PettyCashInvoiceAvailability = "with_invoice" | "without_invoice";

export type PettyCashInvoiceReplacementStatus = "not_needed" | "pending";

export type PettyCashInvoiceCollectedStatus = "not_received" | "received";

export type PettyCashReimbursementStatus = "pending" | "in_progress" | "reimbursed" | "voided";

export type IssueUpdateType =
  | "comment"
  | "status_change"
  | "system_reminder"
  | "assignment"
  | "due_date_change"
  | "priority_change";

export type IssueEventType =
  | "issue_created"
  | "issue_updated"
  | "assignee_changed"
  | "reviewer_changed"
  | "status_changed"
  | "priority_changed"
  | "due_date_changed"
  | "reminder_created"
  | "reminder_sent"
  | "notification_delivery_success"
  | "notification_delivery_failed"
  | "issue_reopened"
  | "issue_closed"
  | "handover"
  | "handover_return";

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  avatar_url: string | null;
  wecom_userid: string | null;
  can_access_finance_ops: boolean;
  created_at: string;
  updated_at: string;
}

export interface FinanceTaskTemplate {
  id: string;
  title: string;
  description: string | null;
  area: FinanceTaskArea;
  cadence: FinanceTaskCadence;
  due_weekday: number | null;
  due_day: number;
  due_month_in_quarter: number | null;
  due_month: number | null;
  owner_user_id: string | null;
  is_active: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface FinanceTaskTemplateWithOwner extends FinanceTaskTemplate {
  owner?: Pick<User, "id" | "name" | "avatar_url"> | null;
  creator?: Pick<User, "id" | "name"> | null;
}

export interface FinanceTaskInstance {
  id: string;
  template_id: string | null;
  title: string;
  description: string | null;
  area: FinanceTaskArea;
  source: FinanceTaskSource;
  period_key: string;
  period_start: string;
  period_end: string;
  due_date: string;
  owner_user_id: string | null;
  status: FinanceTaskInstanceStatus;
  notes: string | null;
  completed_at: string | null;
  completed_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface FinanceTaskInstanceWithTemplate extends FinanceTaskInstance {
  owner?: Pick<User, "id" | "name" | "avatar_url"> | null;
  completed_by_user?: Pick<User, "id" | "name"> | null;
  template?: FinanceTaskTemplateWithOwner | null;
  display_status?: FinanceTaskDisplayStatus;
  is_overdue?: boolean;
  period_label?: string;
}

export interface PettyCashEntry {
  id: string;
  occurred_on: string;
  payer_user_id: string;
  title: string;
  expense_project: PettyCashExpenseProject;
  amount_minor: number;
  currency: "CNY";
  payment_method: PettyCashPaymentMethod;
  invoice_availability: PettyCashInvoiceAvailability;
  invoice_replacement_status: PettyCashInvoiceReplacementStatus;
  invoice_collected_status: PettyCashInvoiceCollectedStatus;
  reimbursement_status: PettyCashReimbursementStatus;
  reimbursed_on: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface PettyCashEntryWithRelations extends PettyCashEntry {
  payer?: Pick<User, "id" | "name" | "avatar_url"> | null;
  creator?: Pick<User, "id" | "name"> | null;
}

export interface Issue {
  id: string;
  title: string;
  description: string | null;
  status: IssueStatus;
  priority: IssuePriority;
  assignee_id: string | null;
  reviewer_id: string | null;
  creator_id: string;
  parent_issue_id: string | null;
  due_date: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  category: string | null;
  module: string | null;
  source: string;
  blocked_reason: string | null;
  closed_reason: string | null;
  reopen_count: number;
  last_activity_at: string;
  created_at: string;
  updated_at: string;
  /** 生成列：列表排序用，true 表示已解决/已关闭（见迁移 add_issues_list_terminal_sort.sql） */
  is_list_terminal?: boolean;
}

export interface IssueUpdate {
  id: string;
  issue_id: string;
  user_id: string;
  content: string;
  status_from: IssueStatus | null;
  status_to: IssueStatus | null;
  update_type: IssueUpdateType;
  is_system_generated: boolean;
  created_at: string;
}

export interface IssueEvent {
  id: string;
  issue_id: string;
  actor_id: string | null;
  event_type: IssueEventType;
  event_payload: Record<string, unknown>;
  created_at: string;
}

export interface IssueEventWithActor extends IssueEvent {
  actor?: Pick<User, "id" | "name" | "avatar_url"> | null;
}

export interface Reminder {
  id: string;
  issue_id: string;
  user_id: string;
  type: ReminderType;
  message: string | null;
  is_read: boolean;
  created_at: string;
}

export type IssueSummary = Pick<Issue, "id" | "title" | "description" | "status" | "priority" | "assignee_id" | "due_date"> & {
  assignee?: Pick<User, "id" | "name" | "avatar_url"> | null;
};

export interface IssueWithRelations extends Issue {
  assignee?: User | null;
  reviewer?: User | null;
  creator?: User | null;
  issue_updates?: IssueUpdate[];
  last_update?: IssueUpdate | null;
  attachments?: IssueAttachmentWithUrl[];
  attachmentCount?: number;
  parent?: Pick<Issue, "id" | "title" | "status" | "priority"> | null;
  children?: IssueSummary[];
  handovers?: IssueHandoverWithUsers[];
  participants?: IssueParticipant[];
}

// ---------------------------------------------------------------------------
// 交接/返工闭环
// ---------------------------------------------------------------------------

export type HandoverKind = "handover" | "return";
export type HandoverStatus = "active" | "returned" | "completed";
export type ParticipantRole = "creator" | "assignee" | "reviewer" | "handover_from" | "watcher";

export interface IssueHandover {
  id: string;
  issue_id: string;
  from_user_id: string;
  to_user_id: string;
  kind: HandoverKind;
  note: string | null;
  attachment_names: string[] | null;
  status: HandoverStatus;
  created_at: string;
}

export interface IssueHandoverWithUsers extends IssueHandover {
  from_user?: Pick<User, "id" | "name"> | null;
  to_user?: Pick<User, "id" | "name"> | null;
}

export interface IssueParticipant {
  id: string;
  issue_id: string;
  user_id: string;
  role: ParticipantRole;
  active: boolean;
  created_at: string;
  updated_at: string;
  user?: Pick<User, "id" | "name"> | null;
}

export interface UpdateComment {
  id: string;
  update_id: string;
  user_id: string;
  content: string;
  created_at: string;
}

export interface UpdateCommentWithUser extends UpdateComment {
  user?: User | null;
}

export interface IssueUpdateWithUser extends IssueUpdate {
  user?: User | null;
  comments?: UpdateCommentWithUser[];
  attachments?: IssueAttachmentWithUrl[];
}

export interface ReminderWithIssue extends Reminder {
  issue?: Issue | null;
}

export interface IssueAttachment {
  id: string;
  issue_id: string;
  issue_update_id: string | null;
  storage_path: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  uploaded_by: string;
  created_at: string;
}

export interface IssueAttachmentWithUrl extends IssueAttachment {
  url?: string;
  source_subtask_index?: number | null;
  source_subtask_title?: string | null;
}

// ---------------------------------------------------------------------------
// 通知投递日志
// ---------------------------------------------------------------------------

export type NotificationChannel = "wecom_app" | "wecom_bot";

export type NotificationStatus = "pending" | "success" | "failed";

export type NotificationTriggerSource =
  | "lifecycle_welcome"    // 新成员欢迎消息
  | "cron_morning"
  | "cron_admin"
  | "cron_daily"
  | "cron_week_preview"    // 周日晚间群内「下周待继续」汇总
  | "issue_event"          // 旧版兼容（P1 遗留记录）
  | "issue_event.status"   // 状态变更（blocked/pending_review/resolved/closed/reopened）
  | "issue_event.priority" // 优先级提升为紧急
  | "issue_event.due_date" // 截止日期提前
  | "issue_event.assignment" // 负责人/评审人变更
  | "issue_event.handover" // 任务交接
  | "issue_event.return"   // 返工退回
  | "issue_event.created"  // 工单创建
  | "issue_event.progress" // 进度更新通知
  | "manual_test";

export interface NotificationDelivery {
  id: string;
  channel: NotificationChannel;
  target_user_id: string | null;
  target_wecom_userid: string | null;
  issue_id: string | null;
  reminder_id: string | null;
  trigger_source: NotificationTriggerSource | string;
  title: string | null;
  content: string;
  provider_message_id: string | null;
  provider_response: Record<string, unknown>;
  status: NotificationStatus;
  error_code: string | null;
  error_message: string | null;
  attempt_count: number;
  created_at: string;
  sent_at: string | null;
}

export interface NotificationDeliveryWithRelations extends NotificationDelivery {
  target_user?: Pick<User, "id" | "name"> | null;
  issue?: Pick<Issue, "id" | "title"> | null;
}
