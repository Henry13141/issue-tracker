"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/lib/button-variants";
import { cn } from "@/lib/utils";

const ALL = "__all__";

function buildQuery(base: URLSearchParams, patch: Record<string, string | null>) {
  const next = new URLSearchParams(base.toString());
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === "" || v === ALL) next.delete(k);
    else next.set(k, v);
  }
  return next.toString();
}

export function IssuesTabRow({
  tabs,
}: {
  tabs: { key: string; href: string; label: string; active: boolean }[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const status = searchParams.get("status") ?? ALL;
  const quickPendingReview = status === "pending_review";

  function push(patch: Record<string, string | null>) {
    const q = buildQuery(searchParams, patch);
    startTransition(() => {
      router.push(q ? `/issues?${q}` : "/issues");
    });
  }

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          className={cn(buttonVariants({ variant: tab.active ? "default" : "outline", size: "sm" }))}
        >
          {tab.label}
        </Link>
      ))}
      <Button
        type="button"
        size="sm"
        variant={quickPendingReview ? "default" : "outline"}
        disabled={pending}
        onClick={() => push({ status: quickPendingReview ? null : "pending_review", page: null })}
      >
        待验证
      </Button>
    </div>
  );
}
