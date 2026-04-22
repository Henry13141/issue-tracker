"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { canAccessFinanceOps } from "@/lib/permissions";
import {
  PETTY_CASH_INVOICE_AVAILABILITY_OPTIONS,
  PETTY_CASH_INVOICE_COLLECTED_OPTIONS,
  PETTY_CASH_PAYMENT_OPTIONS,
  PETTY_CASH_PROJECT_OPTIONS,
  toMinorAmount,
} from "@/lib/petty-cash";
import { getPettyCashSchemaHint, isPettyCashSchemaMissingError } from "@/lib/petty-cash-schema";
import { createClient } from "@/lib/supabase/server";
import type {
  PettyCashExpenseProject,
  PettyCashInvoiceAvailability,
  PettyCashInvoiceCollectedStatus,
  PettyCashPaymentMethod,
  PettyCashReimbursementStatus,
  PettyCashReplacementInvoiceStatus,
} from "@/types";

type PettyCashEntryInput = {
  occurred_on: string;
  payer_user_id: string;
  title: string;
  expense_project: PettyCashExpenseProject;
  custom_project_label?: string | null;
  amount: string;
  payment_method: PettyCashPaymentMethod;
  invoice_availability: PettyCashInvoiceAvailability;
  invoice_collected_status: PettyCashInvoiceCollectedStatus;
  reimbursement_status: PettyCashReimbursementStatus;
  reimbursed_on?: string | null;
  notes?: string | null;
};

type PettyCashReplacementInvoiceInput = {
  received_on: string;
  title: string;
  amount: string;
  status: PettyCashReplacementInvoiceStatus;
  notes?: string | null;
};

function isDateOnly(value: string | null | undefined) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function requireOneOf<T extends string>(value: T, options: readonly T[], label: string) {
  if (options.includes(value)) {
    return value;
  }
  throw new Error(`${label}无效`);
}

async function requireFinanceOpsUser() {
  const user = await getCurrentUser();
  if (!user || !canAccessFinanceOps(user)) {
    throw new Error("无权限操作备用金登记");
  }
  return user;
}

function rethrowPettyCashError(error: { message: string }) {
  if (isPettyCashSchemaMissingError(error)) {
    throw new Error(getPettyCashSchemaHint());
  }
  throw new Error(error.message);
}

function normalizeEntryInput(input: PettyCashEntryInput) {
  const occurredOn = input.occurred_on?.trim();
  if (!isDateOnly(occurredOn)) {
    throw new Error("请填写有效的发生日期");
  }

  const payerUserId = input.payer_user_id?.trim();
  if (!payerUserId) {
    throw new Error("请选择垫付人");
  }

  const title = input.title.trim();
  if (!title) {
    throw new Error("请填写事项名称");
  }

  const isCustomProject = input.expense_project === "custom";
  if (!isCustomProject) {
    requireOneOf(input.expense_project, PETTY_CASH_PROJECT_OPTIONS, "支出项目");
  }
  const expenseProject = input.expense_project;

  const customProjectLabel = isCustomProject ? (input.custom_project_label?.trim() || null) : null;
  if (isCustomProject && !customProjectLabel) {
    throw new Error("请填写自定义项目名称");
  }

  const paymentMethod = requireOneOf(input.payment_method, PETTY_CASH_PAYMENT_OPTIONS, "支付方式");
  const invoiceAvailability = requireOneOf(
    input.invoice_availability,
    PETTY_CASH_INVOICE_AVAILABILITY_OPTIONS,
    "有票无票状态"
  );
  const reimbursementStatus = requireOneOf(
    input.reimbursement_status,
    PETTY_CASH_REIMBURSEMENT_STATUS_OPTIONS_ALL,
    "报销状态"
  );

  const invoiceCollectedStatus =
    invoiceAvailability === "with_invoice"
      ? requireOneOf(input.invoice_collected_status, PETTY_CASH_INVOICE_COLLECTED_OPTIONS, "收票状态")
      : ("not_received" as const);

  const reimbursedOn =
    reimbursementStatus === "reimbursed"
      ? input.reimbursed_on?.trim() || occurredOn
      : null;

  if (reimbursementStatus === "reimbursed" && !isDateOnly(reimbursedOn)) {
    throw new Error("已报销记录需要填写有效的报销日期");
  }

  return {
    occurred_on: occurredOn,
    payer_user_id: payerUserId,
    title,
    expense_project: expenseProject,
    custom_project_label: customProjectLabel,
    amount_minor: toMinorAmount(input.amount),
    currency: "CNY" as const,
    payment_method: paymentMethod,
    invoice_availability: invoiceAvailability,
    invoice_replacement_status: "not_needed" as const,
    invoice_collected_status: invoiceCollectedStatus,
    reimbursement_status: reimbursementStatus,
    reimbursed_on: reimbursedOn,
    notes: input.notes?.trim() || null,
  };
}

