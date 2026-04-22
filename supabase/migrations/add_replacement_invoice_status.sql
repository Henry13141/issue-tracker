-- 替票登记加入使用状态：available（可用）/ used（已使用）
-- 已使用的替票不计入可用替票金额

ALTER TABLE public.petty_cash_replacement_invoices
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'available'
  CHECK (status IN ('available', 'used'));
