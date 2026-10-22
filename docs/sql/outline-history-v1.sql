-- 本番へ自動適用しない。適用条件と停止手順はdocs/outline-server-history.mdを先に読む。
begin;
set local lock_timeout = '5s';
-- 初期控えの取得中に本文が動くと、最初の世代と実体が食い違う。
lock table public.outline_nodes in share row exclusive mode;

do $$
begin
  if (select relkind from pg_catalog.pg_class where oid = 'public.outline_nodes'::regclass) <> 'r'
    or not exists (
      select 1 from pg_catalog.pg_attribute
      where attrelid = 'public.outline_nodes'::regclass and attname = 'id'
        and atttypid = 'text'::regtype and not attisdropped
    ) then
    raise exception '通常のoutline_nodesテーブルとtext型のidが必要です';
  end if;
end;
$$;

create schema if not exists taskspace_outline_sync;
revoke all on schema taskspace_outline_sync from public, anon, authenticated;

create table if not exists taskspace_outline_sync.installation (
  singleton boolean primary key default true check (singleton),
  format integer not null check (format = 1),
  source_oid oid not null,
  installed_at timestamptz not null default clock_timestamp()
);
create table if not exists taskspace_outline_sync.heads (
  node_id text primary key,
  revision bigint not null check (revision > 0),
  deleted boolean not null,
  row_data jsonb,
  changed_at timestamptz not null,
  actor_id uuid,
  check (deleted = (row_data is null)),
  check (row_data is null or row_data->>'id' = node_id)
);
create table if not exists taskspace_outline_sync.events (
  seq bigint generated always as identity primary key,
  node_id text not null,
  revision bigint not null check (revision > 0),
  kind text not null check (kind in ('baseline', 'insert', 'update', 'delete')),
  before_row jsonb,
  after_row jsonb,
  changed_at timestamptz not null,
  actor_id uuid,
  unique (node_id, revision),
  check (
    (kind in ('baseline', 'insert') and before_row is null and after_row is not null)
    or (kind = 'update' and before_row is not null and after_row is not null)
    or (kind = 'delete' and before_row is not null and after_row is null)
  ),
  check (before_row is null or before_row->>'id' = node_id),
  check (after_row is null or after_row->>'id' = node_id)
);

-- 復元で本文の表が作り直された場合や記録が欠けた場合に、平常の再適用として扱わない。
do $$
declare saved taskspace_outline_sync.installation%rowtype;
begin
  select * into saved from taskspace_outline_sync.installation where singleton;
  if found then
    if saved.format <> 1 or saved.source_oid <> 'public.outline_nodes'::regclass::oid then
      raise exception '記録の形式または本文の表が変わっています。控えを照合してください';
    end if;
    if exists (
      select 1 from public.outline_nodes n
      left join taskspace_outline_sync.heads h on h.node_id = n.id
      where h.node_id is null or h.deleted or h.row_data is distinct from to_jsonb(n)
    ) or exists (
      select 1 from taskspace_outline_sync.heads h
      left join public.outline_nodes n on n.id = h.node_id
      where not h.deleted and n.id is null
    ) or exists (
      select 1 from taskspace_outline_sync.heads h
      left join taskspace_outline_sync.events e on e.node_id = h.node_id and e.revision = h.revision
      where e.seq is null or e.after_row is distinct from h.row_data
    ) or exists (
      select 1 from taskspace_outline_sync.events e
      left join taskspace_outline_sync.heads h on h.node_id = e.node_id
      where h.node_id is null or e.revision > h.revision
    ) then
      raise exception '本文と変更記録が一致しません。記録を消さずに調査してください';
    end if;
  else
    if exists (select 1 from taskspace_outline_sync.heads)
      or exists (select 1 from taskspace_outline_sync.events) then
      raise exception '出所の分からない変更記録があります';
    end if;
    insert into taskspace_outline_sync.installation (format, source_oid)
      values (1, 'public.outline_nodes'::regclass::oid);
  end if;
end;
$$;

