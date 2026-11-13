// 画面が止まった瞬間を、犯人の名前つきで捕まえる。
// Chrome の Long Animation Frame は「長かったフレーム」を、その中で動いた
// スクリプト・関数・かかった時間まで教えてくれる。手書きの処理には触らない。

import { ring, summarize, overCount, deviceSummary } from "./ink-metrics";

const SHORT = (url) => String(url || "").replace(/^https?:\/\/[^/]+/, "").slice(-60);

export function createStallProbe() {
  const frames = ring(2000), gaps = ring(4000), tasks = ring(500);
  // 犯人ごとの集計。名前で束ねないと、同じ関数が何度も並ぶだけで読めない。
  const blame = new Map();
  let observers = [], raf = null, last = 0, on = false, startedAt = 0;

  function note(name, ms) {
    const found = blame.get(name) || { name, count: 0, total: 0, max: 0 };
    found.count += 1; found.total += ms; found.max = Math.max(found.max, ms);
    blame.set(name, found);
  }

  function watch(type, handle, options = {}) {
    if (typeof PerformanceObserver === "undefined") return;
    try {
      const observer = new PerformanceObserver((list) => { if (on) for (const entry of list.getEntries()) handle(entry); });
      observer.observe({ type, buffered: false, ...options });
      observers.push(observer);
    } catch { /* 対応していない端末では、残りの数で見る */ }
  }

  return {
    get running() { return on; },
    start() {
      frames.clear(); gaps.clear(); tasks.clear(); blame.clear();
      last = 0; startedAt = Date.now(); on = true;
      // 長かったフレーム（既定は50ms以上）。中で動いた関数まで分かる。
      watch("long-animation-frame", (entry) => {
        frames.push({ duration: entry.duration, blocking: entry.blockingDuration, render: entry.renderStart ? entry.styleAndLayoutStart - entry.renderStart : 0 });
        for (const script of entry.scripts || []) {
          const name = [script.invokerType, script.invoker, script.sourceFunctionName && `${script.sourceFunctionName}()`, SHORT(script.sourceURL)]
            .filter(Boolean).join(" ");
          note(name || "（名前なし）", script.duration);
        }
      }, { durationThreshold: 50 });
      watch("longtask", (entry) => tasks.push(entry.duration));
      const tick = () => {
        const now = performance.now();
        if (last) gaps.push(now - last);
        last = now;
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    },
    stop() {
      on = false;
      if (raf !== null) cancelAnimationFrame(raf);
      raf = null;
      for (const observer of observers) { try { observer.disconnect(); } catch { /* もう閉じている */ } }
      observers = [];
    },
    report() {
      const gapList = gaps.list, frameList = frames.list;
      return {
        at: new Date().toISOString(),
        seconds: Math.round((Date.now() - startedAt) / 100) / 10,
        device: deviceSummary(),
        frameGap: { ...summarize(gapList), over50: overCount(gapList, 50), over100: overCount(gapList, 100), over200: overCount(gapList, 200) },
        longFrames: {
          count: frameList.length,
          duration: summarize(frameList.map((f) => f.duration)),
          blocking: summarize(frameList.map((f) => f.blocking)),
        },
        longtask: { count: tasks.length, ...summarize(tasks.list) },
        // 止めた時間が長い順。ここの上から順に直せばよい。
        blame: [...blame.values()]
          .map((item) => ({ ...item, total: Math.round(item.total), max: Math.round(item.max) }))
          .sort((a, b) => b.total - a.total).slice(0, 15),
      };
    },
  };
}
