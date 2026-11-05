-- 合成データ専用の新規表。既存表を流用・変更しないことを生成SQLの冒頭で確認する。
create table public.tasks (
  id text primary key, title text not null default '', category text not null default '',
  project text not null default '', status text not null default '未着手',
  today boolean not null default false, today_order double precision,
  this_week boolean not null default false, weekly_order double precision, parent_id text,
  memo text not null default '', due_date text not null default '', recurrence text not null default 'none',
  recurrence_day integer, recurrence_end text not null default '', plain boolean not null default false,
  sort_order double precision, archived boolean not null default false, scheduled_date text not null default '',
  stock boolean not null default false, stock_view_id text, style jsonb, block_type text default 'task',
  canvas_x real, canvas_y real, page_id text, row_key text, col_index integer default 0,
  col_width real, code_lang text default '', day_date text default ''
);
create table public.categories (id text primary key, key text, label text, tone text, sort_order integer);
create table public.project_rules (
  id text primary key, category text, project text, recurrence text default 'none',
  recurrence_day integer, recurrence_date integer, recurrence_week integer,
  recurrence_start text default '', recurrence_end text default '', recurrence_time text default '',
  description text default '', color text default '', emoji text default ''
);
create table public.project_order (category text primary key, projects jsonb not null default '[]');
create table public.tray_items (id text primary key, title text, source text, sort_order double precision, created_at text);
create table public.app_settings (key text primary key, value jsonb);
create table public.outline_nodes (
  id text primary key, parent_id text, sort_order integer not null default 0,
  text text not null default '', collapsed boolean not null default false,
  completed boolean not null default false, favorite boolean not null default false,
  date text, heading_level integer, text_color text, bg_color text, image_width integer,
  created_at text, updated_at text
);
