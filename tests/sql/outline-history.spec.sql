-- 変更は最後に取り消す。CI専用の使い捨てDBで実行する。
begin;
select outline_test.assert(
  (select row_data from outline_test.before_install) =
  (select to_jsonb(n) from public.outline_nodes n where id = 'baseline-a'),
  '初期控えを作っても元の行を変えない');
select outline_test.assert(
  (select count(*) = 1 from taskspace_outline_sync.events where kind = 'baseline'),
  '再適用しても初期控えを増やさない');
select outline_test.assert(
  (select row_data->'extra' = '{"画像の幅":640,"色":"青"}'::jsonb
   from taskspace_outline_sync.heads where node_id = 'baseline-a'),
  '既存の追加列も控えに含める');
\echo '確認: 初期控え・再適用・追加列'

insert into public.outline_nodes (id, text, extra) values ('new-a', '最初の本文', '{"タグ":["仕事"]}');
update public.outline_nodes set text = '書き換えた本文', updated_at = '2000-01-01' where id = 'new-a';
select outline_test.assert(
  (select revision = 2 and not deleted and row_data->>'text' = '書き換えた本文'
    from taskspace_outline_sync.heads where node_id = 'new-a'), '端末時刻とは別にサーバー世代を進める');
select outline_test.assert(
  (select before_row->>'text' = '最初の本文' and after_row->>'text' = '書き換えた本文'
    from taskspace_outline_sync.events where node_id = 'new-a' and revision = 2),
  '上書き前と上書き後の両方を残す');
update public.outline_nodes set text = text where id = 'new-a';
insert into public.outline_nodes select * from public.outline_nodes where id = 'new-a'
  on conflict (id) do update set text = excluded.text;
select outline_test.assert(
  (select count(*) = 2 from taskspace_outline_sync.events where node_id = 'new-a'),
  '同じ内容の更新・upsertでは履歴を増やさない');
\echo '確認: 追加・更新・古い端末時刻・同内容の再送'

delete from public.outline_nodes where id = 'new-a';
select outline_test.assert(
  (select deleted and revision = 3 and row_data is null from taskspace_outline_sync.heads where node_id = 'new-a'),
  '消した行の最新世代も残す');
select outline_test.assert(
  (select before_row->>'text' = '書き換えた本文' and after_row is null
    from taskspace_outline_sync.events where node_id = 'new-a' and revision = 3), '削除前の本文を残す');
insert into public.outline_nodes (id, text) values ('new-a', '同じidを復元');
select outline_test.assert(
  (select revision = 4 and not deleted from taskspace_outline_sync.heads where node_id = 'new-a'),
  '削除後に同じidが戻っても世代を巻き戻さない');
update public.outline_nodes set id = 'renamed' where id = 'new-a';
select outline_test.assert(
  (select deleted and revision = 5 from taskspace_outline_sync.heads where node_id = 'new-a')
  and (select not deleted and revision = 1 from taskspace_outline_sync.heads where node_id = 'renamed'),
  'idの変更も以前のidの削除と新しいidの追加として残す');
\echo '確認: 削除・同じidの復元・id変更'

savepoint before_cancel;
insert into public.outline_nodes (id, text) values ('cancelled', '取り消す本文');
rollback to savepoint before_cancel;
select outline_test.assert(
  not exists (select 1 from public.outline_nodes where id = 'cancelled')
  and not exists (select 1 from taskspace_outline_sync.heads where node_id = 'cancelled')
  and not exists (select 1 from taskspace_outline_sync.events where node_id = 'cancelled'),
  '取引の取り消しで本文・世代・履歴も全部取り消す');

alter table taskspace_outline_sync.events add constraint test_history_failure check (node_id <> 'blocked');
do $$
begin
  begin
    insert into public.outline_nodes (id, text) values ('blocked', '記録に失敗する本文');
    raise exception '履歴の失敗を検知できませんでした';
  exception when check_violation then null;
  end;
