const OWNER_KEY = "taskspace-outline-owner-v1";

// localStorageの「所有者名」は同時に読めるため、排他の根拠にはならない。
// ブラウザーが原子的に渡すロックを使い、非対応・失敗時は書き始めない。
export function holdOutlineOwner(locks, start, unavailable) {
  const abort = new AbortController();
  let stopped = false;
  let release;
  if (!locks?.request) {
    unavailable();
    return () => {};
  }
  try {
    Promise.resolve(locks.request(OWNER_KEY, { mode: "exclusive", signal: abort.signal }, async () => {
      if (stopped) return;
      const done = new Promise((resolve) => { release = resolve; });
      const cleanup = start();
      await done;
      await cleanup?.();
    })).catch((error) => {
      if (!stopped && error?.name !== "AbortError") unavailable();
    });
  } catch { if (!stopped) unavailable(); }
  return () => {
    stopped = true;
    abort.abort();
    release?.();
  };
}

// 後始末は成功・失敗どちらの返事も待つ。rejectした処理を集合に残さない。
export function trackOutlineWork(work, promise) {
  work.add(promise);
  promise.then(() => work.delete(promise), () => work.delete(promise));
  return promise;
}
