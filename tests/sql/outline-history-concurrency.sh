#!/usr/bin/env bash
set -euo pipefail

# CIの使い捨てDBだけを使う。ホストへの追加のPostgreSQLクライアントは不要。
psql() {
  docker exec -i -e "PGAPPNAME=${PGAPPNAME:-outline-history-tests}" "$POSTGRES_CONTAINER" \
    psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"
}
tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT

# 異なる行でも、未確定の小さいseqを後から取りこぼさないことを確かめる。
PGAPPNAME=outline-history-first psql -c "
  begin;
  insert into public.outline_nodes (id, text) values ('concurrent-a', '先に確定する行');
  select pg_sleep(5);
  commit;
" >"$tmp_dir/first.log" 2>&1 &
first_pid=$!
first_ready=false
for attempt in {1..40}; do
  if [[ "$(psql -Atqc "select exists(select 1 from pg_stat_activity where application_name='outline-history-first' and wait_event='PgSleep')")" == "t" ]]; then
    first_ready=true
    break
  fi
  sleep 0.1
done
[[ "$first_ready" == true ]] || { cat "$tmp_dir/first.log"; exit 1; }

PGAPPNAME=outline-history-second psql -c "
  insert into public.outline_nodes (id, text) values ('concurrent-b', 'あとから確定する行');
" >"$tmp_dir/second.log" 2>&1 &
second_pid=$!
waited=false
for attempt in {1..30}; do
  if [[ "$(psql -Atqc "select exists(select 1 from pg_locks l join pg_stat_activity a on a.pid=l.pid where a.application_name='outline-history-second' and l.locktype='advisory' and not l.granted)")" == "t" ]]; then
    waited=true
    break
  fi
  sleep 0.1
done
[[ "$waited" == true ]] || { cat "$tmp_dir/second.log"; exit 1; }
wait "$first_pid"
wait "$second_pid"
psql -c "select outline_test.assert(
  (select seq from taskspace_outline_sync.events where node_id='concurrent-a')
  < (select seq from taskspace_outline_sync.events where node_id='concurrent-b'),
  '別の行の取引も確定順に履歴を進める');"

# 同じ行を同時に書いても、途中の版と上書き前の文章を残す。
psql -c "insert into public.outline_nodes (id, text) values ('shared', '最初の本文');"
for actor in a b; do
  sql_text="begin;"
  for revision in {1..6}; do
    sql_text+="update public.outline_nodes set text='端末${actor}-${revision}' where id='shared';"
  done
  sql_text+="commit;"
  psql -c "$sql_text" >"$tmp_dir/$actor.log" 2>&1 &
  if [[ "$actor" == a ]]; then actor_a=$!; else actor_b=$!; fi
done
wait "$actor_a"
wait "$actor_b"
psql <<'SQL'
select outline_test.assert(
  (select revision=13 from taskspace_outline_sync.heads where node_id='shared')
  and (select count(*)=13 from taskspace_outline_sync.events where node_id='shared'),
  '同時更新の世代を重複させず全版を残す');
select outline_test.assert(not exists (
  select 1 from taskspace_outline_sync.events e
  join taskspace_outline_sync.events p on p.node_id=e.node_id and p.revision=e.revision-1
  where e.node_id='shared' and e.before_row is distinct from p.after_row
), '同時更新でも変更前と直前の変更後をつなげる');
SQL
echo '確認: 別行の確定順・同じ行の同時更新'
