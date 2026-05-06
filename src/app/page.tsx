import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canAccessFinanceOps } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";

async function HomeRedirect() {
  let supabase;
  try {
    supabase = await createClient();
  } catch {
    redirect("/login");
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const profile = await getCurrentUser();
  if (profile?.role === "admin") {
    redirect("/dashboard");
  }
  if (canAccessFinanceOps(profile)) {
    redirect("/finance-ops");
  }
  redirect("/home");
  return null;
}

export default function Home() {
  return (
    <Suspense fallback={null}>
      <HomeRedirect />
    </Suspense>
  );
}