end;
$$;
select outline_test.assert(
  not exists (select 1 from public.outline_nodes where id = 'blocked')
  and not exists (select 1 from taskspace_outline_sync.heads where node_id = 'blocked'),
  '履歴に失敗したら本文と世代も確定しない');
alter table taskspace_outline_sync.events drop constraint test_history_failure;
do $$
begin
  begin
    truncate public.outline_nodes;
    raise exception 'TRUNCATEが通ってしまいました';
  exception when feature_not_supported then null;
  end;
end;
$$;
select outline_test.assert(exists (select 1 from public.outline_nodes where id = 'baseline-a'),
  '履歴を飛ばす全削除を止める');
\echo '確認: 取引の取り消し・記録失敗・TRUNCATEの保護'

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
set local search_path = pg_temp, public;
create temporary table heads (text text);
insert into public.outline_nodes (id, text) values ('authenticated-a', '認証済みの編集');
do $$
begin
  begin
    perform * from taskspace_outline_sync.events;
    raise exception '履歴を直接読めてしまいました';
  exception when insufficient_privilege then null;
  end;
  begin
    perform taskspace_outline_sync.record_change('delete', '{"id":"baseline-a"}', null);
    raise exception '内部の記録関数を直接呼べてしまいました';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
reset search_path;
select outline_test.assert(
  (select actor_id = '11111111-1111-4111-8111-111111111111'::uuid
    from taskspace_outline_sync.events where node_id = 'authenticated-a'),
  '権限を持つ利用者の通常の編集を記録する');
select outline_test.assert(
  not has_schema_privilege('anon', 'taskspace_outline_sync', 'USAGE')
  and not has_schema_privilege('authenticated', 'taskspace_outline_sync', 'USAGE')
  and not has_table_privilege('authenticated', 'taskspace_outline_sync.events', 'SELECT')
  and not has_table_privilege('anon', 'taskspace_outline_sync.events', 'SELECT')
  and not has_function_privilege('authenticated', 'taskspace_outline_sync.record_change(text,jsonb,jsonb)', 'EXECUTE')
  and not has_sequence_privilege('authenticated', pg_get_serial_sequence('taskspace_outline_sync.events','seq'), 'USAGE'),
  '削除前の文章と内部の記録操作を公開APIに開放しない');
\echo '確認: 通常の認証済み編集・内部関数の隔離・検索パスの保護'

set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
do $$
begin
  begin
    insert into public.outline_nodes (id, text) values ('forbidden', '権限の無い編集');
    raise exception '本文のRLSが無効になっています';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
select outline_test.assert(
  not exists (select 1 from taskspace_outline_sync.events where node_id = 'forbidden'),
  '元の本文のRLSを越える編集は記録も作らない');
\echo '確認: 本文のRLSを維持'

insert into public.outline_nodes (id, text)
  select 'bulk-' || i, '一括の行' || i from generate_series(1, 10000) i;
select outline_test.assert(
  (select count(*) = 10000 from taskspace_outline_sync.heads where node_id like 'bulk-%')
  and (select count(*) = 10000 from taskspace_outline_sync.events where node_id like 'bulk-%'),
  '1万行の一括追加を落とさない');
update public.outline_nodes set text = '1行だけ変える' where id = 'bulk-5000';
select outline_test.assert(
  (select count(*) = 10001 from taskspace_outline_sync.events where node_id like 'bulk-%'),
  '文字編集では対象の1行分だけ履歴を足す');
delete from public.outline_nodes where id like 'bulk-%';
select outline_test.assert(
  (select count(*) = 10000 from taskspace_outline_sync.heads where node_id like 'bulk-%' and deleted)
  and (select count(*) = 10000 from taskspace_outline_sync.events where node_id like 'bulk-%' and kind = 'delete'),
  '一括削除も削除前の本文を行ごとに残す');
\echo '確認: 1万行の追加・1行編集・一括削除'
rollback;
\echo '変更履歴のSQL検証が完了'
