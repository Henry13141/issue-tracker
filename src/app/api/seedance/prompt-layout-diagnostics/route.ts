import { NextResponse } from "next/server";

type DiagnosticBody = {
  trigger?: unknown;
  page?: unknown;
  clientSessionId?: unknown;
  snapshot?: unknown;
};

type Snapshot = {
  promptLength: number;
  selectionStart: number;
  selectionEnd: number;
  mentionCountBeforeCursor: number;
  latestMentionKind: string | null;
  hasVerticalScrollbar: boolean;
  textareaScrollbarWidth: number;
  textareaClientWidth: number;
  textareaScrollWidth: number;
  overlayContainerClientWidth: number;
  overlayContentClientWidth: number;
  widthMismatch: number;
  textRendering: string;
  overlayTextRendering: string;
};

function toFiniteNumber(value: unknown) {
  const next = Number(value);
  return Number.isFinite(next) ? next : 0;
}

function normalizeSnapshot(value: unknown): Snapshot | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return {
    promptLength: Math.max(0, Math.round(toFiniteNumber(record.promptLength))),
    selectionStart: Math.max(0, Math.round(toFiniteNumber(record.selectionStart))),
    selectionEnd: Math.max(0, Math.round(toFiniteNumber(record.selectionEnd))),
    mentionCountBeforeCursor: Math.max(0, Math.round(toFiniteNumber(record.mentionCountBeforeCursor))),
    latestMentionKind:
      record.latestMentionKind === "image" ||
      record.latestMentionKind === "video" ||
      record.latestMentionKind === "audio"
        ? record.latestMentionKind
        : null,
    hasVerticalScrollbar: Boolean(record.hasVerticalScrollbar),
    textareaScrollbarWidth: Math.max(0, Math.round(toFiniteNumber(record.textareaScrollbarWidth))),
    textareaClientWidth: Math.max(0, Math.round(toFiniteNumber(record.textareaClientWidth))),
    textareaScrollWidth: Math.max(0, Math.round(toFiniteNumber(record.textareaScrollWidth))),
    overlayContainerClientWidth: Math.max(0, Math.round(toFiniteNumber(record.overlayContainerClientWidth))),
    overlayContentClientWidth: Math.max(0, Math.round(toFiniteNumber(record.overlayContentClientWidth))),
    widthMismatch: Math.max(0, Math.round(toFiniteNumber(record.widthMismatch))),
    textRendering: typeof record.textRendering === "string" ? record.textRendering : "",
    overlayTextRendering: typeof record.overlayTextRendering === "string" ? record.overlayTextRendering : "",
  };
}

export async function POST(request: Request) {
  let body: DiagnosticBody;
  try {
    body = (await request.json()) as DiagnosticBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const trigger =
    body.trigger === "auto_scrollbar_overlap" || body.trigger === "manual_report"
      ? body.trigger
      : null;
  const snapshot = normalizeSnapshot(body.snapshot);
  if (!trigger || !snapshot) {
    return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 });
  }

  const logEntry = {
    type: "seedance_prompt_layout_diagnostic",
    trigger,
    page: typeof body.page === "string" ? body.page : "seedance",
    clientSessionId:
      typeof body.clientSessionId === "string" && body.clientSessionId.length > 0
        ? body.clientSessionId
        : "unknown",
    snapshot,
    userAgent: request.headers.get("user-agent") ?? "",
    timestamp: new Date().toISOString(),
  };

  console.info("[seedance_prompt_layout_diagnostic]", JSON.stringify(logEntry));

  return NextResponse.json({ ok: true });
}
