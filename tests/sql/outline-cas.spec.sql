begin;
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';

select outline_test.assert(
  (select revision = 1 and not deleted from public.taskspace_outline_heads() where node_id='baseline-a'),
  '本文と一緒に使う初期世代を読める');

do $$
begin
  begin
    update public.outline_nodes set text='古いPWAの直接保存' where id='baseline-a';
    raise exception 'CASを通らない保存が通りました';
  exception when serialization_failure then null;
  end;
end;
$$;
select outline_test.assert(
  (select text='移行前の本文' from public.outline_nodes where id='baseline-a')
  and (select revision=1 from public.taskspace_outline_heads() where node_id='baseline-a'),
  '古いPWAの直接保存は本文も世代も変えない');

select public.taskspace_outline_apply(
  '11111111-1111-4111-8111-111111111111',
  '[{"id":"baseline-a","kind":"put","expected_revision":1,"row":{"id":"baseline-a","text":"新しい端末の本文","updated_at":"2030-01-01T00:00:00Z"}}]'::jsonb
);
select outline_test.assert(
  (select text='新しい端末の本文' from public.outline_nodes where id='baseline-a')
  and (select revision=2 from public.taskspace_outline_heads() where node_id='baseline-a'),
  '読んだ世代が一致する保存だけを確定する');

do $$
begin
  begin
    update public.outline_nodes set text='RPC後の直接保存' where id='baseline-a';
    raise exception 'RPCの許可が取引内へ残っています';
  exception when serialization_failure then null;
  end;
end;
$$;
select outline_test.assert(
  (select text='新しい端末の本文' from public.outline_nodes where id='baseline-a'),
  'RPCが終わると直接保存を再び拒否する');

select public.taskspace_outline_apply(
  '22222222-2222-4222-8222-222222222222',
  '[{"id":"baseline-a","kind":"put","expected_revision":1,"row":{"id":"baseline-a","text":"古い端末の本文"}}]'::jsonb
);
select outline_test.assert(
  (select text='新しい端末の本文' from public.outline_nodes where id='baseline-a')
  and (select revision=2 from public.taskspace_outline_heads() where node_id='baseline-a'),
  '古い端末の保存は本文と履歴を増やさない');

select public.taskspace_outline_apply(
  '11111111-1111-4111-8111-111111111111',
  '[{"id":"baseline-a","kind":"put","expected_revision":1,"row":{"id":"baseline-a","text":"新しい端末の本文","updated_at":"2030-01-01T00:00:00Z"}}]'::jsonb
);
select outline_test.assert(
  (select revision=2 from public.taskspace_outline_heads() where node_id='baseline-a'),
  '同じ操作の再送は二重に適用しない');

select public.taskspace_outline_apply(
  '33333333-3333-4333-8333-333333333333',
  '[{"id":"new-cas","kind":"put","expected_revision":0,"row":{"id":"new-cas","text":"追加"}}]'::jsonb
);
select public.taskspace_outline_apply(
  '44444444-4444-4444-8444-444444444444',
  '[{"id":"new-cas","kind":"delete","expected_revision":1}]'::jsonb
);
select outline_test.assert(
  (select revision=2 and deleted from public.taskspace_outline_heads() where node_id='new-cas')
  and not exists (select 1 from public.outline_nodes where id='new-cas'),
  '追加と削除にも同じ世代確認を使う');

reset role;

insert into public.outline_nodes (id, text) values ('admin-maintenance', '管理者の保守');
select outline_test.assert(
  (select revision=1 from taskspace_outline_sync.heads where node_id='admin-maintenance'),
  'DB管理者の保守は履歴を残して通す');
rollback;
