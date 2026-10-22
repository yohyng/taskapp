begin;
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';

select outline_test.assert(
  (select revision = 1 and not deleted from public.taskspace_outline_heads() where node_id='baseline-a'),
  '本文と一緒に使う初期世代を読める');

select public.taskspace_outline_apply(
  '11111111-1111-4111-8111-111111111111',
  '[{"id":"baseline-a","kind":"put","expected_revision":1,"row":{"id":"baseline-a","text":"新しい端末の本文","updated_at":"2030-01-01T00:00:00Z"}}]'::jsonb
);
select outline_test.assert(
  (select text='新しい端末の本文' from public.outline_nodes where id='baseline-a')
  and (select revision=2 from public.taskspace_outline_heads() where node_id='baseline-a'),
  '読んだ世代が一致する保存だけを確定する');

select public.taskspace_outline_apply(
  '22222222-2222-4222-8222-222222222222',
  '[{"id":"baseline-a","kind":"put","expected_revision":1,"row":{"id":"baseline-a","text":"古い端末の本文"}}]'::jsonb
);
select outline_test.assert(
  (select text='新しい端末の本文' from public.outline_nodes where id='baseline-a')
  and (select count(*)=2 from taskspace_outline_sync.events where node_id='baseline-a'),
  '古い端末の保存は本文と履歴を増やさない');

select public.taskspace_outline_apply(
  '11111111-1111-4111-8111-111111111111',
  '[{"id":"baseline-a","kind":"put","expected_revision":1,"row":{"id":"baseline-a","text":"新しい端末の本文","updated_at":"2030-01-01T00:00:00Z"}}]'::jsonb
);
select outline_test.assert(
  (select count(*)=2 from taskspace_outline_sync.events where node_id='baseline-a'),
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
rollback;
