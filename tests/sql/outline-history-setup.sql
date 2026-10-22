-- CI専用。実Supabaseでは実行しない。
create role anon nologin;
create role authenticated nologin;
alter default privileges for role postgres grant select on tables to anon, authenticated;
alter default privileges for role postgres grant usage on sequences to anon, authenticated;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;

-- 任意の追加列も、列挙漏れで控えから落とさないことを確認する。
create table public.outline_nodes (
  id text primary key,
  parent_id text,
  sort_order integer not null default 0,
  text text not null default '',
  collapsed boolean not null default false,
  completed boolean not null default false,
  favorite boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  extra jsonb
);
insert into public.outline_nodes (id, text, extra)
  values ('baseline-a', '移行前の本文', '{"画像の幅":640,"色":"青"}');
alter table public.outline_nodes enable row level security;
grant select, insert, update, delete on public.outline_nodes to authenticated, anon;
create policy owner_access on public.outline_nodes to authenticated
  using (auth.uid() = '11111111-1111-4111-8111-111111111111'::uuid)
  with check (auth.uid() = '11111111-1111-4111-8111-111111111111'::uuid);

create schema outline_test;
create function outline_test.assert(ok boolean, message text) returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception '検証失敗: %', message; end if;
end;
$$;
grant usage on schema outline_test to authenticated;
grant execute on function outline_test.assert(boolean, text) to authenticated;
create table outline_test.before_install as select to_jsonb(n) as row_data from public.outline_nodes n;
