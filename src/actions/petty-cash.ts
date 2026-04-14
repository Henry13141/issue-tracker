"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { canAccessFinanceOps } from "@/lib/permissions";
import {
  PETTY_CASH_INVOICE_AVAILABILITY_OPTIONS,
  PETTY_CASH_INVOICE_COLLECTED_OPTIONS,
  PETTY_CASH_INVOICE_REPLACEMENT_OPTIONS,
  PETTY_CASH_PAYMENT_OPTIONS,
  PETTY_CASH_PROJECT_OPTIONS,
  PETTY_CASH_REIMBURSEMENT_STATUS_OPTIONS,
  isReplacementExpenseProject,
  toMinorAmount,
} from "@/lib/petty-cash";
import { getPettyCashSchemaHint, isPettyCashSchemaMissingError } from "@/lib/petty-cash-schema";
import { createClient } from "@/lib/supabase/server";
import type {
  PettyCashExpenseProject,
  PettyCashInvoiceAvailability,
  PettyCashInvoiceCollectedStatus,
  PettyCashInvoiceReplacementStatus,
  PettyCashPaymentMethod,
  PettyCashReimbursementStatus,
} from "@/types";

type PettyCashEntryInput = {
  occurred_on: string;
  payer_user_id: string;
  title: string;
  expense_project: PettyCashExpenseProject;
  amount: string;
  payment_method: PettyCashPaymentMethod;
  invoice_availability: PettyCashInvoiceAvailability;
  invoice_replacement_status: PettyCashInvoiceReplacementStatus;
  invoice_collected_status: PettyCashInvoiceCollectedStatus;
  reimbursement_status: PettyCashReimbursementStatus;
  reimbursed_on?: string | null;
  notes?: string | null;
};

type PettyCashReplacementInvoiceInput = {
  received_on: string;
  title: string;
  amount: string;
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

  const expenseProject = requireOneOf(input.expense_project, PETTY_CASH_PROJECT_OPTIONS, "支出项目");
  const paymentMethod = requireOneOf(input.payment_method, PETTY_CASH_PAYMENT_OPTIONS, "支付方式");
  const invoiceAvailability = requireOneOf(
    input.invoice_availability,
    PETTY_CASH_INVOICE_AVAILABILITY_OPTIONS,
    "有票无票状态"
  );
  const rawInvoiceCollectedStatus = requireOneOf(
    input.invoice_collected_status,
    PETTY_CASH_INVOICE_COLLECTED_OPTIONS,
    "收票状态"
  );
  const reimbursementStatus = requireOneOf(
    input.reimbursement_status,
    PETTY_CASH_REIMBURSEMENT_STATUS_OPTIONS,
    "报销状态"
  );
  const usesReplacementProject = isReplacementExpenseProject(expenseProject);

  let invoiceReplacementStatus: PettyCashInvoiceReplacementStatus;
  let invoiceCollectedStatus: PettyCashInvoiceCollectedStatus;
  if (usesReplacementProject) {
    invoiceReplacementStatus = "matched";
    invoiceCollectedStatus = "received";
  } else if (invoiceAvailability === "with_invoice") {
    invoiceReplacementStatus = "not_needed";
    invoiceCollectedStatus = rawInvoiceCollectedStatus;
  } else {
    invoiceReplacementStatus = requireOneOf(
      input.invoice_replacement_status,
      PETTY_CASH_INVOICE_REPLACEMENT_OPTIONS,
      "替票状态"
    );
    if (invoiceReplacementStatus === "matched") {
      throw new Error("请使用替票项目自动占用替票额度");
    }
    invoiceCollectedStatus = rawInvoiceCollectedStatus;
  }

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
    amount_minor: toMinorAmount(input.amount),
    currency: "CNY" as const,
    payment_method: paymentMethod,
    invoice_availability: usesReplacementProject ? ("without_invoice" as const) : invoiceAvailability,
    invoice_replacement_status: invoiceReplacementStatus,
    invoice_collected_status: invoiceCollectedStatus,
    reimbursement_status: reimbursementStatus,
    reimbursed_on: reimbursedOn,
    notes: input.notes?.trim() || null,
  };
}

