"use server";

import { getCurrentUser } from "@/lib/auth";
import { canAccessFinanceOps } from "@/lib/permissions";
import {
  expectsInvoiceCollection,
  getReplacementQuotaUsageAmount,
  isOutstandingReimbursement,
  normalizePettyCashReplacementStatus,
  sortPettyCashEntries,
} from "@/lib/petty-cash";
import { getPettyCashSchemaHint, isPettyCashSchemaMissingError } from "@/lib/petty-cash-schema";
import { createClient } from "@/lib/supabase/server";
import type { PettyCashEntryWithRelations, PettyCashReplacementInvoiceWithRelations } from "@/types";

const pettyCashEntrySelect = `
  *,
  payer:users!petty_cash_entries_payer_user_id_fkey(id, name, avatar_url),
  creator:users!petty_cash_entries_created_by_fkey(id, name)
`;

const pettyCashReplacementInvoiceSelect = `
  *,
  creator:users!petty_cash_replacement_invoices_created_by_fkey(id, name)
`;

function createEmptyPettyCashBundle(setupMessage?: string): PettyCashBundle {
  return {
    entries: [],
    summary: {
      unreimbursedCount: 0,
      unreimbursedAmountMinor: 0,
      reimbursedThisMonthAmountMinor: 0,
      addedThisMonthAmountMinor: 0,
      pendingReplacementCount: 0,
      invoiceNotReceivedCount: 0,
      replacementInvoiceCount: 0,
      replacementTotalAmountMinor: 0,
      replacementUsedAmountMinor: 0,
      replacementAvailableAmountMinor: 0,
    },
    replacementInvoices: [],
    schemaReady: !setupMessage,
    setupMessage: setupMessage ?? null,
  };
}

function getMonthKey(dateString: string | null | undefined) {
  if (!dateString) return null;
  return dateString.slice(0, 7);
}

export type PettyCashBundle = {
  entries: PettyCashEntryWithRelations[];
  summary: {
    unreimbursedCount: number;
    unreimbursedAmountMinor: number;
    reimbursedThisMonthAmountMinor: number;
    addedThisMonthAmountMinor: number;
    pendingReplacementCount: number;
    invoiceNotReceivedCount: number;
    replacementInvoiceCount: number;
    replacementTotalAmountMinor: number;
    replacementUsedAmountMinor: number;
    replacementAvailableAmountMinor: number;
  };
  replacementInvoices: PettyCashReplacementInvoiceWithRelations[];
  schemaReady: boolean;
  setupMessage: string | null;
};

export async function getPettyCashBundle(): Promise<PettyCashBundle | null> {
  const user = await getCurrentUser();
  if (!user || !canAccessFinanceOps(user)) return null;

  const supabase = await createClient();
  const [{ data: entryData, error: entryError }, { data: replacementInvoiceData, error: replacementInvoiceError }] =
    await Promise.all([
      supabase
        .from("petty_cash_entries")
        .select(pettyCashEntrySelect)
        .order("occurred_on", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(500),
      supabase
        .from("petty_cash_replacement_invoices")
        .select(pettyCashReplacementInvoiceSelect)
        .order("received_on", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(200),
    ]);

  if (entryError || replacementInvoiceError) {
    const error = entryError ?? replacementInvoiceError;
    if (error && isPettyCashSchemaMissingError(error)) {
      return createEmptyPettyCashBundle(getPettyCashSchemaHint());
    }
    throw new Error(error?.message ?? "读取备用金登记失败");
  }

  const rows = (entryData ?? []) as PettyCashEntryWithRelations[];
  const entries = sortPettyCashEntries(
    rows.map((row) => ({
      ...row,
      invoice_replacement_status: normalizePettyCashReplacementStatus(row.invoice_replacement_status),
    }))
  );
  const replacementInvoices = (replacementInvoiceData ?? []) as PettyCashReplacementInvoiceWithRelations[];
  const currentMonthKey = getMonthKey(new Date().toISOString());

  const summary = entries.reduce<PettyCashBundle["summary"]>(
    (acc, entry) => {
      const isVoided = entry.reimbursement_status === "voided";
      if (isOutstandingReimbursement(entry.reimbursement_status)) {
        acc.unreimbursedCount += 1;
        acc.unreimbursedAmountMinor += entry.amount_minor;
      }

      if (!isVoided && getMonthKey(entry.occurred_on) === currentMonthKey) {
        acc.addedThisMonthAmountMinor += entry.amount_minor;
      }

      if (
        entry.reimbursement_status === "reimbursed" &&
        getMonthKey(entry.reimbursed_on) === currentMonthKey
      ) {
        acc.reimbursedThisMonthAmountMinor += entry.amount_minor;
      }

      if (entry.invoice_replacement_status === "pending") {
        acc.pendingReplacementCount += 1;
      }

      if (
        !isVoided &&
        expectsInvoiceCollection(entry) &&
        entry.invoice_collected_status === "not_received"
      ) {
        acc.invoiceNotReceivedCount += 1;
      }

      acc.replacementUsedAmountMinor += getReplacementQuotaUsageAmount(entry);

      return acc;
    },
    {
      unreimbursedCount: 0,
      unreimbursedAmountMinor: 0,
      reimbursedThisMonthAmountMinor: 0,
      addedThisMonthAmountMinor: 0,
      pendingReplacementCount: 0,
      invoiceNotReceivedCount: 0,
      replacementInvoiceCount: replacementInvoices.length,
      replacementTotalAmountMinor: replacementInvoices.reduce((sum, item) => sum + item.amount_minor, 0),
      replacementUsedAmountMinor: 0,
      replacementAvailableAmountMinor: 0,
    }
  );
  summary.replacementAvailableAmountMinor = summary.replacementTotalAmountMinor - summary.replacementUsedAmountMinor;

  return {
    entries,
    summary,
    replacementInvoices,
    schemaReady: true,
    setupMessage: null,
  };
}
