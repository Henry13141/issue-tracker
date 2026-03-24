import Link from "next/link";
import { buttonVariants } from "@/lib/button-variants";
import { cn } from "@/lib/utils";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold">页面不存在</h1>
      <p className="text-muted-foreground text-sm">请检查链接或返回首页。</p>
      <Link href="/" className={cn(buttonVariants())}>
        返回首页
      </Link>
    </div>
  );
}
