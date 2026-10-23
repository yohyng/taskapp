-- CIの使い捨てDBだけで実行する。
begin;
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';

select outline_test.assert(
  (select result = '{"ok":false,"retired":true}'::jsonb from public.taskspace_outline_recover_operations(
    array['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid])),
  '未着の要求は本文を触らず失効する');
select outline_test.assert(
  (select revision=1 from public.taskspace_outline_heads() where node_id='baseline-a')
  and (select text='移行前の本文' from public.outline_nodes where id='baseline-a'),
  '引き継ぎで本文と世代を変えない');

do $$ begin
  begin
    perform public.taskspace_outline_apply('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '[{"id":"baseline-a","kind":"put","expected_revision":1,"row":{"id":"baseline-a","text":"後から届いた古い本文"}}]'::jsonb);
    raise exception '失効した古い要求が通りました';
  exception when invalid_parameter_value then null;
  end;
end; $$;

select public.taskspace_outline_apply('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '[{"id":"baseline-a","kind":"put","expected_revision":1,"row":{"id":"baseline-a","text":"新しいIDで続けた本文"}}]'::jsonb);
select outline_test.assert(
  (select result->>'ok' = 'true' and result->'revisions'->>'baseline-a' = '2'
    from public.taskspace_outline_recover_operations(array['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid])),
  '成功済みの結果を変更せず読み出す');

select public.taskspace_outline_apply('cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  '[{"id":"baseline-a","kind":"put","expected_revision":0,"row":{"id":"baseline-a","text":"拒否される本文"}}]'::jsonb);
select outline_test.assert(
  (select result->>'ok' = 'false' and result->'conflicts'->0->>'actual_revision' = '2'
    from public.taskspace_outline_recover_operations(array['cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid])),
  '拒否済みの結果も変更せず読み出す');
select outline_test.assert(
  (select text='新しいIDで続けた本文' from public.outline_nodes where id='baseline-a')
  and (select revision=2 from public.taskspace_outline_heads() where node_id='baseline-a'),
  '成功・拒否の読み直しで再適用しない');

do $$ declare ids uuid[]; begin
  for ids in select value from (values (array[]::uuid[]), (array[null]::uuid[])) v(value) loop
    begin
      perform public.taskspace_outline_recover_operations(ids);
      raise exception '不正な引数が通りました';
    exception when invalid_parameter_value then null;
    end;
  end loop;
end; $$;
do $$ begin
  begin
    perform public.taskspace_outline_recover_operations(null);
    raise exception 'nullが通りました';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.taskspace_outline_recover_operations(array_fill('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, array[501]));
    raise exception '上限を超えました';
  exception when invalid_parameter_value then null;
  end;
end; $$;

set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
do $$ begin
  begin
    perform public.taskspace_outline_recover_operations(array[
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid]);
    raise exception '別ユーザーの結果が読めました';
  exception when insufficient_privilege then null;
  end;
end; $$;
reset role;
select outline_test.assert(not exists (
  select 1 from taskspace_outline_sync.operations where operation_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
  '他ユーザーを含む要求は一部だけ失効させない');
set local role anon;
do $$ begin
  begin
    perform public.taskspace_outline_recover_operations(array['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid]);
    raise exception '未ログインで実行できました';
  exception when insufficient_privilege then null;
  end;
end; $$;
reset role;
rollback;
