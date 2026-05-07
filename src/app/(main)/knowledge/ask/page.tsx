import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sparkles, BookOpen, Search, MessageSquare, AlertTriangle } from "lucide-react";

export default async function KnowledgeAskPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Sparkles className="h-6 w-6" />
          AI 知识问答
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          基于项目知识库的智能问答，回答将引用可信知识来源
        </p>
      </div>

      {/* 即将上线提示 */}
      <Card className="border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/20">
        <CardContent className="flex items-start gap-3 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div>
            <p className="font-medium text-amber-800 dark:text-amber-400">功能开发中</p>
            <p className="mt-0.5 text-sm text-amber-700 dark:text-amber-500">
              AI 问答功能正在建设中，后续将接入 RAG 检索，所有回答将附带知识来源引用。
            </p>
          </div>
        </CardContent>
      </Card>

      {/* 占位搜索框（不可用）*/}
      <div className="relative opacity-50 pointer-events-none">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-9 pr-24"
          placeholder="提问，例如：这个项目的 UI 规范是什么？"
          disabled
        />
        <Button className="absolute right-1.5 top-1/2 -translate-y-1/2 h-7" disabled>
          <Sparkles className="mr-1.5 h-4 w-4" />
          提问
        </Button>
      </div>

      {/* 功能说明 */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <FeatureCard
          icon={<BookOpen className="h-5 w-5" />}
          title="优先引用已确认知识"
          description="AI 回答优先基于 approved 状态的知识条目，保证答案可靠性"
        />
        <FeatureCard
          icon={<MessageSquare className="h-5 w-5" />}
          title="来源透明可追溯"
          description="每条回答都会标注引用了哪些知识文档，可一键跳转原文"
        />
        <FeatureCard
          icon={<AlertTriangle className="h-5 w-5" />}
          title="未知时明确告知"
          description="如知识库中无依据，AI 将明确回答「知识库中没有找到可靠依据」，不猜测"
        />
      </div>

      {/* AI 回答格式说明 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">AI 回答将包含以下内容</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          {[
            ["答案", "基于知识库的直接回答"],
            ["引用知识", "引用的知识条目列表（可跳转）"],
            ["关联任务", "相关的 Issue 任务"],
            ["风险提示", "使用该知识时需注意的风险"],
            ["是否可作为执行依据", "明确标注是否可直接执行"],
          ].map(([label, desc]) => (
            <div key={label} className="flex gap-2">
              <Badge variant="outline" className="shrink-0">{label}</Badge>
              <span>{desc}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 text-muted-foreground">{icon}</div>
          <div>
            <p className="font-medium text-sm">{title}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
