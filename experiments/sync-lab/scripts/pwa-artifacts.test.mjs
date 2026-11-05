import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { artifactHashes, loadPwaArtifacts, compatibleLocks } from './pwa-artifacts.mjs';

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'taskspace-pwa-artifacts-'));
  const manifest = { format: 1, synthetic: true, config: { mode: 'production', url: 'http://127.0.0.1:4183', cutover: true }, versions: {} };
  for (const name of ['compatible', 'latest']) {
    const at = join(directory, name); await mkdir(at);
    for (const [file, bytes] of [['index.html', '<!doctype html>'], ['sw.js', name], ['manifest.webmanifest', '{}'], ['engine.wasm', '合成のバイト列']]) await writeFile(join(at, file), bytes);
    manifest.versions[name] = { directory: at, ref: 'a'.repeat(40), files: await artifactHashes(at) };
  }
  return { directory, manifest };
}

test('PWA配信物：固定されたハッシュのバイト列だけを使い、後からファイルが変わっても混ぜない', async () => {
  const { directory, manifest } = await fixture(), loaded = await loadPwaArtifacts(manifest, directory);
  assert.equal(loaded.compatible.get('/sw.js').toString(), 'compatible');
  await writeFile(join(manifest.versions.latest.directory, 'sw.js'), '差し替わった版');
  assert.equal(loaded.latest.get('/sw.js').toString(), 'latest');
  await assert.rejects(loadPwaArtifacts(manifest, directory), /ハッシュが一致/);
});

test('PWA配信物：外のフォルダー・不正パス・WASM欠損・同一Worker・実接続のmanifestを拒む', async () => {
  for (const kind of ['outside', 'path', 'wasm', 'worker', 'real']) {
    const { directory, manifest } = await fixture();
    if (kind === 'outside') manifest.versions.latest.directory = directory;
    if (kind === 'path') manifest.versions.latest.files['../source.txt'] = 'a'.repeat(64);
    if (kind === 'wasm') delete manifest.versions.latest.files['engine.wasm'];
    if (kind === 'worker') { await writeFile(join(manifest.versions.latest.directory, 'sw.js'), 'compatible'); manifest.versions.latest.files = await artifactHashes(manifest.versions.latest.directory); }
    if (kind === 'real') manifest.config.url = 'https://example.supabase.co';
    await assert.rejects(loadPwaArtifacts(manifest, directory));
  }
});

test('PWAの固定依存：WindowsとGit展開の改行と本体版番号だけの差は認め、依存変更は拒む', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'taskspace-pwa-locks-'));
  for (const [name, newline, version] of [['current', '\r\n', '2'], ['fixed', '\n', '1']]) {
    const root = join(directory, name); await mkdir(join(root, 'experiments/sync-lab'), { recursive: true });
    await writeFile(join(root, 'package-lock.json'), JSON.stringify({ packages: { '': { version }, 'node_modules/example': { version: '1' } } }));
    await writeFile(join(root, 'experiments/sync-lab/pnpm-lock.yaml'), ['lockfileVersion: 9', 'dependencies:', '  example: 1', ''].join(newline));
  }
  assert.equal(await compatibleLocks(join(directory, 'current'), join(directory, 'fixed')), true);
  await writeFile(join(directory, 'current/experiments/sync-lab/pnpm-lock.yaml'), '別の依存');
  assert.equal(await compatibleLocks(join(directory, 'current'), join(directory, 'fixed')), false);
});
