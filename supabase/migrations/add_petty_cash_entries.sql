-- 备用金登记：垫付 / 发票 / 报销台账

CREATE TABLE IF NOT EXISTS public.petty_cash_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_on DATE NOT NULL,
  payer_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  expense_project TEXT NOT NULL
    CHECK (
      expense_project IN (
        'admin_procurement_invoice',
        'office_supplies_invoice',
        'employee_benefits_invoice',
        'hospitality_replacement',
        'logistics_invoice',
        'travel_mixed',
        'maintenance_mixed',
        'other'
      )
    ),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL DEFAULT 'CNY' CHECK (currency = 'CNY'),
  payment_method TEXT NOT NULL
    CHECK (payment_method IN ('wechat', 'alipay', 'bank_transfer', 'cash', 'other')),
  invoice_availability TEXT NOT NULL
    CHECK (invoice_availability IN ('with_invoice', 'without_invoice')),
  invoice_replacement_status TEXT NOT NULL DEFAULT 'not_needed'
    CHECK (invoice_replacement_status IN ('not_needed', 'pending')),
  invoice_collected_status TEXT NOT NULL DEFAULT 'not_received'
    CHECK (invoice_collected_status IN ('not_received', 'received')),
  reimbursement_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (reimbursement_status IN ('pending', 'in_progress', 'reimbursed', 'voided')),
  reimbursed_on DATE,
  notes TEXT,
  created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT petty_cash_entries_reimbursed_date_check CHECK (
    (reimbursement_status = 'reimbursed' AND reimbursed_on IS NOT NULL) OR
    (reimbursement_status IN ('pending', 'in_progress', 'voided') AND reimbursed_on IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_petty_cash_entries_occurred_on
  ON public.petty_cash_entries (occurred_on DESC, reimbursement_status);

CREATE INDEX IF NOT EXISTS idx_petty_cash_entries_payer
  ON public.petty_cash_entries (payer_user_id, occurred_on DESC);

CREATE INDEX IF NOT EXISTS idx_petty_cash_entries_project
  ON public.petty_cash_entries (expense_project, occurred_on DESC);

CREATE INDEX IF NOT EXISTS idx_petty_cash_entries_invoice
  ON public.petty_cash_entries (
    invoice_availability,
    invoice_replacement_status,
    invoice_collected_status
  );

DROP TRIGGER IF EXISTS petty_cash_entries_updated_at ON public.petty_cash_entries;
CREATE TRIGGER petty_cash_entries_updated_at
  BEFORE UPDATE ON public.petty_cash_entries
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

ALTER TABLE public.petty_cash_entries ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'petty_cash_entries'
      AND policyname = 'petty_cash_entries_select_access'
  ) THEN
    CREATE POLICY "petty_cash_entries_select_access"
      ON public.petty_cash_entries FOR SELECT
      TO authenticated
      USING (public.has_finance_ops_access());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'petty_cash_entries'
      AND policyname = 'petty_cash_entries_insert_access'
  ) THEN
    CREATE POLICY "petty_cash_entries_insert_access"
      ON public.petty_cash_entries FOR INSERT
      TO authenticated
      WITH CHECK (public.has_finance_ops_access() AND created_by = auth.uid());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'petty_cash_entries'
      AND policyname = 'petty_cash_entries_update_access'
  ) THEN
    CREATE POLICY "petty_cash_entries_update_access"
      ON public.petty_cash_entries FOR UPDATE
      TO authenticated
      USING (public.has_finance_ops_access())
      WITH CHECK (public.has_finance_ops_access());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'petty_cash_entries'
      AND policyname = 'petty_cash_entries_delete_access'
  ) THEN
    CREATE POLICY "petty_cash_entries_delete_access"
      ON public.petty_cash_entries FOR DELETE
      TO authenticated
      USING (public.has_finance_ops_access());
  END IF;
END $$;
