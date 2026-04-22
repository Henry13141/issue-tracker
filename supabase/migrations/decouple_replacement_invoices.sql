-- 将现有 matched/pending 替票状态全部归一化为 not_needed
-- 替票与备用金登记完全解耦后，invoice_replacement_status 字段不再有业务意义
UPDATE petty_cash_entries
  SET invoice_replacement_status = 'not_needed'
  WHERE invoice_replacement_status IN ('matched', 'pending');
