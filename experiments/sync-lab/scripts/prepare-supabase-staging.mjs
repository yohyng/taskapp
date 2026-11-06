import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { seedOutlineDocument } from '../src/outline-model.js';
import { stagingProject, documentId } from '../src/staging-config.js';

// 合成文書しか作らない。ブラウザーへ管理鍵を渡さず、SQL Editorで一度だけ初期投入する。
export async function prepareStaging(directory, reference, owner, otherOwner) {
  stagingProject(reference); owner = documentId(owner); otherOwner = documentId(otherOwner);
  if (owner === otherOwner) throw new Error('権限検証には別々の二ユーザーが必要です');
  const documents = [owner, otherOwner].map((ownerId) => {
    const doc = seedOutlineDocument([{ id: 'probe', text: '検証用メモ', children: [] }, { id: 'other', text: '別行の検証用メモ', children: [] }]);
    try {
      const bytes = doc.export({ mode: 'snapshot' });
      return { documentId: randomUUID(), ownerId, bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
    } finally { doc.free(); }
  });
  const schema = await readFile(new URL('../infra/loro-log.sql', import.meta.url), 'utf8');
  const sql = `-- 検証専用：${reference}。本番プロジェクトのSQL Editorでは実行しない。\nbegin;\nselect pg_advisory_xact_lock(731003);\n${schema}\n` + documents.map((entry) => `
do $$ begin
  if not exists (select 1 from auth.users where id = '${entry.ownerId}'::uuid) then
    raise exception '検証ユーザーが見つかりません。プロジェクトとユーザーIDを確認してください';
  end if;
end $$;
insert into public.taskspace_loro_documents(id, owner_id) values ('${entry.documentId}', '${entry.ownerId}');
insert into taskspace_loro.snapshots(doc_id, bytes) values ('${entry.documentId}', decode('${Buffer.from(entry.bytes).toString('hex')}', 'hex'));
`).join('\n') + "\nnotify pgrst, 'reload schema';\ncommit;\n";
  // 再実行による原本差し替えを避ける。既存フォルダー・既存文書の再利用を許可しない。
  await mkdir(directory);
  const manifest = { format: 1, projectRef: reference, synthetic: true, documents: documents.map(({ bytes: _bytes, ...entry }) => entry) };
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' });
  await writeFile(join(directory, 'setup.sql'), sql, { flag: 'wx' });
  const settings = `LAB_SUPABASE_PROJECT_REF=${reference}\nLAB_SUPABASE_PUBLISHABLE_KEY=sb_publishable_ここに公開鍵\nLAB_SUPABASE_DOCUMENT_ID=${documents[0].documentId}\n`;
  await writeFile(join(directory, 'browser.env.example'), settings, { flag: 'wx' });
  await writeFile(join(directory, 'verify.env.example'), settings + `LAB_SUPABASE_OTHER_DOCUMENT_ID=${documents[1].documentId}\nLAB_STAGING_MANIFEST=生成したmanifest.jsonの絶対パス\nLAB_OWNER_EMAIL=\nLAB_OWNER_PASSWORD=\nLAB_OTHER_EMAIL=\nLAB_OTHER_PASSWORD=\n`, { flag: 'wx' });
  return manifest;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , directory, reference, owner, otherOwner] = process.argv;
  if (!directory) throw new Error('新規出力フォルダー・検証プロジェクト参照ID・二人のユーザーUUIDを指定してください');
  console.log(JSON.stringify(await prepareStaging(directory, reference, owner, otherOwner)));
}
