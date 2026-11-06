-- 検証用。旧outline_nodesには触れない。初期snapshotは管理側で一度だけ投入する。
-- クライアントは文書作成やsnapshot置換を許可されず、本人の差分追記だけを行う。
create schema if not exists taskspace_loro;
revoke all on schema taskspace_loro from public, anon, authenticated;
create table if not exists public.taskspace_loro_documents (
  id uuid primary key, owner_id uuid not null,
  head bigint not null default 0 check (head between 0 and 9007199254740991)
);
create table if not exists taskspace_loro.snapshots (
  doc_id uuid primary key references public.taskspace_loro_documents(id),
  bytes bytea not null check (octet_length(bytes) > 0)
);
create table if not exists taskspace_loro.updates (
  doc_id uuid not null references public.taskspace_loro_documents(id),
  sequence bigint not null, update_id uuid not null, bytes bytea not null,
  primary key (doc_id, sequence), unique(doc_id, update_id),
  check (octet_length(bytes) between 1 and 65536)
);
revoke all on public.taskspace_loro_documents from public, anon, authenticated;
revoke all on taskspace_loro.updates from public, anon, authenticated;
revoke all on taskspace_loro.snapshots from public, anon, authenticated;
grant select on public.taskspace_loro_documents to authenticated;
alter table public.taskspace_loro_documents enable row level security;
drop policy if exists taskspace_loro_owner on public.taskspace_loro_documents;
create policy taskspace_loro_owner on public.taskspace_loro_documents for select to authenticated
  using (owner_id = (select auth.uid()));

create or replace function public.taskspace_loro_exchange(p_doc uuid, p_cursor bigint, p_updates jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  current_doc public.taskspace_loro_documents%rowtype;
  item jsonb; body bytea; prior bytea; operation uuid; next_sequence bigint;
  acknowledged jsonb := '[]'; page jsonb; last_sequence bigint; total_bytes bigint := 0; initial bytea;
begin
  if auth.uid() is null then raise insufficient_privilege using message = 'ログインが必要です'; end if;
  -- 採番から確定まで同じ文書を直列化する。serialの採番だけでは確定順の逆転を防げない。
  select * into current_doc from public.taskspace_loro_documents
    where id = p_doc and owner_id = auth.uid() for update;
  if not found then raise insufficient_privilege using message = '文書を利用できません'; end if;
  if p_cursor is null or p_cursor < -1 or p_cursor > current_doc.head
    or p_updates is null or jsonb_typeof(p_updates) <> 'array' then
    raise exception '取得位置か送信内容が不正です';
  end if;
  if jsonb_array_length(p_updates) > 32 then raise exception '一度の送信が多すぎます'; end if;
  next_sequence := current_doc.head;
  for item in select value from jsonb_array_elements(p_updates) loop
    if jsonb_typeof(item->'id') <> 'string' or jsonb_typeof(item->'bytes') <> 'string'
      or item->>'id' is null or item->>'bytes' is null then raise exception '差分が不正です'; end if;
    operation := (item->>'id')::uuid;
    if length(item->>'bytes') > 90000 then raise exception '差分が大きすぎます'; end if;
    body := decode(item->>'bytes', 'base64'); total_bytes := total_bytes + octet_length(body);
    if octet_length(body) not between 1 and 65536 or total_bytes > 262144 then raise exception '送信量が多すぎます'; end if;
    select bytes into prior from taskspace_loro.updates where doc_id = p_doc and update_id = operation;
    if found then
      if prior <> body then raise exception '同じ操作IDの内容が違います'; end if;
    else
      next_sequence := next_sequence + 1;
      insert into taskspace_loro.updates values(p_doc, next_sequence, operation, body);
    end if;
    acknowledged := acknowledged || jsonb_build_array(operation::text);
  end loop;
  -- 読み取りだけではUPDATEを発行せず、通知から通知を送り返す循環を作らない。
  if next_sequence <> current_doc.head then
    update public.taskspace_loro_documents set head = next_sequence where id = p_doc;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('sequence', sequence, 'bytes', encode(bytes, 'base64')) order by sequence), '[]'),
    coalesce(max(sequence), greatest(p_cursor, 0)) into page, last_sequence
    from (select sequence, bytes from taskspace_loro.updates
      where doc_id = p_doc and sequence > greatest(p_cursor, 0) order by sequence limit 32) batch;
  -- snapshotは不変でcutoff=0。圧縮・削除はまだ実装せず、初回取得中の取りこぼしを避ける。
  if p_cursor = -1 then
    select bytes into strict initial from taskspace_loro.snapshots where doc_id = p_doc;
  end if;
  return jsonb_build_object('cursor', last_sequence, 'head', next_sequence,
    'snapshot', case when p_cursor = -1 then encode(initial, 'base64') else null end,
    'updates', page, 'acknowledged', acknowledged);
end $$;
revoke all on function public.taskspace_loro_exchange(uuid, bigint, jsonb) from public, anon;
grant execute on function public.taskspace_loro_exchange(uuid, bigint, jsonb) to authenticated;
-- Supabase以外の使い捨てPostgresでも同じSQLを試験する。
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'taskspace_loro_documents') then
    alter publication supabase_realtime add table public.taskspace_loro_documents;
  end if;
end $$;
