"use client";

import { cloneElement, isValidElement, useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { addIssueUpdate } from "@/actions/issues";
import { trackQuickIssueUpdateSubmit } from "@/lib/product-analytics";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

type TriggerProps = { onClick?: (e: React.MouseEvent) => void };

export function QuickIssueUpdateDialog({
  issueId,
  source,
  trigger,
  triggerLabel = "快速更新进度",
  afterSubmit,
}: {
  issueId: string;
  /** 埋点 source，如 my_tasks / issue_detail / reminders */
  source: string;
  trigger?: ReactElement<TriggerProps>;
  triggerLabel?: string;
  afterSubmit?: () => Promise<void>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);

  function openDialog() {
    setOpen(true);
    setContent("");
  }

  const triggerNode =
    trigger && isValidElement(trigger) ? (
      cloneElement(trigger, {
        onClick: (e: React.MouseEvent) => {
          (trigger.props as TriggerProps).onClick?.(e);
          openDialog();
        },
      })
    ) : (
      <Button type="button" variant="secondary" className="min-h-10 w-full sm:w-auto" onClick={openDialog}>
        {triggerLabel}
      </Button>
    );

  async function submit() {
    if (!content.trim()) {
      toast.error("写几句今天的进展，让团队了解最新状态");
      return;
    }
    setLoading(true);
    try {
      await addIssueUpdate(issueId, content.trim());
      trackQuickIssueUpdateSubmit(source);
      await afterSubmit?.();
      setContent("");
      setOpen(false);
      toast.success("进展已同步，这张单的推进轨迹又完整了一步");
      router.refresh();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "提交暂时没成功，内容还在，可以再试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {triggerNode}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>快速写进展</DialogTitle>
          </DialogHeader>
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="简要说明今日进展…"
            rows={4}
            className="min-h-[100px]"
          />
          <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={loading}>
              取消
            </Button>
            <Button type="button" onClick={submit} disabled={loading}>
              {loading ? "提交中…" : "提交"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