const PETTY_CASH_REIMBURSEMENT_STATUS_OPTIONS_ALL: PettyCashReimbursementStatus[] = [
  "pending",
  "in_progress",
  "reimbursed",
  "voided",
];

const REPLACEMENT_INVOICE_STATUS_OPTIONS: PettyCashReplacementInvoiceStatus[] = ["available", "used"];

function normalizeReplacementInvoiceInput(input: PettyCashReplacementInvoiceInput) {
  const receivedOn = input.received_on?.trim();
  if (!isDateOnly(receivedOn)) {
    throw new Error("请填写有效的收票日期");
  }

  const title = input.title.trim();
  if (!title) {
    throw new Error("请填写替票来源");
  }

  const status = requireOneOf(input.status, REPLACEMENT_INVOICE_STATUS_OPTIONS, "替票状态");

  return {
    received_on: receivedOn,
    title,
    amount_minor: toMinorAmount(input.amount),
    status,
    notes: input.notes?.trim() || null,
  };
}

export async function createPettyCashEntry(input: PettyCashEntryInput) {
  const user = await requireFinanceOpsUser();
  const payload = normalizeEntryInput(input);
  const supabase = await createClient();

  const { error } = await supabase.from("petty_cash_entries").insert({
    ...payload,
    created_by: user.id,
  });

  if (error) {
    rethrowPettyCashError(error);
  }

  revalidatePath("/finance-ops");
}

export async function updatePettyCashEntry(id: string, input: PettyCashEntryInput) {
  await requireFinanceOpsUser();
  const payload = normalizeEntryInput(input);
  const supabase = await createClient();

  const { error } = await supabase.from("petty_cash_entries").update(payload).eq("id", id);

  if (error) {
    rethrowPettyCashError(error);
  }

  revalidatePath("/finance-ops");
}

export async function createPettyCashReplacementInvoice(input: PettyCashReplacementInvoiceInput) {
  const user = await requireFinanceOpsUser();
  const payload = normalizeReplacementInvoiceInput(input);
  const supabase = await createClient();

  const { error } = await supabase.from("petty_cash_replacement_invoices").insert({
    ...payload,
    created_by: user.id,
  });

  if (error) {
    rethrowPettyCashError(error);
  }

  revalidatePath("/finance-ops");
}

export async function updatePettyCashReplacementInvoice(id: string, input: PettyCashReplacementInvoiceInput) {
  await requireFinanceOpsUser();
  const payload = normalizeReplacementInvoiceInput(input);
  const supabase = await createClient();

  const { error } = await supabase.from("petty_cash_replacement_invoices").update(payload).eq("id", id);

  if (error) {
    rethrowPettyCashError(error);
  }

  revalidatePath("/finance-ops");
}

export async function deletePettyCashEntry(id: string) {
  await requireFinanceOpsUser();
  const supabase = await createClient();

  const { error } = await supabase.from("petty_cash_entries").delete().eq("id", id);

  if (error) {
    rethrowPettyCashError(error);
  }

  revalidatePath("/finance-ops");
}

export async function deletePettyCashReplacementInvoice(id: string) {
  await requireFinanceOpsUser();
  const supabase = await createClient();

  const { error } = await supabase.from("petty_cash_replacement_invoices").delete().eq("id", id);

  if (error) {
    rethrowPettyCashError(error);
  }

  revalidatePath("/finance-ops");
}
