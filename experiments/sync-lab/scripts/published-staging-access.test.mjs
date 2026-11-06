import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publishedAccessUrl, openPublishedStaging } from './published-staging-access.mjs';
import { stagingOrigin } from './published-staging-assets.mjs';

const url = stagingOrigin + '/?_vercel_share=' + 'a'.repeat(32);
test('共有検証：既知の検証版と一つの共有値だけを受け、例外へ値を含めない', () => {
  assert.equal(publishedAccessUrl(url), url);
  for (const wrong of [url.replace('taskapp-git', 'other-git'), url + '&other=1', url + '&_vercel_share=x', url + '#x',
    url.replace('/?', '/other?'), url.replace('https://', 'https://user:password@'), url.replace('a'.repeat(32), 'sb_secret_wrong')]) {
    assert.throws(() => publishedAccessUrl(wrong), (error) => !error.message.includes(wrong) && !error.message.includes('password'));
  }
});
test('共有検証：コミット不正では接続せず、外部転送と失敗時にCookie用contextを閉じる', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'taskspace-share-')), path = join(directory, 'access.private.json');
  await writeFile(path, JSON.stringify({ url })); let calls = 0, disposed = 0;
  const newContext = async (options) => {
    assert.equal(options.extraHTTPHeaders['x-vercel-skip-toolbar'], '1');
    return { get: async (target, requestOptions) => { calls++; assert.equal(target, url); assert.equal(requestOptions.maxRedirects, 0);
      return { status: () => 302, headers: () => ({ location: 'https://example.test' }) }; }, dispose: async () => disposed++ };
  };
  await assert.rejects(openPublishedStaging(path, 'bad', { newContext })); assert.equal(calls, 0);
  await assert.rejects(openPublishedStaging(path, 'b'.repeat(40), { newContext }), /外部転送/);
  assert.equal(calls, 1); assert.equal(disposed, 1);
});