function normalizeReplacementInvoiceInput(input: PettyCashReplacementInvoiceInput) {
  const receivedOn = input.received_on?.trim();
  if (!isDateOnly(receivedOn)) {
    throw new Error("请填写有效的收票日期");
  }

  const title = input.title.trim();
  if (!title) {
    throw new Error("请填写替票来源");
  }

  return {
    received_on: receivedOn,
    title,
    amount_minor: toMinorAmount(input.amount),
    notes: input.notes?.trim() || null,
  };
}

async function getReplacementQuotaSnapshot(
  supabase: Awaited<ReturnType<typeof createClient>>,
  options?: {
    excludeEntryId?: string;
    excludeInvoiceId?: string;
    nextInvoiceAmountMinor?: number;
  }
) {
  const invoiceQuery = supabase
    .from("petty_cash_replacement_invoices")
    .select("id, amount_minor");
  const entryQuery = supabase
    .from("petty_cash_entries")
    .select("id, amount_minor")
    .eq("expense_project", "hospitality_replacement")
    .neq("reimbursement_status", "voided");

  const [{ data: invoiceRows, error: invoiceError }, { data: entryRows, error: entryError }] = await Promise.all([
    invoiceQuery,
    entryQuery,
  ]);

  if (invoiceError) {
    rethrowPettyCashError(invoiceError);
  }
  if (entryError) {
    rethrowPettyCashError(entryError);
  }

  const totalAmountMinor =
    ((invoiceRows ?? []) as Array<{ id: string; amount_minor: number }>)
      .filter((row) => row.id !== options?.excludeInvoiceId)
      .reduce((sum, row) => sum + row.amount_minor, 0) + (options?.nextInvoiceAmountMinor ?? 0);
  const usedAmountMinor = ((entryRows ?? []) as Array<{ id: string; amount_minor: number }>)
    .filter((row) => row.id !== options?.excludeEntryId)
    .reduce((sum, row) => sum + row.amount_minor, 0);

  return {
    totalAmountMinor,
    usedAmountMinor,
    availableAmountMinor: totalAmountMinor - usedAmountMinor,
  };
}

async function ensureReplacementQuotaAvailable(
  supabase: Awaited<ReturnType<typeof createClient>>,
  payload: ReturnType<typeof normalizeEntryInput>,
  excludeEntryId?: string
) {
  if (!isReplacementExpenseProject(payload.expense_project) || payload.reimbursement_status === "voided") {
    return;
  }

  const snapshot = await getReplacementQuotaSnapshot(supabase, { excludeEntryId });
  if (snapshot.availableAmountMinor < payload.amount_minor) {
    throw new Error("当前替票剩余额度不足，请先登记替票再保存该项目");
  }
}

async function ensureReplacementInvoiceCoverage(
  supabase: Awaited<ReturnType<typeof createClient>>,
  payload: ReturnType<typeof normalizeReplacementInvoiceInput>,
  excludeInvoiceId?: string
) {
  const snapshot = await getReplacementQuotaSnapshot(supabase, {
    excludeInvoiceId,
    nextInvoiceAmountMinor: payload.amount_minor,
  });
  if (snapshot.availableAmountMinor < 0) {
    throw new Error("更新后替票总额度小于已占用额度，请先调整替票项目或补登记替票");
  }
}

export async function createPettyCashEntry(input: PettyCashEntryInput) {
  const user = await requireFinanceOpsUser();
  const payload = normalizeEntryInput(input);
  const supabase = await createClient();
  await ensureReplacementQuotaAvailable(supabase, payload);

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
  await ensureReplacementQuotaAvailable(supabase, payload, id);

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
  await ensureReplacementInvoiceCoverage(supabase, payload);

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
  await ensureReplacementInvoiceCoverage(supabase, payload, id);

  const { error } = await supabase.from("petty_cash_replacement_invoices").update(payload).eq("id", id);

  if (error) {
    rethrowPettyCashError(error);
  }

  revalidatePath("/finance-ops");
}
