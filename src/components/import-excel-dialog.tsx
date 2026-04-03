"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import { bulkCreateIssues } from "@/actions/issues";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { Upload, Download, FileSpreadsheet } from "lucide-react";
import type { IssuePriority, IssueStatus } from "@/types";

type ParsedRow = {
  title: string;
  description: string;
  priority: string;
  status: string;
  assignee_name: string;
  due_date: string;
};

const PRIORITY_ALIAS: Record<string, IssuePriority> = {
  低: "low", low: "low",
  中: "medium", medium: "medium",
  高: "high", high: "high",
  紧急: "urgent", urgent: "urgent",
};

const STATUS_ALIAS: Record<string, IssueStatus> = {
  待处理: "todo", todo: "todo",
  处理中: "in_progress", in_progress: "in_progress",
  卡住: "blocked", blocked: "blocked",
  待验证: "pending_review", pending_review: "pending_review",
  已解决: "resolved", resolved: "resolved",
  已关闭: "closed", closed: "closed",
  解决: "resolved", 完成: "resolved",
  暂定: "todo", 未完成: "in_progress",
  "大部分完成": "pending_review",
};

function normalizePriority(v: string): IssuePriority {
  return PRIORITY_ALIAS[v.trim().toLowerCase()] ?? PRIORITY_ALIAS[v.trim()] ?? "medium";
}

function normalizeStatus(v: string): IssueStatus {
  return STATUS_ALIAS[v.trim().toLowerCase()] ?? STATUS_ALIAS[v.trim()] ?? "todo";
}

function parseExcelDate(v: unknown): string {
  if (!v) return "";
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return "";
}

