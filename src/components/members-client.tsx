"use client";

import { useTransition } from "react";
import { updateUserWecomUserId } from "@/actions/members";
import type { User } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

function MemberRow({ member }: { member: User }) {
  const [pending, startTransition] = useTransition();

  function save(formData: FormData) {
    const value = (formData.get("wecom_userid") as string) ?? "";
    startTransition(async () => {
      const r = await updateUserWecomUserId(member.id, value);
      if (r.ok) toast.success(`${member.name} 的企业微信 userid 已保存`);
      else toast.error(r.error ?? "保存失败");
    });
  }

  return (
    <TableRow>
      <TableCell className="font-medium">{member.name}</TableCell>
      <TableCell className="text-muted-foreground text-sm">{member.email}</TableCell>
      <TableCell className="text-muted-foreground text-sm">
        {member.role === "admin" ? "管理员" : "成员"}
      </TableCell>
      <TableCell>
        <form action={save} className="flex flex-wrap items-center gap-2">
          <Input
            name="wecom_userid"
            defaultValue={member.wecom_userid ?? ""}
            placeholder="企业微信通讯录 userid"
            className="max-w-xs"
            disabled={pending}
          />
          <Button type="submit" size="sm" disabled={pending}>
            保存
          </Button>
        </form>
      </TableCell>
    </TableRow>
  );
}

export function MembersClient({ members }: { members: User[] }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">成员与企业微信</h1>
        <p className="text-muted-foreground text-sm">
          为每位成员填写企业微信通讯录中的 userid，每日催办 Cron 会向其发送应用消息（私信）。
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>企业微信 userid</CardTitle>
          <CardDescription>
            获取方式：企业微信管理后台 → 通讯录 → 点击成员 → 查看 userid（或通过开放 API 获取）。需在企业微信开放平台为应用开通「发送应用消息」相关权限。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>姓名</TableHead>
                <TableHead>邮箱</TableHead>
                <TableHead>角色</TableHead>
                <TableHead>企业微信 userid</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => (
                <MemberRow key={m.id} member={m} />
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
