import { describe, expect, it, vi } from "vitest";
import { holdOutlineOwner, trackOutlineWork } from "./outline-owner.js";

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = () => new Promise((resolve) => queueMicrotask(resolve));

describe("アウトラインのタブ所有権", () => {
  it("ロックが無い環境では編集を始めない", () => {
    const start = vi.fn(), unavailable = vi.fn();
    const stop = holdOutlineOwner(undefined, start, unavailable);
    expect(start).not.toHaveBeenCalled();
    expect(unavailable).toHaveBeenCalledOnce();
    stop();
  });

  it("取得待ちを中止したタブは編集を始めない", async () => {
    let callback, signal;
    const start = vi.fn(), unavailable = vi.fn();
    const stop = holdOutlineOwner({ request: (key, options, run) => {
      expect(key).toBe("taskspace-outline-owner-v1");
      expect(options.mode).toBe("exclusive");
      signal = options.signal;
      callback = run;
      return new Promise(() => {});
    } }, start, unavailable);
    stop();
    expect(signal.aborted).toBe(true);
    await callback();
    expect(start).not.toHaveBeenCalled();
    expect(unavailable).not.toHaveBeenCalled();
  });

  it("編集を止めても保存の後始末が終わるまでロックを返さない", async () => {
    const finished = deferred();
    const cleanup = vi.fn(() => finished.promise);
    let run;
    const stop = holdOutlineOwner({ request: (key, options, callback) => {
      run = callback();
      return run;
    } }, () => cleanup, vi.fn());
    let released = false;
    run.then(() => { released = true; });
    stop();
    await tick();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(released).toBe(false);
    finished.resolve();
    await run;
    expect(released).toBe(true);
  });

  it("取得に失敗しても保護を外して編集しない", async () => {
    const start = vi.fn(), unavailable = vi.fn();
    holdOutlineOwner({ request: () => Promise.reject(new Error("取得失敗")) }, start, unavailable);
    await tick();
    expect(start).not.toHaveBeenCalled();
    expect(unavailable).toHaveBeenCalledOnce();
  });

  it("同期的な取得失敗も通知する", () => {
    const unavailable = vi.fn();
    holdOutlineOwner({ request: () => { throw new Error("取得失敗"); } }, vi.fn(), unavailable);
    expect(unavailable).toHaveBeenCalledOnce();
  });

  it("成功と失敗のどちらも待機中の処理から外す", async () => {
    const work = new Set(), first = deferred(), second = deferred();
    expect(trackOutlineWork(work, first.promise)).toBe(first.promise);
    trackOutlineWork(work, second.promise);
    expect(work.size).toBe(2);
    first.resolve();
    await tick();
    expect(work.size).toBe(1);
    second.reject(new Error("保存失敗"));
    await tick();
    expect(work.size).toBe(0);
  });
});
