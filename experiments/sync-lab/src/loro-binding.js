// 固定した公式接続0.3.3へ、対象行の文字イベントだけを渡す。文字の差分や選択の変換は既存部品に任せる。
export function scopedLoroSource(doc, text, origin, beforeCommit = () => {}) {
  let receiving = false;
  return {
    subscribe(listener) { return doc.subscribe((event) => {
      if (event.by === 'local' && event.origin === origin) return;
      const events = event.events.filter((item) => item.target === text.id && item.diff.type === 'text');
      if (!events.length) return;
      receiving = true;
      try { listener({ ...event, by: 'import', events }); } finally { receiving = false; }
    }); },
    commit() { beforeCommit(); doc.commit({ origin }); },
    receiving: () => receiving,
  };
}

// 初期値が同じ場合の初期化フラグも空の更新で完了し、最初の直接更新を読み飛ばさない。
export function finishLoroInitialization(view) { queueMicrotask(() => view.dispatch({})); }
