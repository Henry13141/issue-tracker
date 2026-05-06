import { Suspense } from "react";
import { LoginForm } from "@/components/login-form";
import { isWecomScanLoginConfigured } from "@/lib/wecom";
import { getPublicAppUrl } from "@/lib/app-url";
import { createAdminClient } from "@/lib/supabase/admin";

type DebugUser = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "finance" | "member";
};

async function LoginFormShell({
  showWecomLogin,
  showDevLogin,
}: {
  showWecomLogin: boolean;
  showDevLogin: boolean;
}) {
  let devUsers: DebugUser[] = [];

  if (showDevLogin) {
    const admin = createAdminClient();
    const { data } = await admin
      .from("users")
      .select("id, name, email, role")
      .order("name", { ascending: true });

    devUsers = (data ?? []).map((m) => ({
      id: m.id as string,
      name: m.name as string,
      email: m.email as string,
      role: (m.role as "admin" | "finance" | "member") ?? "member",
    }));
  }

  return (
    <LoginForm
      showWecomLogin={showWecomLogin}
      showDevLogin={showDevLogin}
      debugUsers={devUsers}
    />
  );
}

export default function LoginPage() {
  const showWecomLogin =
    isWecomScanLoginConfigured() && Boolean(getPublicAppUrl());
  const showDevLogin = process.env.NODE_ENV !== "production";

  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center text-muted-foreground">
          加载中…
        </div>
      }
    >
      <LoginFormShell showWecomLogin={showWecomLogin} showDevLogin={showDevLogin} />
    </Suspense>
  );
}
