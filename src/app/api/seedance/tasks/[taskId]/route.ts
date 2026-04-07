import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { deleteSeedanceTask, getSeedanceTask, toArkErrorResponse } from "@/lib/ark-seedance";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: RouteContext<"/api/seedance/tasks/[taskId]">
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录，无法查询 Seedance 任务。" }, { status: 401 });
  }

  const { taskId } = await context.params;
  if (!taskId?.trim()) {
    return NextResponse.json({ error: "缺少任务 ID。" }, { status: 400 });
  }

  try {
    const task = await getSeedanceTask(taskId);
    return NextResponse.json({ task });
  } catch (error) {
    const response = toArkErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function DELETE(
  _request: Request,
  context: RouteContext<"/api/seedance/tasks/[taskId]">
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录，无法删除或取消 Seedance 任务。" }, { status: 401 });
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
