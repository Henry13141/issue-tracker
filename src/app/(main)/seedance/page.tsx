import { SeedancePlayground } from "@/components/seedance-playground";
import { getSessionGate } from "@/lib/auth";
import { isSeedanceConfigured } from "@/lib/ark-seedance";

export default async function SeedancePage() {
  const configured = isSeedanceConfigured();
  const gate = await getSessionGate();

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-2 pb-16 sm:px-4">
      <section className="space-y-3">
        <div className="inline-flex rounded-full border border-primary/15 bg-primary/6 px-4 py-1.5 text-sm font-medium text-primary">
          Seedance 2.0
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          视频生成创作台
        </h1>
        <p className="max-w-2xl text-lg leading-relaxed text-muted-foreground">
          在同一界面里完成提示词构思、参考素材组织、任务提交和结果查看。
        </p>
      </section>
      <SeedancePlayground
        configured={configured}
        authenticated={gate.status === "ok"}
        profileMissing={gate.status === "profile_missing"}
      />
    </div>
  );
}
