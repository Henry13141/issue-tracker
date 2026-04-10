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
  const invoiceCollectedStatus = requireOneOf(
    input.invoice_collected_status,
    PETTY_CASH_INVOICE_COLLECTED_OPTIONS,
    "收票状态"
  );
  const reimbursementStatus = requireOneOf(
    input.reimbursement_status,
    PETTY_CASH_REIMBURSEMENT_STATUS_OPTIONS,
    "报销状态"
  );

  let invoiceReplacementStatus: PettyCashInvoiceReplacementStatus;
  if (invoiceAvailability === "with_invoice") {
    invoiceReplacementStatus = "not_needed";
  } else {
    invoiceReplacementStatus = requireOneOf(
      input.invoice_replacement_status,
      PETTY_CASH_INVOICE_REPLACEMENT_OPTIONS,
      "替票状态"
    );
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
    invoice_availability: invoiceAvailability,
    invoice_replacement_status: invoiceReplacementStatus,
    invoice_collected_status: invoiceCollectedStatus,
    reimbursement_status: reimbursementStatus,
    reimbursed_on: reimbursedOn,
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