insert into taskspace_outline_sync.heads (node_id, revision, deleted, row_data, changed_at, actor_id)
  select n.id, 1, false, to_jsonb(n), clock_timestamp(), null from public.outline_nodes n
  on conflict (node_id) do nothing;
insert into taskspace_outline_sync.events (node_id, revision, kind, before_row, after_row, changed_at, actor_id)
  select h.node_id, h.revision, 'baseline', null, h.row_data, h.changed_at, null
  from taskspace_outline_sync.heads h
  where not exists (select 1 from taskspace_outline_sync.events e where e.node_id = h.node_id);

create or replace function taskspace_outline_sync.record_change(
  change_kind text, previous jsonb, current_row jsonb
) returns void
language plpgsql security definer
set search_path = pg_catalog
as $$
declare
  node text := coalesce(current_row->>'id', previous->>'id');
  new_revision bigint;
  at_time timestamptz := clock_timestamp();
  actor uuid := auth.uid();
begin
  insert into taskspace_outline_sync.heads as h (node_id, revision, deleted, row_data, changed_at, actor_id)
    values (node, 1, current_row is null, current_row, at_time, actor)
    on conflict (node_id) do update set
      revision = h.revision + 1, deleted = excluded.deleted, row_data = excluded.row_data,
      changed_at = excluded.changed_at, actor_id = excluded.actor_id
    returning revision into new_revision;
  insert into taskspace_outline_sync.events (node_id, revision, kind, before_row, after_row, changed_at, actor_id)
    values (node, new_revision, change_kind, previous, current_row, at_time, actor);
end;
$$;

create or replace function taskspace_outline_sync.lock_writes()
returns trigger language plpgsql security definer
set search_path = pg_catalog
as $$
begin
  -- 別行への書き込みも確定順に並べる。未確定の小さいseqを後から取りこぼさないため。
  perform pg_catalog.pg_advisory_xact_lock(1414745932, 1);
  return null;
end;
$$;

create or replace function taskspace_outline_sync.capture_change()
returns trigger language plpgsql security definer
set search_path = pg_catalog
as $$
begin
  if tg_op = 'INSERT' then
    perform taskspace_outline_sync.record_change('insert', null, to_jsonb(new));
  elsif tg_op = 'DELETE' then
    perform taskspace_outline_sync.record_change('delete', to_jsonb(old), null);
  elsif new.id is distinct from old.id then
    -- 管理用SQLでidが変わっても、前のidの削除記録を残す。
    perform taskspace_outline_sync.record_change('delete', to_jsonb(old), null);
    perform taskspace_outline_sync.record_change('insert', null, to_jsonb(new));
  elsif to_jsonb(new) is distinct from to_jsonb(old) then
    -- 同じ内容の再送だけでは、世代と履歴を増やさない。
    perform taskspace_outline_sync.record_change('update', to_jsonb(old), to_jsonb(new));
  end if;
  return null;
end;
$$;

create or replace function taskspace_outline_sync.reject_truncate()
returns trigger language plpgsql security definer
set search_path = pg_catalog
as $$
begin
  raise exception using errcode = '0A000',
    message = '削除前の本文を残すため、TRUNCATEではなくDELETEを使ってください';
end;
$$;

create or replace trigger taskspace_outline_lock
  before insert or update or delete on public.outline_nodes
  for each statement execute function taskspace_outline_sync.lock_writes();
create or replace trigger taskspace_outline_capture
  after insert or update or delete on public.outline_nodes
  for each row execute function taskspace_outline_sync.capture_change();
create or replace trigger taskspace_outline_no_truncate
  before truncate on public.outline_nodes
  for each statement execute function taskspace_outline_sync.reject_truncate();

-- 履歴には削除前の文章も含まれる。通常のAPI・公開ロールへ直接開放しない。
alter table taskspace_outline_sync.installation enable row level security;
alter table taskspace_outline_sync.heads enable row level security;
alter table taskspace_outline_sync.events enable row level security;
revoke all on all tables in schema taskspace_outline_sync from public, anon, authenticated;
revoke all on all sequences in schema taskspace_outline_sync from public, anon, authenticated;
revoke all on all functions in schema taskspace_outline_sync from public, anon, authenticated;
commit;
