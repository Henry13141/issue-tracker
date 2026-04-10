import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canAccessFinanceOps } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
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
}
