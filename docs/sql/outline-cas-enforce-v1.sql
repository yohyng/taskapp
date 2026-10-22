-- 履歴SQLとCAS SQL、対応クライアントの配信後に適用する。
-- 古いPWAの直接upsert/deleteを拒否し、CAS RPCとDB管理者の操作だけを通す。
begin;
set local lock_timeout = '5s';
lock table public.outline_nodes in share row exclusive mode;

create or replace function taskspace_outline_sync.require_cas()
returns trigger language plpgsql
set search_path = pg_catalog
as $$
begin
  if current_user in ('anon', 'authenticated')
    and coalesce(pg_catalog.current_setting('taskspace_outline_sync.cas_operation', true), '') = '' then
    raise exception using errcode = '40001',
      message = 'アウトラインを更新してから同期してください',
      hint = '古いPWAからの直接保存を止めました。アプリを閉じて開き直してください';
  end if;
  return null;
end;
$$;

revoke all on function taskspace_outline_sync.require_cas() from public, anon, authenticated;
create or replace trigger taskspace_outline_require_cas
  before insert or update or delete on public.outline_nodes
  for each statement execute function taskspace_outline_sync.require_cas();
commit;
