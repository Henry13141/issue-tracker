import * as XLSX from "xlsx";
import type { IssuePriority, IssueStatus } from "@/types";

export type ParsedRow = {
  title: string;
  description: string;
  priority: IssuePriority;
  status: IssueStatus;
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

type RawParsedRow = {
  title: string;
  description: string;
  priority: string;
  status: string;
  assignee_name: string;
  due_date: string;
};

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

const FUZZY_HEADER_RULES: [RegExp, keyof RawParsedRow][] = [
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

function matchHeader(text: string): keyof RawParsedRow | null {
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

function parseSheet(ws: XLSX.WorkSheet): RawParsedRow[] {
  const headerIdx = findHeaderRow(ws);
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" });
  if (aoa.length <= headerIdx + 1) return [];

  const headers = (aoa[headerIdx] as unknown[]).map((c) => String(c ?? "").trim());
  const dataRows = aoa.slice(headerIdx + 1);

  return dataRows
    .map((cells) => {
      const row: RawParsedRow = {
        title: "",
        description: "",
        priority: "",
        status: "",
        assignee_name: "",
        due_date: "",
      };
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
    })
    .filter((r) => r.title);
}

/**
 * 解析 Excel Buffer，返回格式化后的行（priority / status 已归一化）。
 * 取第一个 sheet，自动识别表头。
 */
export function parseExcelBuffer(buffer: ArrayBuffer | Uint8Array): ParsedRow[] {
  const data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const wb = XLSX.read(data, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = parseSheet(ws);
  return raw.map((r) => ({
    title: r.title,
    description: r.description,
    priority: normalizePriority(r.priority),
    status: normalizeStatus(r.status),
    assignee_name: r.assignee_name,
    due_date: r.due_date,
  }));
}