export function downloadTemplate() {
  const wb = XLSX.utils.book_new();

  const data1 = [
    ["序号", "问题", "负责人", "目前情况说明", "完成情况"],
    [1, "示例：首页加载慢", "张三", "首页白屏超过 3 秒", ""],
    [2, "示例：注册验证码失效", "李四", "验证码发送后立即过期", "解决"],
  ];
  const ws1 = XLSX.utils.aoa_to_sheet(data1);
  ws1["!cols"] = [{ wch: 6 }, { wch: 30 }, { wch: 10 }, { wch: 40 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws1, "待优化汇总表");

  const data2 = [
    ["标题", "描述", "优先级", "状态", "负责人", "截止日期"],
    ["示例：首页加载慢", "首页白屏超过 3 秒", "高", "待处理", "张三", "2025-04-01"],
    ["示例：注册验证码失效", "验证码发送后立即过期", "紧急", "处理中", "李四", "2025-03-30"],
  ];
  const ws2 = XLSX.utils.aoa_to_sheet(data2);
  ws2["!cols"] = [{ wch: 25 }, { wch: 35 }, { wch: 8 }, { wch: 8 }, { wch: 10 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, ws2, "标准格式");

  XLSX.writeFile(wb, "问题导入模板.xlsx");
}

const FUZZY_HEADER_RULES: [RegExp, keyof ParsedRow][] = [
  [/标题/, "title"],
  [/问题/, "title"],
  [/title/i, "title"],
  [/情况说明|描述|description/i, "description"],
  [/美术说明|美术/, "description"],
  [/说明/, "description"],
  [/优先级|priority/i, "priority"],
  [/完成情况|完成|状态|status/i, "status"],
  [/负责人|责任人|assignee/i, "assignee_name"],
  [/截止|到期|due/i, "due_date"],
];

function matchHeader(text: string): keyof ParsedRow | null {
  const clean = text.replace(/\s+/g, "").trim();
  if (!clean || /^序号$|^#$|^id$/i.test(clean)) return null;
  for (const [re, field] of FUZZY_HEADER_RULES) {
    if (re.test(clean)) return field;
  }
  return null;
}

function findHeaderRow(ws: XLSX.WorkSheet): number {
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" });
  for (let i = 0; i < Math.min(aoa.length, 10); i++) {
    const cells = (aoa[i] as unknown[]).map((c) => String(c ?? "").replace(/\s+/g, "").trim());
    const matches = cells.filter((c) => matchHeader(c) !== null);
    if (matches.length >= 2) return i;
  }
  return 0;
}

function parseSheet(ws: XLSX.WorkSheet): ParsedRow[] {
  const headerIdx = findHeaderRow(ws);
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" });
  if (aoa.length <= headerIdx + 1) return [];

  const headers = (aoa[headerIdx] as unknown[]).map((c) => String(c ?? "").trim());
  const dataRows = aoa.slice(headerIdx + 1);

  return dataRows.map((cells) => {
    const row: ParsedRow = { title: "", description: "", priority: "", status: "", assignee_name: "", due_date: "" };
    const descParts: string[] = [];
    const arr = cells as unknown[];
    for (let col = 0; col < headers.length; col++) {
      const headerKey = headers[col];
      const mapped = matchHeader(headerKey);
      if (!mapped) continue;
      const val = arr[col];
      const strVal = String(val ?? "").trim();
      if (!strVal) continue;
      if (mapped === "due_date") {
        row.due_date = parseExcelDate(val);
      } else if (mapped === "description") {
        descParts.push(strVal);
      } else {
        row[mapped] = strVal;
      }
    }
    row.description = descParts.join("\n");
    return row;
  }).filter((r) => r.title);
}

export function ImportExcelDialog() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [loading, setLoading] = useState(false);

  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const parsed = parseSheet(ws);
        if (parsed.length === 0) {
          toast.error("没有识别到有效数据，请确认表头包含「标题」列");
          return;
        }
        setRows(parsed);
      } catch {
        toast.error("文件格式没有识别成功，请确认是 .xlsx 或 .xls 格式");
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  }, []);

  async function handleImport() {
    if (rows.length === 0) return;
    setLoading(true);
    try {
      const count = await bulkCreateIssues(
        rows.map((r) => ({
          title: r.title,
          description: r.description || null,
          priority: normalizePriority(r.priority),
          status: normalizeStatus(r.status),
          assignee_name: r.assignee_name || null,
          due_date: r.due_date || null,
        }))
      );
      toast.success(`${count} 条问题已批量录入系统，团队可以开始跟进了`);
      setOpen(false);
      setRows([]);
      setFileName("");
      router.refresh();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "导入暂时没成功，可以检查文件后再试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button type="button" variant="outline" className="gap-1.5 shadow-xs" onClick={() => setOpen(true)}>
        <Upload className="h-4 w-4" />
        Excel 导入
      </Button>
      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setRows([]); setFileName(""); } }}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            从 Excel 批量导入问题
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 flex-1 overflow-hidden flex flex-col">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
              选择文件
            </Button>
            <span className="text-sm text-muted-foreground truncate">{fileName || "支持 .xlsx / .xls"}</span>
            <Button variant="ghost" size="sm" onClick={downloadTemplate} className="ml-auto shrink-0">
              <Download className="mr-1.5 h-4 w-4" />
              下载模板
            </Button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} className="hidden" />
          </div>

          <p className="text-xs text-muted-foreground">
            自动识别表头：问题/标题、目前情况说明/描述、负责人、完成情况/状态（解决/完成→已解决，暂定→待处理）、优先级（低/中/高/紧急）、截止日期。支持你们内部「待优化汇总表」格式。
          </p>

          {rows.length > 0 && (
            <div className="border rounded-md overflow-auto flex-1 min-h-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">#</TableHead>
                    <TableHead>标题</TableHead>
                    <TableHead className="w-20">优先级</TableHead>
                    <TableHead className="w-20">状态</TableHead>
                    <TableHead className="w-20">负责人</TableHead>
                    <TableHead className="w-24">截止日期</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="font-medium max-w-[200px] truncate">{r.title}</TableCell>
                      <TableCell>{r.priority || "中"}</TableCell>
                      <TableCell>{r.status || "待处理"}</TableCell>
                      <TableCell>{r.assignee_name || "—"}</TableCell>
                      <TableCell>{r.due_date || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
          <Button onClick={handleImport} disabled={loading || rows.length === 0}>
            {loading ? "导入中…" : `导入 ${rows.length} 条`}
          </Button>
        </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
