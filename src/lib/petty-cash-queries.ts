"use server";

import { getCurrentUser } from "@/lib/auth";
import { canAccessFinanceOps } from "@/lib/permissions";
import {
  expectsInvoiceCollection,
  isOutstandingReimbursement,
  normalizePettyCashReplacementStatus,
  sortPettyCashEntries,
} from "@/lib/petty-cash";
import { getPettyCashSchemaHint, isPettyCashSchemaMissingError } from "@/lib/petty-cash-schema";
import { createClient } from "@/lib/supabase/server";
import type { PettyCashEntryWithRelations } from "@/types";

const pettyCashEntrySelect = `
  *,
  payer:users!petty_cash_entries_payer_user_id_fkey(id, name, avatar_url),
  creator:users!petty_cash_entries_created_by_fkey(id, name)
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
    },
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
  };
  schemaReady: boolean;
  setupMessage: string | null;
};

export async function getPettyCashBundle(): Promise<PettyCashBundle | null> {
  const user = await getCurrentUser();
  if (!user || !canAccessFinanceOps(user)) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("petty_cash_entries")
    .select(pettyCashEntrySelect)
    .order("occurred_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) {
    if (isPettyCashSchemaMissingError(error)) {
      return createEmptyPettyCashBundle(getPettyCashSchemaHint());
    }
    throw new Error(error.message);
  }

  const rows = (data ?? []) as PettyCashEntryWithRelations[];
  const entries = sortPettyCashEntries(
    rows.map((row) => ({
      ...row,
      invoice_replacement_status: normalizePettyCashReplacementStatus(row.invoice_replacement_status),
    }))
  );
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

      return acc;
    },
    {
      unreimbursedCount: 0,
      unreimbursedAmountMinor: 0,
      reimbursedThisMonthAmountMinor: 0,
      addedThisMonthAmountMinor: 0,
      pendingReplacementCount: 0,
      invoiceNotReceivedCount: 0,
    }
  );

  return {
    entries,
    summary,
    schemaReady: true,
    setupMessage: null,
  };
}
