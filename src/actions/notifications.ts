"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth";
import type { NotificationDeliveryWithRelations } from "@/types";

const PAGE_SIZE = 20;

export type NotificationFilters = {
  status?: string;
  channel?: string;
  triggerSource?: string;
  targetUserId?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
};

export type NotificationListResult = {
  data: NotificationDeliveryWithRelations[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  error?: string;
};

/** 查询通知投递记录（仅 admin） */
export async function getNotificationDeliveries(
  filters: NotificationFilters = {}
): Promise<NotificationListResult> {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return { data: [], total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 0 };
  }

  const supabase = createAdminClient();
  const page = Math.max(1, filters.page ?? 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let query = supabase
    .from("notification_deliveries")
    .select(
      `
      *,
      target_user:users!notification_deliveries_target_user_id_fkey(id, name),
      issue:issues!notification_deliveries_issue_id_fkey(id, title)
      `,
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .range(from, to);

  if (filters.status) {
    query = query.eq("status", filters.status);
  }
  if (filters.channel) {
    query = query.eq("channel", filters.channel);
  }
  if (filters.triggerSource) {
    query = query.eq("trigger_source", filters.triggerSource);
  }
  if (filters.targetUserId) {
    query = query.eq("target_user_id", filters.targetUserId);
  }
  if (filters.dateFrom) {
    query = query.gte("created_at", filters.dateFrom);
  }
  if (filters.dateTo) {
    // dateTo 是日期字符串，加 1 天的时间边界
    const dateToEnd = new Date(filters.dateTo);
    dateToEnd.setDate(dateToEnd.getDate() + 1);
    query = query.lt("created_at", dateToEnd.toISOString());
  }

  const { data, error, count } = await query;

  if (error) {
    console.error("[notifications] query failed:", error.message);
    return {
      data: [],
      total: 0,
      page,
      pageSize: PAGE_SIZE,
      totalPages: 0,
      error: error.message,
    };
  }

  const total = count ?? 0;
  return {
    data: (data ?? []) as NotificationDeliveryWithRelations[],
    total,
    page,
    pageSize: PAGE_SIZE,
    totalPages: Math.ceil(total / PAGE_SIZE),
  };
}
