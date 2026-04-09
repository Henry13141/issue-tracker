import { createAdminClient } from "@/lib/supabase/admin";
import type { SeedanceContentItem } from "@/lib/ark-seedance";

/** 从提交给方舟的 content 中提取用于展示的文本提示词（多段 text 拼接）。 */
export function extractPromptTextFromContent(content: SeedanceContentItem[]): string {
  const parts = content
    .filter((item): item is { type: "text"; text: string } => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text.trim())
    .filter(Boolean);
  return parts.join("\n\n");
}

export async function upsertSeedanceTaskPrompt(params: {
  taskId: string;
  promptText: string;
  createdByUserId: string;
}): Promise<void> {
  const { taskId, promptText, createdByUserId } = params;
  if (!taskId.trim()) return;

  const supabase = createAdminClient();
  const now = new Date().toISOString();
  const { error } = await supabase.from("seedance_task_prompts").upsert(
    {
      task_id: taskId.trim(),
      prompt_text: promptText,
      created_by: createdByUserId,
      updated_at: now,
    },
    { onConflict: "task_id" }
  );

  if (error) {
    console.error("[seedance_task_prompts] upsert failed", error);
  }
}

export async function fetchSeedanceTaskPromptsByTaskIds(
  taskIds: string[]
): Promise<Record<string, string>> {
  const ids = [...new Set(taskIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return {};

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("seedance_task_prompts")
    .select("task_id, prompt_text")
    .in("task_id", ids);

  if (error) {
    console.error("[seedance_task_prompts] fetch failed", error);
    return {};
  }

  const map: Record<string, string> = {};
  for (const row of data ?? []) {
    const id = row.task_id as string;
    const text = typeof row.prompt_text === "string" ? row.prompt_text : "";
    if (id) map[id] = text;
  }
  return map;
}

export async function fetchSeedanceTaskPrompt(taskId: string): Promise<string | null> {
  const id = taskId.trim();
  if (!id) return null;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("seedance_task_prompts")
    .select("prompt_text")
    .eq("task_id", id)
    .maybeSingle();

  if (error) {
    console.error("[seedance_task_prompts] fetch one failed", error);
    return null;
  }
  if (!data || typeof data.prompt_text !== "string") return null;
  return data.prompt_text;
}
