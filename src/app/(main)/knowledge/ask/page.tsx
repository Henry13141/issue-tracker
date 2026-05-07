import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Sparkles, BookOpen, MessageSquare, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import KnowledgeAskClient from "@/components/knowledge-ask-client";
import { isAIConfigured } from "@/lib/ai";

export default async function KnowledgeAskPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const aiReady = isAIConfigured();

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

      {/* AI 未配置时提示 */}
      {!aiReady && (
        <Card className="border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/20">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div>
              <p className="font-medium text-amber-800 dark:text-amber-400">AI 服务未配置</p>
              <p className="mt-0.5 text-sm text-amber-700 dark:text-amber-500">
                请在环境变量中配置 <code className="font-mono text-xs">MOONSHOT_API_KEY</code> 后重启服务。
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 问答交互区 */}
      {aiReady && <KnowledgeAskClient />}

      {/* 功能说明 */}
      <div className="grid gap-4 sm:grid-cols-3">
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
          description="如知识库中无依据，AI 将明确告知，不猜测、不编造"
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
            ["置信度", "high / medium / low，基于检索相关性判断"],
            ["风险提示", "使用该知识时需注意的风险"],
            ["可执行性", "明确标注是否可直接执行"],
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
