"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type FinanceOpsMode = "tasks" | "petty-cash";

export function FinanceOpsModeTabs({ currentMode }: { currentMode: FinanceOpsMode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function switchMode(nextMode: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (!nextMode || nextMode === "tasks") {
      params.delete("mode");
    } else {
      params.set("mode", nextMode);
    }

    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <Tabs value={currentMode} onValueChange={switchMode} className="w-auto">
      <TabsList>
        <TabsTrigger value="tasks">待办管理</TabsTrigger>
        <TabsTrigger value="petty-cash">备用金登记</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
