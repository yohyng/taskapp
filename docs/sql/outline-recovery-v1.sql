-- 履歴・CAS SQLの適用後に使う。本文・世代・既存の確定結果は変更しない。
begin;
set local lock_timeout = '5s';

-- 元の要求を保存していない旧クライアントの操作だけを引き継ぐ。
-- 未着の旧要求をそのまま残すと、新しいIDへの移行後に遅れて適用され得る。
create or replace function public.taskspace_outline_recover_operations(operation_ids uuid[])
returns table (operation_id uuid, result jsonb)
language plpgsql security definer
set search_path = pg_catalog
as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then
    raise exception using errcode = '42501', message = 'ログインが必要です';
  end if;
  if operation_ids is null or cardinality(operation_ids) < 1 or cardinality(operation_ids) > 500
    or array_position(operation_ids, null) is not null then
    raise exception using errcode = '22023', message = '1〜500件の操作IDが必要です';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(1414745932, 1);
  if exists (select 1 from taskspace_outline_sync.operations o
    where o.operation_id = any(operation_ids) and o.actor_id is distinct from actor) then
    raise exception using errcode = '42501', message = 'この操作の結果は読めません';
  end if;

  -- md5にはならない印を使い、元のCASが後から届いても要求不一致として拒否させる。
  insert into taskspace_outline_sync.operations as o (operation_id, actor_id, request_hash, result)
    select distinct id, actor, 'retired', '{"ok":false,"retired":true}'::jsonb
    from pg_catalog.unnest(operation_ids) id
    on conflict on constraint operations_pkey do nothing;
  return query select o.operation_id, o.result from taskspace_outline_sync.operations o
    where o.operation_id = any(operation_ids) and o.actor_id = actor
    order by o.operation_id;
end;
$$;

revoke all on function public.taskspace_outline_recover_operations(uuid[]) from public, anon;
grant execute on function public.taskspace_outline_recover_operations(uuid[]) to authenticated;
commit;
