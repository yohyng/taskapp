import { open, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { replaceFile } from './replace-file.mjs';

// メモリーへの取り込みやwrite完了だけでは保存確定を返さない。古いファイルを先に消さない。
export async function durableFile(file, contents, { openFile = open, replace = replaceFile } = {}) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await openFile(temporary, 'wx', 0o600);
    await handle.writeFile(contents);
    await handle.sync();
    await handle.close(); handle = undefined;
    await replace(temporary, file);
    // Windowsはディレクトリーfsyncを提供しない。電源断の保証とプロセス再起動の試験は分ける。
    if (process.platform !== 'win32') {
      const directory = await openFile(dirname(file), 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    }
  } finally {
    await handle?.close().catch(() => {});
    await unlink(temporary).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  }
}
