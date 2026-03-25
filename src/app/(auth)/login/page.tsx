import { Suspense } from "react";
import { LoginForm } from "@/components/login-form";
import { isDingtalkScanLoginConfigured } from "@/lib/dingtalk";
import { getPublicAppUrl } from "@/lib/app-url";

export default function LoginPage() {
  const showDingtalkLogin =
    isDingtalkScanLoginConfigured() && Boolean(getPublicAppUrl());

  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center text-muted-foreground">
          加载中…
        </div>
      }
    >
      <LoginForm showDingtalkLogin={showDingtalkLogin} />
    </Suspense>
  );
}
