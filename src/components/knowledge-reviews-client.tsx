"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { KnowledgeReviewRequest } from "@/types";
import { handleReviewRequest } from "@/actions/knowledge";
import { CheckCircle2, XCircle, Clock, ExternalLink } from "lucide-react";
import { CATEGORY_LABELS, STATUS_LABELS, STATUS_BADGE_VARIANT } from "@/components/knowledge-list-client";

interface Props {
  requests: KnowledgeReviewRequest[];
}

export function KnowledgeReviewsClient({ requests }: Props) {
  const pending = requests.filter((r) => r.status === "pending");
  const done = requests.filter((r) => r.status !== "pending");

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="text-base font-semibold">
          待处理
          <Badge variant="secondary" className="ml-2 text-xs">{pending.length}</Badge>
        </h2>
        {pending.length === 0 ? (
          <p className="text-sm text-muted-foreground">暂无待处理审核</p>
        ) : (
          pending.map((req) => <ReviewCard key={req.id} request={req} />)
        )}
      </section>

      {done.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-muted-foreground">已处理</h2>
          {done.map((req) => <ReviewCard key={req.id} request={req} readonly />)}
        </section>
      )}
    </div>
  );
}

function ReviewCard({
  request,
  readonly = false,
}: {
  request: KnowledgeReviewRequest;
  readonly?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [action, setAction] = useState<"approved" | "rejected">("approved");

  function handleDecide() {
    startTransition(async () => {
      const result = await handleReviewRequest(request.id, action, note || undefined);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(action === "approved" ? "已通过审核" : "已拒绝");
      setOpen(false);
      router.refresh();
    });
  }

  const article = request.article as { id: string; title: string; status: string; category: string } | undefined;
  const requester = request.requester as { id: string; name: string } | undefined;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="space-y-2">
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              {article ? (
                <Link
                  href={`/knowledge/${article.id}`}
                  className="font-medium hover:underline flex items-center gap-1"
                >
                  {article.title}
                  <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                </Link>
              ) : (
                <span className="font-medium text-muted-foreground">{request.article_id}</span>
              )}
            </div>
            {article && (
              <div className="flex items-center gap-1.5 shrink-0">
                <Badge variant={STATUS_BADGE_VARIANT[article.status as keyof typeof STATUS_BADGE_VARIANT] ?? "outline"} className="text-xs">
                  {STATUS_LABELS[article.status as keyof typeof STATUS_LABELS] ?? article.status}
                </Badge>
                <Badge variant="outline" className="text-xs">
                  {CATEGORY_LABELS[article.category as keyof typeof CATEGORY_LABELS] ?? article.category}
                </Badge>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            {requester && <span>申请人：{requester.name}</span>}
            {request.review_note && <span>备注：{request.review_note}</span>}
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {new Date(request.created_at).toLocaleString("zh-CN")}
            </span>
            {request.status !== "pending" && (
              <Badge
                variant={request.status === "approved" ? "default" : "destructive"}
                className="text-xs"
              >
                {request.status === "approved" ? "已通过" : "已拒绝"}
              </Badge>
            )}
          </div>

          {!readonly && (
            <div className="flex gap-2 pt-1">
              <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger
                  render={
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => setAction("approved")}
                    >
                      <CheckCircle2 className="mr-1.5 h-4 w-4" />
                      通过
                    </Button>
                  }
                />
                <DialogTrigger
                  render={
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setAction("rejected")}
                    >
                      <XCircle className="mr-1.5 h-4 w-4" />
                      拒绝
                    </Button>
                  }
                />
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>
                      {action === "approved" ? "通过审核" : "拒绝审核"}
                    </DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 pt-2">
                    <div className="space-y-2">
                      <Label>审核备注（可选）</Label>
                      <Textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="填写反馈意见..."
                        rows={3}
                      />
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
                      <Button
                        variant={action === "approved" ? "default" : "destructive"}
                        onClick={handleDecide}
                        disabled={isPending}
                      >
                        确认{action === "approved" ? "通过" : "拒绝"}
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
