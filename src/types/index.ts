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

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  avatar_url: string | null;
  dingtalk_userid: string | null;
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
  creator_id: string;
  due_date: string | null;
  resolved_at: string | null;
  closed_at: string | null;
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
  created_at: string;
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
  creator?: User | null;
  issue_updates?: IssueUpdate[];
  last_update?: IssueUpdate | null;
}

export interface IssueUpdateWithUser extends IssueUpdate {
  user?: User | null;
}

export interface ReminderWithIssue extends Reminder {
  issue?: Issue | null;
}
