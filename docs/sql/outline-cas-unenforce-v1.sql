-- 緊急時は書き込みを止めてから、このSQLだけを実行する。本文・履歴・CAS関数は残す。
begin;
set local lock_timeout = '5s';
lock table public.outline_nodes in share row exclusive mode;
drop trigger if exists taskspace_outline_require_cas on public.outline_nodes;
commit;
