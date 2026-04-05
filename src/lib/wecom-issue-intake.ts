import { chatCompletionFromMessages, isAIConfigured } from "@/lib/ai";
import { getIssueDetailUrl } from "@/lib/app-url";
import {
  ISSUE_CATEGORIES,
  ISSUE_MODULES,
  ISSUE_PRIORITY_LABELS,
  isIssueCategory,
  isIssueModule,
} from "@/lib/constants";
import { dispatchEventNotifications } from "@/lib/event-notification";
import { writeIssueEvent } from "@/lib/issue-events";
import { createAdminClient } from "@/lib/supabase/admin";
import type { IssuePriority, UserRole } from "@/types";

export type IssueDraftData = {
  title: string | null;
  description: string | null;
  priority: IssuePriority | null;
  due_date: string | null;
  category: string | null;
  module: string | null;
  assignee_name: string | null;
};

type IssueCollectionResult = {
  action: "continue" | "cancel";
  draft: IssueDraftData;
  ready: boolean;
  nextQuestion: string;
};

type CreatorProfile = {
  id: string;
  role: UserRole;
  name: string;
};

type CreateIssueResult =
  | { ok: true; reply: string }
  | { ok: false; reply: string; keepDraft: boolean };

const ISSUE_DRAFT_TABLE = "wecom_robot_issue_drafts";
const DUE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function emptyIssueDraft(): IssueDraftData {
  return {
    title: null,
    description: null,
    priority: null,
    due_date: null,
    category: null,
    module: null,
    assignee_name: null,
  };
}

function normalizeNullableText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeDueDate(value: unknown): string | null {
  const text = normalizeNullableText(value);
  return text && DUE_DATE_RE.test(text) ? text : null;
}

function isIssuePriorityValue(value: unknown): value is IssuePriority {
  return value === "low" || value === "medium" || value === "high" || value === "urgent";
}

function normalizeIssueDraft(raw: unknown): IssueDraftData {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const category = normalizeNullableText(record.category);
  const moduleName = normalizeNullableText(record.module);

  return {
    title: normalizeNullableText(record.title),
    description: normalizeNullableText(record.description),
    priority: isIssuePriorityValue(record.priority) ? record.priority : null,
    due_date: normalizeDueDate(record.due_date),
    category: category && isIssueCategory(category) ? category : null,
    module: moduleName && isIssueModule(moduleName) ? moduleName : null,
    assignee_name: normalizeNullableText(record.assignee_name),
  };
}

function cleanJsonResponse(raw: string): string {
  return raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
}

function buildInitialPrompt(): string {
  return [
    "好的，我来帮你新建问题。",
    "",
    "先告诉我问题标题；如果你已经整理好了，也可以一次性把现象、影响范围、期望完成时间、希望谁跟进一起发给我。",
  ].join("\n");
}

function buildFallbackCollectionResult(draft: IssueDraftData, message: string): IssueCollectionResult {
  const trimmed = message.trim();
  const nextDraft = { ...draft };

  if (!nextDraft.title) {
    nextDraft.title = trimmed.slice(0, 80);
    if (trimmed.length > 30 || /[\n，。；;]/.test(trimmed)) {
      nextDraft.description = trimmed;
      return {
        action: "continue",
        draft: nextDraft,
        ready: true,
        nextQuestion: "",
      };
    }
    return {
      action: "continue",
      draft: nextDraft,
      ready: false,
      nextQuestion: "我先记下标题了。请再补充一下现象、影响范围或复现方式，我收齐后就直接帮你建问题。",
    };
  }

  if (!nextDraft.description) {
    nextDraft.description = trimmed;
    return {
      action: "continue",
      draft: nextDraft,
      ready: true,
      nextQuestion: "",
    };
  }

  nextDraft.description = `${nextDraft.description}\n${trimmed}`.trim();
  return {
    action: "continue",
    draft: nextDraft,
    ready: true,
    nextQuestion: "",
  };
}

