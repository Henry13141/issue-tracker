import { SeedancePlayground } from "@/components/seedance-playground";
import { isSeedanceConfigured } from "@/lib/ark-seedance";

export const dynamic = "force-dynamic";

export default function SeedancePage() {
  const configured = isSeedanceConfigured();

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="space-y-2">
        <div className="inline-flex rounded-full border border-primary/15 bg-primary/6 px-3 py-1 text-xs text-primary">
          Seedance 2.0
        </div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">视频生成创作台</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          在同一界面里完成提示词构思、参考素材组织、任务提交和结果查看。
        </p>
      </section>
      <SeedancePlayground configured={configured} />
    </div>
  );
}
