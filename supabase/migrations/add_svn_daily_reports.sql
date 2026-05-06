-- SVN 每日研发日报表
-- 每天一条记录；同一天重复上报时更新，不重复创建。
-- 原始 SVN 文件路径明细不长期保存，只保存 AI 摘要和轻量统计。

create table if not exists svn_daily_reports (
  id           uuid primary key default gen_random_uuid(),
  report_date  date not null unique,            -- 日期，唯一约束，同天覆盖
  title        text not null,                   -- 例如"2026-04-29 研发日报"
  summary      text not null,                   -- AI 或规则生成的 Markdown 摘要
  stats        jsonb not null default '{}' check (jsonb_typeof(stats) = 'object'), -- 轻量统计：提交人数、提交次数、无备注数等
  authors      jsonb not null default '[]' check (jsonb_typeof(authors) = 'array'), -- 当天有提交的成员列表（显示名）
  generated_by text not null default 'ai' check (generated_by in ('ai', 'rule')), -- 'ai' | 'rule'
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- 按日期倒序查询用
create index if not exists svn_daily_reports_date_idx on svn_daily_reports (report_date desc);

-- RLS：登录用户可读，写入只走 service role / ingest API
alter table svn_daily_reports enable row level security;

create policy "authenticated users can read svn_daily_reports"
  on svn_daily_reports for select
  to authenticated
  using (true);

-- 更新时维护 updated_at
create or replace function update_svn_daily_reports_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists svn_daily_reports_updated_at on svn_daily_reports;

create trigger svn_daily_reports_updated_at
  before update on svn_daily_reports
  for each row execute function update_svn_daily_reports_updated_at();
