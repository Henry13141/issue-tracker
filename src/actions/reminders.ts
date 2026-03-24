"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import type { ReminderWithIssue } from "@/types";

const reminderSelect = `
  *,
  issue:issues!reminders_issue_id_fkey(id, title, status, priority, assignee_id)
`;

export async function getMyReminders(): Promise<ReminderWithIssue[]> {
  const user = await getCurrentUser();
  if (!user) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("reminders")
    .select(reminderSelect)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    return [];
  }
  return (data ?? []) as ReminderWithIssue[];
}

export async function getAllRemindersForAdmin(): Promise<ReminderWithIssue[]> {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("reminders")
    .select(
      `
      *,
      issue:issues!reminders_issue_id_fkey(id, title, status, priority, assignee_id)
    `
    )
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error(error);
    return [];
  }
  return (data ?? []) as ReminderWithIssue[];
}

export async function markReminderRead(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("reminders").update({ is_read: true }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/reminders");
}

export async function markAllRemindersRead() {
  const user = await getCurrentUser();
  if (!user) return;

  const supabase = await createClient();
  const { error } = await supabase
    .from("reminders")
    .update({ is_read: true })
    .eq("user_id", user.id)
    .eq("is_read", false);

  if (error) throw new Error(error.message);
  revalidatePath("/reminders");
}
