import { rename } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';

// Windowsで読込やスキャンが一時的にファイルを掴む場合だけ待つ。古い保存を先に消さない。
export async function replaceFile(source, target, { replace = rename, wait = setTimeout } = {}) {
  for (let attempt = 0; ; attempt++) {
    try { await replace(source, target); return; }
    catch (error) {
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt === 5) throw error;
      await wait(20 * 2 ** attempt);
    }
  }
}
