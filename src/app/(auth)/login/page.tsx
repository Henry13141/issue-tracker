import { Suspense } from "react";
import { LoginForm } from "@/components/login-form";
import { isWecomScanLoginConfigured } from "@/lib/wecom";
import { getPublicAppUrl } from "@/lib/app-url";

export default function LoginPage() {
  const showWecomLogin =
    isWecomScanLoginConfigured() && Boolean(getPublicAppUrl());

  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center text-muted-foreground">
          加载中…
        </div>
      }
    >
      <LoginForm showWecomLogin={showWecomLogin} />
    </Suspense>
  );
}
