-- outline-history-v1.sql の適用後に使う。本文への直接書き込みを止める処理は次段階で行う。
begin;
set local lock_timeout = '5s';
lock table public.outline_nodes in share row exclusive mode;

create table if not exists taskspace_outline_sync.operations (
  operation_id uuid primary key,
  actor_id uuid,
  request_hash text not null,
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
alter table taskspace_outline_sync.operations enable row level security;
revoke all on taskspace_outline_sync.operations from public, anon, authenticated;

create or replace function public.taskspace_outline_heads()
returns table (node_id text, revision bigint, deleted boolean)
language sql stable security definer
set search_path = pg_catalog
as $$
  select h.node_id, h.revision, h.deleted
  from taskspace_outline_sync.heads h
  order by h.node_id
$$;

-- changes は [{id, kind: put|delete, expected_revision, row?}]。
-- 1行でも版が違えば本文を一切変えず、現在の版だけを conflicts で返す。
-- 同じoperation_idの再送は、本文をもう一度触らず最初の結果を返す。
create or replace function public.taskspace_outline_apply(
  operation_id uuid,
  changes jsonb
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog
as $$
declare
  actor uuid := auth.uid();
  request_hash text := pg_catalog.md5(changes::text);
  previous taskspace_outline_sync.operations%rowtype;
  item jsonb;
  node text;
  kind text;
  expected bigint;
  actual bigint;
  conflicts jsonb := '[]'::jsonb;
  revisions jsonb := '{}'::jsonb;
  answer jsonb;
  writable_columns text[];
  names text;
  values_sql text;
  updates_sql text;
begin
  if actor is null then
    raise exception using errcode = '42501', message = 'ログインが必要です';
  end if;
  if operation_id is null or pg_catalog.jsonb_typeof(changes) <> 'array'
    or pg_catalog.jsonb_array_length(changes) < 1
    or pg_catalog.jsonb_array_length(changes) > 500 then
    raise exception using errcode = '22023', message = '1〜500件の変更と操作IDが必要です';
  end if;
  if (select pg_catalog.count(*) <> pg_catalog.count(distinct value->>'id')
      from pg_catalog.jsonb_array_elements(changes)) then
    raise exception using errcode = '22023', message = '同じidを1回の操作へ重ねられません';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(1414745932, 1);
  select * into previous from taskspace_outline_sync.operations o
    where o.operation_id = taskspace_outline_apply.operation_id;
  if found then
    if previous.actor_id is distinct from actor or previous.request_hash <> request_hash then
      raise exception using errcode = '22023', message = '操作IDが別の内容ですでに使われています';
    end if;
    return previous.result;
  end if;

  for item in select value from pg_catalog.jsonb_array_elements(changes) loop
    node := item->>'id';
    kind := item->>'kind';
    begin expected := (item->>'expected_revision')::bigint;
    exception when others then
      raise exception using errcode = '22023', message = 'expected_revisionが不正です';
    end;
    if node is null or node = '' or kind not in ('put', 'delete') or expected < 0
      or (kind = 'put' and pg_catalog.jsonb_typeof(item->'row') <> 'object')
      or (kind = 'put' and item->'row'->>'id' is distinct from node) then
      raise exception using errcode = '22023', message = '変更の形式が不正です';
    end if;
    select h.revision into actual from taskspace_outline_sync.heads h where h.node_id = node;
    actual := coalesce(actual, 0);
    if actual <> expected then
      conflicts := conflicts || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('id', node, 'expected_revision', expected, 'actual_revision', actual));
    end if;
  end loop;

  if pg_catalog.jsonb_array_length(conflicts) > 0 then
    answer := pg_catalog.jsonb_build_object('ok', false, 'conflicts', conflicts);
    insert into taskspace_outline_sync.operations values (operation_id, actor, request_hash, answer, clock_timestamp());
    return answer;
  end if;

  for item in select value from pg_catalog.jsonb_array_elements(changes) loop
    node := item->>'id';
    kind := item->>'kind';
    if kind = 'delete' then
      delete from public.outline_nodes where id = node;
    else
      -- 古い置き場で使えない任意列をクライアントが省いても、既存値をnullで潰さない。
      select pg_catalog.array_agg(a.attname order by a.attnum) into writable_columns
      from pg_catalog.pg_attribute a
      where a.attrelid = 'public.outline_nodes'::regclass and a.attnum > 0 and not a.attisdropped
        and a.attgenerated = '' and a.attidentity = '' and item->'row' ? a.attname;
      names := pg_catalog.array_to_string(writable_columns, ', ');
      select pg_catalog.string_agg(pg_catalog.format('r.%I', name), ', ') into values_sql
        from pg_catalog.unnest(writable_columns) name;
      select pg_catalog.string_agg(pg_catalog.format('%I = excluded.%I', name, name), ', ') into updates_sql
        from pg_catalog.unnest(pg_catalog.array_remove(writable_columns, 'id')) name;
      execute pg_catalog.format(
        'insert into public.outline_nodes (%s) select %s from pg_catalog.jsonb_populate_record(null::public.outline_nodes, $1) r on conflict (id) do update set %s',
        names, values_sql, updates_sql
      ) using item->'row';
    end if;
    select h.revision into actual from taskspace_outline_sync.heads h where h.node_id = node;
    revisions := revisions || pg_catalog.jsonb_build_object(node, actual);
  end loop;

  answer := pg_catalog.jsonb_build_object('ok', true, 'revisions', revisions);
  insert into taskspace_outline_sync.operations values (operation_id, actor, request_hash, answer, clock_timestamp());
  return answer;
end;
$$;

revoke all on function public.taskspace_outline_heads() from public, anon;
revoke all on function public.taskspace_outline_apply(uuid, jsonb) from public, anon;
grant execute on function public.taskspace_outline_heads() to authenticated;
grant execute on function public.taskspace_outline_apply(uuid, jsonb) to authenticated;
commit;
