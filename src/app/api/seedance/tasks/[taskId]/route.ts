import { NextResponse } from "next/server";
import { getSessionGate } from "@/lib/auth";
import { SEEDANCE_PROFILE_MISSING_MESSAGE } from "@/lib/seedance-auth-messages";
import { deleteSeedanceTask, getSeedanceTask, toArkErrorResponse } from "@/lib/ark-seedance";
import { fetchSeedanceTaskPrompt } from "@/lib/seedance-task-prompts";

export async function GET(
  _request: Request,
  context: RouteContext<"/api/seedance/tasks/[taskId]">
) {
  const gate = await getSessionGate();
  if (gate.status === "profile_missing") {
    return NextResponse.json(
      { error: SEEDANCE_PROFILE_MISSING_MESSAGE, code: "profile_missing" },
      { status: 403 }
    );
  }
  if (gate.status !== "ok") {
    return NextResponse.json(
      { error: "未登录，无法查询 Seedance 任务。", code: "unauthenticated" },
      { status: 401 }
    );
  }

  const { taskId } = await context.params;
  if (!taskId?.trim()) {
    return NextResponse.json({ error: "缺少任务 ID。" }, { status: 400 });
  }

  try {
    const task = await getSeedanceTask(taskId);
    const prompt = await fetchSeedanceTaskPrompt(taskId);
    return NextResponse.json({ task, prompt: prompt ?? null });
  } catch (error) {
    const response = toArkErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function DELETE(
  _request: Request,
  context: RouteContext<"/api/seedance/tasks/[taskId]">
) {
  const gate = await getSessionGate();
  if (gate.status === "profile_missing") {
    return NextResponse.json(
      { error: SEEDANCE_PROFILE_MISSING_MESSAGE, code: "profile_missing" },
      { status: 403 }
    );
  }
  if (gate.status !== "ok") {
    return NextResponse.json(
      { error: "未登录，无法删除或取消 Seedance 任务。", code: "unauthenticated" },
      { status: 401 }
    );
  }

  const { taskId } = await context.params;
  if (!taskId?.trim()) {
    return NextResponse.json({ error: "缺少任务 ID。" }, { status: 400 });
  }

  try {
    await deleteSeedanceTask(taskId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const response = toArkErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
