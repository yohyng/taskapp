export async function pwaState(page, manifest) {
  return page.evaluate(({ ownerId, config }) => new Promise((resolve, reject) => {
    const request = indexedDB.open(`taskspace-lab-loro-owner:${ownerId}:${config.docId}`, 2);
    request.onupgradeneeded = () => request.transaction.abort();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction(['state', 'outbox'], 'readonly');
      const record = tx.objectStore('state').get('cutover'), pending = tx.objectStore('outbox').getAll();
      tx.oncomplete = () => { db.close(); resolve({ record: record.result ?? null,
        pending: pending.result.map((entry) => ({ id: entry.id, bytes: Array.from(entry.bytes) })) }); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), manifest);
}

export async function controlledPwa(page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
  });
}

export async function updatePwa(page) {
  return page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready, previous = navigator.serviceWorker.controller;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('Service Workerの配信更新を確認できません')), 35000);
      let worker;
      function finish(error, result) {
        clearTimeout(timer); registration.removeEventListener('updatefound', found);
        navigator.serviceWorker.removeEventListener('controllerchange', changed); worker?.removeEventListener('statechange', state);
        error ? reject(error) : resolve(result);
      }
      function state() { if (worker.state === 'redundant') finish(null, 'rejected'); }
      function found() { worker = registration.installing; if (worker) { worker.addEventListener('statechange', state); state(); } }
      function changed() { if (navigator.serviceWorker.controller !== previous) finish(null, 'activated'); }
      registration.addEventListener('updatefound', found); navigator.serviceWorker.addEventListener('controllerchange', changed);
      registration.update().catch((error) => finish(error));
    });
  });
}
