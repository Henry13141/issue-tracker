import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { User } from "@/types";

export const getCurrentUser = cache(async (): Promise<User | null> => {
  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return null;
  }
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) return null;

  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("id", authUser.id)
    .single();

  if (error || !data) return null;
  return data as User;
});
