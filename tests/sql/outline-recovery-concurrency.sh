#!/usr/bin/env bash
set -euo pipefail

# CI専用。同じロックを本当に待つことまで、2つの接続で確認する。
psql() {
  docker exec -i -e "PGAPPNAME=${PGAPPNAME:-outline-recovery-tests}" "$POSTGRES_CONTAINER" \
    psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"
}
tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT
wait_for() {
  local query="$1"
  for attempt in {1..50}; do
    if [[ "$(psql -Atqc "$query")" == t ]]; then return; fi
    sleep 0.1
  done
  cat "$tmp_dir"/*.log
  return 1
}
psql -c "insert into public.outline_nodes(id,text) values ('recover-race','元の本文'), ('apply-race','元の本文');"

PGAPPNAME=recovery-first psql >"$tmp_dir/recover.log" 2>&1 <<'SQL' &
begin;
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
select * from public.taskspace_outline_recover_operations(array['eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'::uuid]);
select pg_sleep(5);
commit;
SQL
first=$!
wait_for "select exists(select 1 from pg_stat_activity where application_name='recovery-first' and wait_event='PgSleep')"
PGAPPNAME=recovery-late-apply psql >"$tmp_dir/late.log" 2>&1 <<'SQL' &
begin;
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
do $$ begin
  begin
    perform public.taskspace_outline_apply('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      '[{"id":"recover-race","kind":"put","expected_revision":1,"row":{"id":"recover-race","text":"遅れた本文"}}]'::jsonb);
    raise exception '失効を追い越して古い保存が通りました';
  exception when invalid_parameter_value then null;
  end;
end; $$;
commit;
SQL
second=$!
wait_for "select exists(select 1 from pg_locks l join pg_stat_activity a on a.pid=l.pid where a.application_name='recovery-late-apply' and l.locktype='advisory' and not l.granted)"
wait "$first"
wait "$second"
psql -c "select outline_test.assert((select text='元の本文' from public.outline_nodes where id='recover-race'), '先に引き継いだ要求は遅れて適用されない');"

PGAPPNAME=recovery-apply-first psql >"$tmp_dir/apply.log" 2>&1 <<'SQL' &
begin;
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
select public.taskspace_outline_apply('ffffffff-ffff-4fff-8fff-ffffffffffff',
  '[{"id":"apply-race","kind":"put","expected_revision":1,"row":{"id":"apply-race","text":"先に届いた本文"}}]'::jsonb);
select pg_sleep(5);
commit;
SQL
first=$!
wait_for "select exists(select 1 from pg_stat_activity where application_name='recovery-apply-first' and wait_event='PgSleep')"
PGAPPNAME=recovery-after-apply psql >"$tmp_dir/after.log" 2>&1 <<'SQL' &
begin;
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
select outline_test.assert((select result->>'ok'='true' from public.taskspace_outline_recover_operations(
  array['ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid])), '先に届いた保存は失効させず確定結果を返す');
commit;
SQL
second=$!
wait_for "select exists(select 1 from pg_locks l join pg_stat_activity a on a.pid=l.pid where a.application_name='recovery-after-apply' and l.locktype='advisory' and not l.granted)"
wait "$first"
wait "$second"
psql -c "select outline_test.assert((select revision=2 from taskspace_outline_sync.heads where node_id='apply-race'), '先に届いた保存の世代を増やさない');"
