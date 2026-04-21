-- 新增问题状态 pending_rework（待返修）：待验证未通过后由审核人标记，与处理中区分。
ALTER TABLE public.issues DROP CONSTRAINT IF EXISTS issues_status_check;
ALTER TABLE public.issues ADD CONSTRAINT issues_status_check CHECK (
  status IN (
    'todo',
    'in_progress',
    'blocked',
    'pending_review',
    'pending_rework',
    'resolved',
    'closed'
  )
);
