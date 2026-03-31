export type IssueStatus =
  | "todo"
  | "in_progress"
  | "blocked"
  | "pending_review"
  | "resolved"
  | "closed";

export type IssuePriority = "low" | "medium" | "high" | "urgent";

export type UserRole = "admin" | "member";

export type ReminderType = "no_update_today" | "overdue" | "stale_3_days";

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
  | "issue_closed";

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  avatar_url: string | null;
  wecom_userid: string | null;
  created_at: string;
  updated_at: string;
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
  actor?: Pick<User, "id" | "name"> | null;
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

export interface IssueWithRelations extends Issue {
  assignee?: User | null;
  reviewer?: User | null;
  creator?: User | null;
  issue_updates?: IssueUpdate[];
  last_update?: IssueUpdate | null;
  attachments?: IssueAttachmentWithUrl[];
  attachmentCount?: number;
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
}

// ---------------------------------------------------------------------------
// 通知投递日志
// ---------------------------------------------------------------------------

export type NotificationChannel = "wecom_app" | "wecom_bot";

export type NotificationStatus = "pending" | "success" | "failed";

export type NotificationTriggerSource =
  | "cron_morning"
  | "cron_admin"
  | "cron_daily"
  | "issue_event"          // 旧版兼容（P1 遗留记录）
  | "issue_event.status"   // P3: 状态变更（blocked/pending_review/resolved/closed/reopened）
  | "issue_event.priority" // P3: 优先级提升为紧急
  | "issue_event.due_date" // P3: 截止日期提前
  | "issue_event.assignment" // P3: 负责人/评审人变更
  | "issue_event.created"  // P3: 工单创建
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