async function collectIssueDraft(draft: IssueDraftData, userMessage: string): Promise<IssueCollectionResult> {
  if (!isAIConfigured()) {
    return buildFallbackCollectionResult(draft, userMessage);
  }

  const systemPrompt = [
    "你是内部问题系统的建单助手，负责把用户自然语言整理成可直接落库的 issue 草稿。",
    `今天日期：${new Date().toISOString().slice(0, 10)}`,
    "",
    "规则：",
    "1. 你会拿到当前草稿和用户最新一句话，请输出合并后的完整草稿。",
    "2. 只要已经有明确标题，并且描述足以让处理人理解现象、背景、影响或期望结果，就可以 ready=true。",
    "3. 如果信息还不够，ready=false，并只追问一个最关键的问题。",
    "4. 如果用户明确表达取消、算了、不建了，action=cancel。",
    "5. 只有用户明确指定负责人时，才填写 assignee_name；否则保留 null。",
    "6. 允许把相对日期转成 YYYY-MM-DD；无法确定就填 null。",
    "7. priority 只能是 low / medium / high / urgent 或 null。",
    `8. category 只能从这些值里选：${ISSUE_CATEGORIES.join("、")}；不确定就 null。`,
    `9. module 只能从这些值里选：${ISSUE_MODULES.join("、")}；不确定就 null。`,
    "10. next_question 必须是简洁中文，ready=true 时返回空字符串。",
    "11. 严格只返回 JSON，不要 markdown，不要解释。",
    "",
    "JSON 格式：",
    '{"action":"continue|cancel","ready":true,"next_question":"","draft":{"title":null,"description":null,"priority":null,"due_date":null,"category":null,"module":null,"assignee_name":null}}',
  ].join("\n");

  const result = await chatCompletionFromMessages(
    [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          "当前草稿：",
          JSON.stringify(draft, null, 2),
          "",
          "用户最新消息：",
          userMessage.trim(),
        ].join("\n"),
      },
    ],
    {
      maxTokens: 700,
      disableThinking: true,
    }
  );

  if (!result) {
    return buildFallbackCollectionResult(draft, userMessage);
  }

  try {
    const parsed = JSON.parse(cleanJsonResponse(result)) as {
      action?: unknown;
      ready?: unknown;
      next_question?: unknown;
      draft?: unknown;
    };

    const nextDraft = normalizeIssueDraft(parsed.draft);
    const ready = Boolean(parsed.ready) && Boolean(nextDraft.title);
    const action = parsed.action === "cancel" ? "cancel" : "continue";
    const nextQuestion = typeof parsed.next_question === "string" ? parsed.next_question.trim() : "";

    return {
      action,
      draft: nextDraft,
      ready,
      nextQuestion: ready
        ? ""
        : nextQuestion || "请再补充一下这个问题的现象、影响范围或预期结果，我收齐后就直接帮你建问题。",
    };
  } catch (error) {
    console.error("[wecom-issue-intake] parse AI draft failed:", error);
    return buildFallbackCollectionResult(draft, userMessage);
  }
}

async function loadIssueDraft(wecomUserid: string): Promise<IssueDraftData | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from(ISSUE_DRAFT_TABLE)
    .select("draft")
    .eq("wecom_userid", wecomUserid)
    .maybeSingle();

  if (error) {
    console.error("[wecom-issue-intake] load draft failed:", error.message);
    return null;
  }

  if (!data) return null;
  return normalizeIssueDraft((data as { draft?: unknown }).draft);
}

async function saveIssueDraft(wecomUserid: string, draft: IssueDraftData) {
  const supabase = createAdminClient();
  const { error } = await supabase.from(ISSUE_DRAFT_TABLE).upsert(
    {
      wecom_userid: wecomUserid,
      draft,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "wecom_userid" }
  );

  if (error) {
    throw new Error(error.message);
  }
}

export async function hasActiveIssueDraft(wecomUserid: string): Promise<boolean> {
  const draft = await loadIssueDraft(wecomUserid);
  return Boolean(draft);
}

export async function cancelIssueDraft(wecomUserid: string): Promise<boolean> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from(ISSUE_DRAFT_TABLE)
    .delete()
    .eq("wecom_userid", wecomUserid)
    .select("id");
  if (error) {
    console.error("[wecom-issue-intake] cancel draft failed:", error.message);
    return false;
  }
  return (data?.length ?? 0) > 0;
}

async function findCreatorProfile(wecomUserid: string): Promise<CreatorProfile | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("users")
    .select("id, role, name")
    .eq("wecom_userid", wecomUserid)
    .maybeSingle();

  if (error) {
    console.error("[wecom-issue-intake] load creator failed:", error.message);
    return null;
  }

  if (!data?.id || !data?.role || !data?.name) return null;

  return {
    id: data.id as string,
    role: data.role as UserRole,
    name: data.name as string,
  };
}

async function findUserByName(name: string): Promise<{ id: string; name: string } | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("users")
    .select("id, name")
    .eq("name", trimmed)
    .limit(2);

  if (error) {
    console.error("[wecom-issue-intake] lookup assignee failed:", error.message);
    return null;
  }

  if (!data?.length) return null;
  if (data.length > 1) return null;

  return {
    id: data[0].id as string,
    name: data[0].name as string,
  };
}

async function getDefaultReviewerId(): Promise<string | null> {
  const supabase = createAdminClient();
  const { data: admins, error } = await supabase
    .from("users")
    .select("id, name, email")
    .eq("role", "admin");

  if (error || !admins?.length) return null;

  const scored = admins
    .map((row) => {
      const name = String(row.name ?? "").trim().toLowerCase();
      const email = String(row.email ?? "").trim().toLowerCase();
      let score = 0;

      if (name === "郝毅") score += 100;
      else if (name.includes("郝毅")) score += 80;

      if (email.startsWith("haoyi@")) score += 60;
      else if (email.includes("haoyi")) score += 40;

      return { id: row.id as string, score };
    })
    .sort((a, b) => b.score - a.score);

  return scored[0]?.id ?? null;
}

