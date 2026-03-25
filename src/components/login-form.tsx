"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/lib/button-variants";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import Image from "next/image";
import { toast } from "sonner";

export function LoginForm({ showWecomLogin = false }: { showWecomLogin?: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect") || "/";

  useEffect(() => {
    const err = searchParams.get("error");
    const desc = searchParams.get("error_description");
    if ((err === "wecom" || err === "dingtalk") && desc) {
      try {
        toast.error(decodeURIComponent(desc));
      } catch {
        toast.error(desc);
      }
    }
  }, [searchParams]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"signin" | "signup">("signin");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const supabase = createClient();
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { name: name || email.split("@")[0] },
          },
        });
        if (error) throw error;
        toast.success("注册成功，如开启邮箱验证请查收邮件");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("登录成功");
      }
      router.push(redirectTo);
      router.refresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "操作失败";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
      <Card className="w-full max-w-md overflow-hidden border-0 shadow-2xl">
        <div className="bg-gradient-to-r from-slate-900 to-slate-800 px-6 py-8 text-center">
          <Image src="/mgm-logo.png" alt="米伽米" width={120} height={120} className="mx-auto mb-4 h-[100px] w-auto object-contain drop-shadow-[0_0_12px_rgba(255,255,255,0.15)]" />
          <h1 className="text-lg font-semibold text-white">米伽米 · 工单管理系统</h1>
          <p className="mt-1 text-sm text-slate-400">米伽米（上海）文化科技有限公司</p>
        </div>
        <CardContent className="p-6">
          <div className="mb-5 flex gap-2 rounded-lg bg-muted p-1">
            <Button
              type="button"
              variant={mode === "signin" ? "default" : "ghost"}
              className="flex-1"
              onClick={() => setMode("signin")}
            >
              登录
            </Button>
            <Button
              type="button"
              variant={mode === "signup" ? "default" : "ghost"}
              className="flex-1"
              onClick={() => setMode("signup")}
            >
              注册
            </Button>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "signup" ? (
              <div className="space-y-2">
                <Label htmlFor="name">姓名</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="显示名称"
                  autoComplete="name"
                />
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="email">邮箱</Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                autoComplete="email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                minLength={6}
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "请稍候…" : mode === "signup" ? "注册" : "登录"}
            </Button>
          </form>
          {showWecomLogin ? (
            <div className="mt-5 space-y-3">
              <div className="flex items-center gap-3">
                <Separator className="flex-1" />
                <span className="text-xs text-muted-foreground">或</span>
                <Separator className="flex-1" />
              </div>
              <a
                href={`/api/auth/wecom/start?redirect=${encodeURIComponent(redirectTo)}`}
                className={cn(buttonVariants({ variant: "outline" }), "w-full gap-2 no-underline")}
              >
                <span className="text-[#07c160] font-semibold">微</span>
                企业微信扫码登录
              </a>
              <p className="text-center text-xs text-muted-foreground">
                首次扫码将自动注册并绑定企业微信账号；请先在企业微信管理后台配置可信域名与 OAuth 权限。
              </p>
            </div>
          ) : null}
          <p className="mt-6 text-center text-xs text-muted-foreground">
            &copy; {new Date().getFullYear()} 米伽米（上海）文化科技有限公司
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
