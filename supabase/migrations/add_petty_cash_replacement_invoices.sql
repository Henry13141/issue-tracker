-- 备用金：替票额度池

CREATE TABLE IF NOT EXISTS public.petty_cash_replacement_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  received_on DATE NOT NULL,
  title TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  notes TEXT,
  created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_petty_cash_replacement_invoices_received_on
  ON public.petty_cash_replacement_invoices (received_on DESC);

DROP TRIGGER IF EXISTS petty_cash_replacement_invoices_updated_at ON public.petty_cash_replacement_invoices;
CREATE TRIGGER petty_cash_replacement_invoices_updated_at
  BEFORE UPDATE ON public.petty_cash_replacement_invoices
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

ALTER TABLE public.petty_cash_replacement_invoices ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'petty_cash_replacement_invoices'
      AND policyname = 'petty_cash_replacement_invoices_select_access'
  ) THEN
    CREATE POLICY "petty_cash_replacement_invoices_select_access"
      ON public.petty_cash_replacement_invoices FOR SELECT
      TO authenticated
      USING (public.has_finance_ops_access());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'petty_cash_replacement_invoices'
      AND policyname = 'petty_cash_replacement_invoices_insert_access'
  ) THEN
    CREATE POLICY "petty_cash_replacement_invoices_insert_access"
      ON public.petty_cash_replacement_invoices FOR INSERT
      TO authenticated
      WITH CHECK (public.has_finance_ops_access() AND created_by = auth.uid());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'petty_cash_replacement_invoices'
      AND policyname = 'petty_cash_replacement_invoices_update_access'
  ) THEN
    CREATE POLICY "petty_cash_replacement_invoices_update_access"
      ON public.petty_cash_replacement_invoices FOR UPDATE
      TO authenticated
      USING (public.has_finance_ops_access())
      WITH CHECK (public.has_finance_ops_access());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'petty_cash_replacement_invoices'
      AND policyname = 'petty_cash_replacement_invoices_delete_access'
  ) THEN
    CREATE POLICY "petty_cash_replacement_invoices_delete_access"
      ON public.petty_cash_replacement_invoices FOR DELETE
      TO authenticated
      USING (public.has_finance_ops_access());
  END IF;
END $$;

ALTER TABLE public.petty_cash_entries
  DROP CONSTRAINT IF EXISTS petty_cash_entries_invoice_replacement_status_check;

ALTER TABLE public.petty_cash_entries
  ADD CONSTRAINT petty_cash_entries_invoice_replacement_status_check
  CHECK (invoice_replacement_status IN ('not_needed', 'pending', 'matched'));