async function createIssueFromDraft(
  wecomUserid: string,
  draft: IssueDraftData
): Promise<CreateIssueResult> {
  const creator = await findCreatorProfile(wecomUserid);
  if (!creator) {
    return {
      ok: false,
      keepDraft: true,
      reply: "你的企业微信账号还没有绑定到问题系统成员，暂时无法直接新建问题。请先在系统里完成绑定后再试。",
    };
  }

  const supabase = createAdminClient();
  let assigneeId: string | null = null;
  let assigneeName = "未指定";
  let permissionNote = "";

  if (creator.role === "admin") {
    if (draft.assignee_name) {
      const assignee = await findUserByName(draft.assignee_name);
      if (!assignee) {
        return {
          ok: false,
          keepDraft: true,
          reply: `没有找到名为「${draft.assignee_name}」的成员。请直接回复准确姓名，或者回复“不指定负责人”。`,
        };
      }
      assigneeId = assignee.id;
      assigneeName = assignee.name;
    }
  } else {
    assigneeId = creator.id;
    assigneeName = creator.name;
    if (draft.assignee_name && draft.assignee_name.trim() !== creator.name.trim()) {
      permissionNote = "\n\n说明：当前通过私聊创建的问题会默认指派给你自己，如需改负责人请让管理员调整。";
    }
  }

  const insertData: Record<string, unknown> = {
    title: draft.title,
    description: draft.description ?? null,
    priority: draft.priority ?? "medium",
    assignee_id: assigneeId,
    due_date: draft.due_date ?? null,
    status: "todo",
    creator_id: creator.id,
    parent_issue_id: null,
  };

  const { error: probeErr } = await supabase
    .from("issues")
    .select("category, module, source, reviewer_id")
    .limit(0);

  let reviewerId: string | null = null;
  if (!probeErr) {
    reviewerId = await getDefaultReviewerId();
    insertData.category = draft.category ?? null;
    insertData.module = draft.module ?? null;
    insertData.source = "webhook";
    insertData.reviewer_id = reviewerId;
  }

  const { data, error } = await supabase
    .from("issues")
    .insert(insertData)
    .select("id")
    .single();

  if (error || !data?.id) {
    return {
      ok: false,
      keepDraft: true,
      reply: `新建问题失败：${error?.message ?? "数据库未返回问题 ID"}`,
    };
  }

  const issueId = data.id as string;
  const priority = (insertData.priority as IssuePriority) ?? "medium";

  await writeIssueEvent(supabase, {
    issueId,
    actorId: creator.id,
    eventType: "issue_created",
    payload: {
      title: draft.title,
      priority,
      assignee_id: assigneeId,
      status: "todo",
      parent_issue_id: null,
      via: "wecom_robot",
    },
  });

  dispatchEventNotifications({
    issueId,
    issueTitle: draft.title ?? "未命名问题",
    actorId: creator.id,
    actorName: creator.name,
    assigneeId,
    reviewerId,
    creatorId: creator.id,
    changes: [{ type: "issue_created" }],
  });

  const detailUrl = getIssueDetailUrl(issueId);
  return {
    ok: true,
    reply: [
      "## 已创建问题",
      "",
      `标题：${draft.title}`,
      `优先级：${ISSUE_PRIORITY_LABELS[priority]}`,
      `负责人：${assigneeName}`,
      draft.due_date ? `截止日期：${draft.due_date}` : null,
      detailUrl ? `查看问题：${detailUrl}` : null,
      permissionNote || null,
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

export async function startIssueDraftFlow(wecomUserid: string, initialInput?: string): Promise<string> {
  await cancelIssueDraft(wecomUserid);

  const firstInput = initialInput?.trim();
  if (firstInput) {
    return continueIssueDraftFlow(wecomUserid, firstInput);
  }

  await saveIssueDraft(wecomUserid, emptyIssueDraft());
  return buildInitialPrompt();
}

export async function continueIssueDraftFlow(wecomUserid: string, userMessage: string): Promise<string> {
  const currentDraft = (await loadIssueDraft(wecomUserid)) ?? emptyIssueDraft();
  const collection = await collectIssueDraft(currentDraft, userMessage);

  if (collection.action === "cancel") {
    await cancelIssueDraft(wecomUserid);
    return "好的，已取消这次新建问题。你之后再发“新建问题”就可以重新开始。";
  }

  if (!collection.ready || !collection.draft.title) {
    await saveIssueDraft(wecomUserid, collection.draft);
    return collection.nextQuestion;
  }

  const createResult = await createIssueFromDraft(wecomUserid, collection.draft);
  if (!createResult.ok) {
    if (createResult.keepDraft) {
      await saveIssueDraft(wecomUserid, collection.draft);
    } else {
      await cancelIssueDraft(wecomUserid);
    }
    return createResult.reply;
  }

  await cancelIssueDraft(wecomUserid);
  return createResult.reply;
}
