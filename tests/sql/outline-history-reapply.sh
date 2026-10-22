#!/usr/bin/env bash
set -euo pipefail
psql() {
  docker exec -i "$POSTGRES_CONTAINER" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"
}
tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT

# 故障は外側の取引に閉じ込める。SQLが中止すると接続終了で故障も取り消される。
expect_rejected() {
  local broken_sql=$1
  local expected_message=$2
  {
    printf '%s\n' 'begin;' "$broken_sql"
    cat docs/sql/outline-history-v1.sql
  } > "$tmp_dir/broken.sql"
  if psql < "$tmp_dir/broken.sql" > "$tmp_dir/result.log" 2>&1; then
    cat "$tmp_dir/result.log"
    echo '不整合があるのに再適用が成功しました'
    exit 1
  fi
  [[ "$(<"$tmp_dir/result.log")" == *"$expected_message"* ]] || {
    cat "$tmp_dir/result.log"
    exit 1
  }
  psql -c "select outline_test.assert(
    (select text='移行前の本文' from public.outline_nodes where id='baseline-a')
    and (select count(*)=1 from taskspace_outline_sync.events where node_id='baseline-a')
    and (select source_oid='public.outline_nodes'::regclass::oid from taskspace_outline_sync.installation),
    '再適用の失敗で本文と記録を変えない');"
}
expect_rejected "
  alter table public.outline_nodes disable trigger taskspace_outline_capture;
  update public.outline_nodes set text='未記録の編集' where id='baseline-a';
" '本文と変更記録が一致しません'
expect_rejected "
  delete from taskspace_outline_sync.events where node_id='baseline-a';
" '本文と変更記録が一致しません'
expect_rejected "
  alter table public.outline_nodes rename to outline_nodes_previous;
  create table public.outline_nodes (like public.outline_nodes_previous including all);
  insert into public.outline_nodes select * from public.outline_nodes_previous;
" '記録の形式または本文の表が変わっています'
echo '確認: 未記録の編集・履歴の欠落・表の作り直しを正常扱いしない'
