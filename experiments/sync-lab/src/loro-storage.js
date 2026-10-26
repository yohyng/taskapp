// snapshot・未適用の受信・未確認の送信を同じ取引で保存する。読み取り失敗で空へ初期化しない。
export async function openLoroStorage(docId) {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(`taskspace-lab-loro-${docId}`, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('state');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('検証用の保存領域が開けません'));
  });
  function transaction(mode, value) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('state', mode), store = tx.objectStore('state');
      const request = mode === 'readonly' ? store.get('document') : store.put(value, 'document');
      tx.oncomplete = () => resolve(mode === 'readonly' ? request.result : undefined);
      tx.onabort = () => reject(tx.error || new Error('端末保存を確定できません'));
      tx.onerror = () => {};
    });
  }
  return { read: () => transaction('readonly'), write: (value) => transaction('readwrite', value), close: () => db.close() };
}
