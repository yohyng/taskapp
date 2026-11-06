-- 検証用の切替管理。インストールだけでは旧同期を停止しない。
-- 管理側がidleをpreparingへ進めた取引から旧書き込みを止め、その後の凍結済みデータから
-- 一つのsnapshotを作って投入し、activeへ進める。ブラウザーに登録・解除は許可しない。
create table if not exists taskspace_loro.legacy_cutover (
  singleton boolean primary key default true check (singleton),
  migration_id uuid unique, owner_id uuid, doc_id uuid,
  phase text not null check (phase in ('idle', 'preparing', 'active')),
  check ((phase = 'idle' and migration_id is null and owner_id is null and doc_id is null)
    or (phase <> 'idle' and migration_id is not null and owner_id is not null and doc_id is not null))
);
revoke all on taskspace_loro.legacy_cutover from public, anon, authenticated;

create or replace function taskspace_loro.check_legacy_cutover()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- 旧履歴の取引ロックと同じキー。停止の直前の書き込みも先に確定させる。
  perform pg_catalog.pg_advisory_xact_lock(1414745932, 1);
  if tg_op = 'DELETE' then
    raise exception '切り戻しには新同期での編集の保全と管理用の手順が必要です';
  end if;
  if tg_op = 'UPDATE' and old.phase <> 'idle' and (new.migration_id, new.owner_id, new.doc_id) is distinct from (old.migration_id, old.owner_id, old.doc_id) then
    raise exception '切り替え先を別の文書へ変更できません';
  end if;
  if tg_op = 'INSERT' and new.phase <> 'idle' then raise exception '先に旧同期を停止してください'; end if;
  if tg_op = 'UPDATE' and old.phase = 'idle' and new.phase = 'active' then raise exception '先に旧同期を停止してください'; end if;
  if tg_op = 'UPDATE' and old.phase = 'preparing' and new.phase = 'idle' then raise exception '旧同期へ直接戻せません'; end if;
  if tg_op = 'UPDATE' and old.phase = 'active' and new.phase <> 'active' then raise exception '旧同期へ直接戻せません'; end if;
  if new.phase = 'active' and not exists (
    select 1 from public.taskspace_loro_documents d join taskspace_loro.snapshots s on s.doc_id = d.id
    where d.id = new.doc_id and d.owner_id = new.owner_id
  ) then raise exception '移行先の原本と所有者が揃っていません'; end if;
  return new;
end $$;
create or replace trigger taskspace_loro_cutover_guard
  before insert or update or delete on taskspace_loro.legacy_cutover
  for each row execute function taskspace_loro.check_legacy_cutover();
insert into taskspace_loro.legacy_cutover(singleton, phase) values(true, 'idle') on conflict (singleton) do nothing;

create or replace function taskspace_loro.block_legacy_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare current_phase text;
begin
  perform pg_catalog.pg_advisory_xact_lock(1414745932, 1);
  -- 常在する一行をロックする。REPEATABLE READの古い取引も、停止前の写しで
  -- 書き込まず、行の更新検出による直列化失敗になる。行が欠けても許可へ倒さない。
  select phase into current_phase from taskspace_loro.legacy_cutover where singleton for update;
  if not found or current_phase <> 'idle' then
    raise exception using errcode = '55000', message = '旧アウトラインへの書き込みは停止しています';
  end if;
  return null;
end $$;
-- 実際の旧テーブルを明示した別SQL。合成表を本番の代わりに自動生成しない。
create or replace trigger taskspace_loro_legacy_fence
  before insert or update or delete or truncate on public.outline_nodes
  for each statement execute function taskspace_loro.block_legacy_write();

create or replace function public.taskspace_loro_cutover_route()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare route taskspace_loro.legacy_cutover%rowtype;
begin
  if auth.uid() is null then raise insufficient_privilege using message = 'ログインが必要です'; end if;
  select * into route from taskspace_loro.legacy_cutover where owner_id = auth.uid() and phase = 'active';
  if not found then raise insufficient_privilege using message = '旧同期の停止と移行先を確認できません'; end if;
  return jsonb_build_object('format', 1, 'migrationId', route.migration_id::text, 'ownerId', route.owner_id::text,
    'docId', route.doc_id::text, 'legacyWritesBlocked', true);
end $$;
revoke all on function taskspace_loro.check_legacy_cutover() from public, anon, authenticated;
revoke all on function taskspace_loro.block_legacy_write() from public, anon, authenticated;
revoke all on function public.taskspace_loro_cutover_route() from public, anon;
grant execute on function public.taskspace_loro_cutover_route() to authenticated;
