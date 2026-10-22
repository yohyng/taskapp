import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, ChevronDown, MoreHorizontal, Star, Check, Trash2, Search, X, Download, Upload, Undo2, Redo2, Settings2 } from "lucide-react";
import {
  makeNode, ensureNode, pathTo, visibleRows, filterByQuery, splitByQuery,
  importOutline, mergeByText, buildExport, moveSubtreeTo,
  insertAfter, insertChild, indent, outdent, toggleCollapse, mergeIntoPrevious, mergeNext,
  moveSibling, deleteNodeSafe, deleteNodeKeepChildren, updateNode,
  countChars, hasStoredBody, truncateTitle,
  flattenTree, buildTree, mergeOutline, prepareOutlineChange, outlineRowSignature,
  indentMany, outdentMany, removeMany, patchMany, textOf, rangeBetween, collectFavorites,
  collectAllTags, hashtagAtCursor, tagSuggestions, applyTag, splitTags, addMemoUnderDate,
  groupByDate, fillDates, imageUrlOf, applyRemoteRows,
} from "./lib/outline";
import { loadOutlineRows, loadOutlineRevisions, saveOutlineRows, saveOutlineRowsCas, clearOutlineRows, isOutlineTableMissing, outlineTableSql, absentOutlineColumns, outlineColumnsSql, subscribeOutline, supabaseReady } from "./lib/db";
import { parseByFormat, parseZip } from "./lib/import-formats";
import { bigGet, bigPut } from "./lib/localstore";
import { holdOutlineOwner, trackOutlineWork } from "./lib/outline-owner";
import {
  outlineCheckpoint, readOutlineSnapshot, chooseOutlineSnapshot, changedOutlineRows,
  queueOutlineRows, resolveOutlineRevisions, prepareOutlineOperation, acknowledgeOutlineRows, pendingOutlineIds, replayOutlineRows,
} from "./lib/outline-checkpoint";
import { readDriveSetting, writeDriveSetting, hasDrive, uploadToDrive, pingDrive, backupToDrive, hoursSinceBackup, lastBackupAt } from "./lib/drive";

const OUTLINE_KEY = "taskspace-outline-v1";

// 木はひとつ。枠（ペイン）をいくつ開いても、同じものを見ている。
// 枠ごとに違うのは「どこにズームしているか」だけ。
const OutlineContext = React.createContext(null);
// 木そのものを要らない側（App のメモ追加など）のための口。
// ここは中身が変わらないので、木を書き換えても描き直しを誘わない。
const OutlineApiContext = React.createContext(null);

const OUTLINE_VIEW_KEY = "taskspace-outline-view";
const DEFAULT_VIEW = { fontSize: 14, align: "left", typewriter: false, anchor: 0.6, immersive: false };
const readView = () => {
  try { return { ...DEFAULT_VIEW, ...JSON.parse(localStorage.getItem(OUTLINE_VIEW_KEY) || "{}") }; }
  catch { return { ...DEFAULT_VIEW }; }
};

// 前に「向こうにもある」と確かめた行の id。
// これがあると、ほかの端末で消された行を、手元から送り返さずに済む。
const OUTLINE_KNOWN_KEY = "taskspace-outline-known";

// 旧形式にも残す保存時刻。新形式の控えの前後は保存世代で比べる。
const OUTLINE_SAVED_KEY = "taskspace-outline-saved-at";

const OUTLINE_TOMB_KEY = "taskspace-outline-deleted";

// id の束（消した印・向こうで確かめた覚え）。
// まとめて消したり取り込んだりすると万単位になり、localStorage には
// 入らないことがある。入らなければ IndexedDB に置く。
// どちらも読めるようにしておき、多いほうを採る。
async function readIds(key) {
  let here;
  try { here = JSON.parse(localStorage.getItem(key) || "[]"); } catch { here = []; }
  if (!Array.isArray(here)) here = [];
  const there = await bigGet(key);
  const big = Array.isArray(there) ? there : [];
  return new Set(big.length > here.length ? big : here);
}


export function OutlineProvider({ children }) {
  const [initial] = useState(readLocalOutline);
  const [owner, setOwner] = useState("waiting");
  const ownerRef = useRef(false);
  const workRef = useRef(new Set());
  const [nodes, setNodes] = useState(() => load(initial));
  // いまの木を、更新の外からも読めるようにしておく（履歴を積むため）
  const nodesRef = useRef(nodes);
  // 履歴そのものは ref に持ち、画面には「戻せるか」だけを伝える。
  // 更新関数の中で木を動かすと、二度呼ばれたときにずれるため。
  const histRef = useRef({ past: [], future: [] });
  const [histCount, setHistCount] = useState({ past: 0, future: 0 });
  const syncHist = (next) => {
    histRef.current = next;
    setHistCount({ past: next.past.length, future: next.future.length });
  };
  const coalesceRef = useRef({ key: null, at: 0 });
  const [syncNote, setSyncNote] = useState("");  // 置き場が無いときの知らせ
  const [view, setViewState] = useState(readView);
  const setView = useCallback((patch) => {
    setViewState((prev) => {
      const next = { ...prev, ...patch };
      try { localStorage.setItem(OUTLINE_VIEW_KEY, JSON.stringify(next)); } catch { /* noop */ }
      return next;
    });
  }, []);
  const readyRef = useRef(false);                 // 読み込み前は送らない
  const syncedRef = useRef(new Map());            // 向こうと同じだと分かっている行
  const serverRevisionsRef = useRef(new Map());   // 端末時刻ではなく、保存条件にする向こうの世代
  const casRef = useRef("unknown");               // unknown / available / legacy
  const tombRef = useRef(new Set());
  const knownRef = useRef(new Set());   // 向こうにもあると確かめた id
  const queueRef = useRef({ sequence: 0, pending: new Map() });
  const revisionRef = useRef(0);
  const rowSaveRef = useRef(false);
  const nodeCountRef = useRef(0);
  const timerRef = useRef(null);
  // 入力のたびに待ち直しても、最初の変更からの期限は延ばさない。
  const sendWaitRef = useRef(null);
  const [syncStatus, setSyncStatus] = useState("checking");
  const retryRef = useRef(null);
  const sendingRef = useRef(false);
  const stoppedRef = useRef(false);
  const [retry, setRetry] = useState(0);        // 送信後・失敗後に差分を確かめ直す
  useEffect(() => {
    stoppedRef.current = false;
    return () => {
      stoppedRef.current = true;
      clearTimeout(retryRef.current);
    };
  }, []);
  // いまどうつながっているか。画面の隅に小さく出して、切れていたら分かるようにする。
  //   off … 置き場が無い（この端末だけ）／ live … 受け取れている
  //   closed・error … 切れた（しまっている間など。戻れば繋ぎ直す）
  const [link, setLink] = useState(() => (supabaseReady() ? "waking" : "off"));
  const [syncedAt, setSyncedAt] = useState("");

  // 手元の保存結果は、Supabaseの知らせとは分ける。片方の成功で失敗を隠さないため。
  const [localSave, setLocalSave] = useState({ status: "loading", large: false, busy: false, hidden: false });
  const [localRetry, setLocalRetry] = useState(0);
  const markLocal = useCallback((status, large, busy) => {
    setLocalSave((prev) => {
      const next = status === "saving" && prev.status === "error" ? "error" : status;
      if (prev.status === next && prev.large === large && prev.busy === busy) return prev;
      return { status: next, large, busy, hidden: large ? prev.hidden : false };
    });
  }, []);
  const bigReadRef = useRef(false);   // IndexedDB を読み終えたか
  const localWriteRef = useRef({ pending: null, running: false, version: 0 });
  const localRetryRef = useRef(null);
  const saveLocal = useCallback(() => {
    // 読む前に書くと、起き抜けの空の木が本物を押しのけてしまう。
    if (!ownerRef.current || !bigReadRef.current || stoppedRef.current) return Promise.resolve(false);
    clearTimeout(localRetryRef.current);
    const snapshot = nodesRef.current;
    const at = new Date().toISOString();
    const record = outlineCheckpoint(snapshot, queueRef.current, tombRef.current, knownRef.current, ++revisionRef.current, at);
    if (rowSaveRef.current) record.large = true;
    let localOk = false;
    if (!rowSaveRef.current) {
      try {
        localStorage.setItem(OUTLINE_KEY, JSON.stringify(record));
        localStorage.setItem(OUTLINE_SAVED_KEY, at);
        localOk = true;
      } catch {
        // 大きい置き場への確定前には、前の保存済みの写しも消さない。
      }
    }
    const state = localWriteRef.current;
    const version = ++state.version;
    // 待っている木は最新の1つだけ。入力のたびに大きい木を溜め込まない。
    let finish;
    const finished = new Promise((resolve) => { finish = resolve; });
    // まとめた保存を待つ送信も、最新の未送信記録が確定するまで待つ。
    state.pending?.finish(finished);
    state.pending = { nodes: snapshot, record, localOk, version, finish };
    if (localOk) finish(true);
    markLocal(localOk ? "saved" : "saving", !localOk && !rowSaveRef.current, !localOk);
    if (state.running) return finished;
    state.running = true;
    const drain = async () => {
      try {
        while (state.pending && !stoppedRef.current) {
          const attempt = state.pending;
          state.pending = null;
          let bigOk = false;
          try { bigOk = await bigPut(OUTLINE_KEY, attempt.record); }
          catch { /* 例外でも、書きかけを残して再試行する */ }
          if (bigOk && !attempt.localOk) {
            try {
              const here = readOutlineSnapshot(readLocalOutline());
              // 待っている間に小さい置き場へ残せた新しい控えは消さない。
              if (here && (here.legacy || here.revision <= attempt.record.revision)) localStorage.removeItem(OUTLINE_KEY);
            } catch { /* 読めない別の控えは触らない */ }
          }
          // 差分保存が使えない場合だけ、本文と未送信記録を小さい置き場へ退避する。
          if (!bigOk && rowSaveRef.current && !attempt.localOk) {
            try {
              // 新しい入力を、古い保存失敗の返事で上書きしない。
              if (attempt.version === state.version) {
                localStorage.setItem(OUTLINE_KEY, JSON.stringify(attempt.record));
                attempt.localOk = true;
              }
            } catch { /* 最新の木は画面に残し、再試行と書き出しへつなげる */ }
          }
          attempt.finish(!stoppedRef.current && (attempt.localOk || bigOk));
          if (stoppedRef.current) return;
          // 古い保存の返事で、あとから打った内容まで保存済みにしない。
          if (attempt.version !== state.version || attempt.nodes !== nodesRef.current) continue;
          const ok = attempt.localOk || bigOk;
          markLocal(ok ? "saved" : "error", !attempt.localOk && !rowSaveRef.current, false);
          if (!ok) localRetryRef.current = setTimeout(() => setLocalRetry((n) => n + 1), 15000);
        }
      } finally {
        state.running = false;
      }
    };
    trackOutlineWork(workRef.current, drain());
    return finished;
  }, [markLocal]);
  useEffect(() => { saveLocal(); }, [nodes, localRetry, saveLocal]);
  useEffect(() => () => {
    clearTimeout(localRetryRef.current);
    localWriteRef.current.pending?.finish(false);
    localWriteRef.current.pending = null;
  }, []);

  // 削除の意図は送信待ちの間も有効。戻した行の印は、その場で外す。
  const prepareLocal = useCallback((before, after) => {
    const change = prepareOutlineChange(before, after);
    nodeCountRef.current += change.added.length - change.removed.length;
    if (nodeCountRef.current >= 1000) rowSaveRef.current = true;
    const beforeSignatures = new Map(flattenTree(before).map((row) => [row.id, outlineRowSignature(row)]));
    const changes = changedOutlineRows(before, change.nodes).map((item) => ({
      // startのような空表示用の行が同期済み一覧から漏れても、編集直前の姿を比較基準にする。
      ...item, baseSignature: syncedRef.current.get(item.id) ?? beforeSignatures.get(item.id),
    }));
    queueRef.current = queueOutlineRows(queueRef.current, changes, serverRevisionsRef.current);
    setSyncStatus(sendingRef.current ? "sending" : "waiting");
    for (const id of change.removed) tombRef.current.add(id);
    for (const id of change.added) tombRef.current.delete(id);
    return change.nodes;
  }, []);

  // 書き換えはここを通す。前の姿を履歴に積む。
  // 字を打っているあいだは1手にまとめる（1文字ずつ戻るのは使いにくい）。
  const apply = useCallback((updater, opts = {}) => {
    if (!ownerRef.current || stoppedRef.current) return;
    const prev = nodesRef.current;
    const proposed = typeof updater === "function" ? updater(prev) : updater;
    if (proposed === prev) return;
    const next = prepareLocal(prev, proposed);
    nodesRef.current = next;
    setNodes(next);
    const now = Date.now();
    const c = coalesceRef.current;
    const same = opts.coalesce && c.key === opts.coalesce && now - c.at < 900;
    coalesceRef.current = { key: opts.coalesce || null, at: now };
    if (same) return;
    const h = histRef.current;
    syncHist({ past: [...h.past, prev].slice(-100), future: [] });
  }, [prepareLocal]);

  // 同期で入ってきたぶんは、履歴に積まない（自分の操作ではないので）
  const applyRaw = useCallback((updater) => {
    if (!ownerRef.current || stoppedRef.current) return;
    const prev = nodesRef.current;
    const next = typeof updater === "function" ? updater(prev) : updater;
    nodeCountRef.current = flattenTree(next).length;
    if (nodeCountRef.current >= 1000) rowSaveRef.current = true;
    nodesRef.current = next;
    setNodes(next);
  }, []);

  // 読み込み：向こうと突き合わせる。消した印のものは戻さない。
  // 手元を読み終えてから、一度だけ呼ぶ。
  const pullOnce = useCallback(() => {
    if (!ownerRef.current || stoppedRef.current) return;
    trackOutlineWork(workRef.current, Promise.all([loadOutlineRows(), loadOutlineRevisions()]).then(([rows, revisions]) => {
      if (!ownerRef.current || stoppedRef.current) return;
      if (!rows) {
        // 読めていないのに送り始めると、向こうの新しい行を手元の古い木で
        // 上書きしてしまう。置き場が無いときだけ、知らせて黙る。
        if (isOutlineTableMissing()) setSyncNote("missing-table");
        return;
      }
      if (revisions instanceof Map) {
        serverRevisionsRef.current = revisions;
        casRef.current = "available";
      } else if (revisions === undefined) {
        casRef.current = "legacy";
      } else if (casRef.current !== "legacy") {
        setSyncNote("error:サーバーの世代を確認できませんでした");
        return;
      }
      readyRef.current = true;
      setSyncStatus(sendingRef.current ? "sending" : "waiting");
      // 置き場に列が足りないと、その持ち物（日付・画像の幅・色）だけが
      // ほかの端末に伝わらない。黙っていると「端末ごとに違う」になる。
      if (absentOutlineColumns().length) setSyncNote(`missing-col:${absentOutlineColumns().join(",")}`);
      const remote = buildTree(rows);
      applyRaw((mine) => {
        const merged = mergeOutline(mine, remote, tombRef.current, knownRef.current, pendingOutlineIds(queueRef.current));
        // 向こうの姿を覚えておく。食い違うぶんは、このあとの保存で送られる。
        syncedRef.current = new Map(flattenTree(remote).map((r) => [r.id, outlineRowSignature(r)]));
        const known = new Set(syncedRef.current.keys());
        knownRef.current = known;
        // 全件削除も読み込み成功の結果。空を失敗扱いすると、古い行を送り返してしまう。
        return merged;
      });
      saveLocal();
      setSyncedAt(new Date().toISOString());
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ほかの端末の変化を、すぐ受け取る（Supabase Realtime）。
  // 細かく届くので、少しためてから一度に入れる。
  const inboxRef = useRef({ rows: new Map(), gone: new Set() });
  const wakeRef = useRef(null);          // 戻ってきたときに、繋ぎ直して読む
  const cleanupRef = useRef(null);
  const inboxTimer = useRef(null);
  const takeInbox = useCallback(() => {
    if (!ownerRef.current || stoppedRef.current) return;
    const box = inboxRef.current;
    // 待機中に消した行も、反映する瞬間の印で止める。
    const rows = [...box.rows.values()].filter((row) => !tombRef.current.has(row.id));
    const gone = [...box.gone];
    inboxRef.current = { rows: new Map(), gone: new Set() };
    if (!rows.length && !gone.length) return;
    trackOutlineWork(workRef.current, (async () => {
      if (casRef.current === "available") {
        const revisions = await loadOutlineRevisions();
        if (!ownerRef.current || stoppedRef.current) return;
        if (!(revisions instanceof Map)) {
          setSyncNote("error:受信した変更の世代を確認できませんでした");
          return;
        }
        serverRevisionsRef.current = revisions;
      }
      setSyncStatus(sendingRef.current ? "sending" : "waiting");
      const pending = pendingOutlineIds(queueRef.current);
      applyRaw((mine) => applyRemoteRows(mine, rows.filter((row) => !pending.has(row.id)), gone.filter((id) => !pending.has(id))));
      // 届いたぶんは「向こうにもある」ので、送り返さない
      const next = new Map(syncedRef.current);
      for (const row of rows) next.set(row.id, outlineRowSignature(row));
      for (const id of gone) {
        next.delete(id);
        if (!queueRef.current.pending.has(id)) tombRef.current.delete(id);
      }
      syncedRef.current = next;
      knownRef.current = new Set(next.keys());
      saveLocal();
      setSyncedAt(new Date().toISOString());
    })());
  }, [applyRaw, saveLocal]);

  const listen = useCallback(() => subscribeOutline(({ rows = [], gone = [] }) => {
    const box = inboxRef.current;
    for (const row of rows) {
      // 自分が送ったぶんは、入れ直さない
      if (syncedRef.current.get(row.id) === outlineRowSignature(row)) continue;
      box.rows.set(row.id, row);
      box.gone.delete(row.id);
    }
    for (const id of gone) { box.gone.add(id); box.rows.delete(id); }
    clearTimeout(inboxTimer.current);
    inboxTimer.current = setTimeout(takeInbox, 250);
  }, setLink), [takeInbox]);

  // 起き抜けの読み込み。
  //   1. この端末の控え（IndexedDB のほうが新しければ、そちら）
  //   2. 消した印と、向こうで確かめた覚え
  //   3. そのうえで、向こう（Supabase）と突き合わせる
  // 順番が崩れると、空の木を本物だと思って送り返してしまう。
  useEffect(() => {
    let alive = true;
    let stop = null;
    let every = null;
    const stopOwner = holdOutlineOwner(navigator.locks, () => {
      ownerRef.current = true;
      setOwner("active");
      // 待機中に他タブの保存が進むので、起動時の写しはここで取り直す。
      const initial = readLocalOutline();
      trackOutlineWork(workRef.current, (async () => {
        let got;
        let readFailed = false;
        try { got = await bigGet(OUTLINE_KEY, { throwOnError: true }); }
        catch { readFailed = true; }
        if (!alive) return;
        if (readFailed) {
          // もう一方に新しい世代があるか確認できないので、古い写しで押しのけない。
          markLocal("read-error", false, false);
          return;
        }
        let chosen;
        try {
          let legacySource;
          if (got?.format && initial && !initial.format) {
            // 新形式の確定直後に閉じると、移行元の小さい写しだけ残ることがある。
            legacySource = await bigGet(OUTLINE_KEY + "-legacy-copy", { throwOnError: true });
            if (!legacySource) {
              try { legacySource = JSON.parse(localStorage.getItem(OUTLINE_KEY + "-legacy-copy") || "null"); } catch { /* noop */ }
            }
          }
          chosen = chooseOutlineSnapshot(initial, got, legacySource);
        }
        catch {
          // 将来の形式や壊れた未送信記録を「空」として上書きしない。
          markLocal("read-error", false, false);
          return;
        }
        if (!alive) return;
        const base = chosen?.nodes || nodesRef.current;
        const deleted = chosen && !chosen.legacy ? new Set(chosen.sync.deleted) : await readIds(OUTLINE_TOMB_KEY);
        const known = chosen && !chosen.legacy ? new Set(chosen.sync.known) : await readIds(OUTLINE_KNOWN_KEY);
        if (!alive) return;
        // 形式を切り替える前に、旧形式の控えを別名で残す。
        if (chosen?.legacy) {
          const key = OUTLINE_KEY + "-legacy-copy";
          const backup = { nodes: base, deleted: [...deleted], known: [...known] };
          let kept = !!await bigGet(key);
          if (!kept) kept = await bigPut(key, backup);
          if (!kept) {
            try { localStorage.setItem(key, JSON.stringify(backup)); kept = true; } catch { /* 控えが残るまで切り替えない */ }
          }
          if (!alive) return;
          if (!kept) { markLocal("read-error", false, false); return; }
        }
        // 控えや印の読み出し中にも入力できる。最後のawaitのあとで拾い直す。
        const early = queueRef.current.pending;
        const restored = replayOutlineRows(base, nodesRef.current, early);
        let queue = chosen && !chosen.legacy
          ? { sequence: chosen.sync.sequence, pending: new Map(chosen.sync.pending.map((op) => [op.id, op])) }
          : { sequence: 0, pending: new Map() };
        queue = queueOutlineRows(queue, [...early.values()]);
        for (const op of early.values()) {
          if (op.kind === "delete") deleted.add(op.id);
          else deleted.delete(op.id);
        }
        for (const row of flattenTree(restored)) deleted.delete(row.id);
        queueRef.current = queue;
        setSyncStatus(queue.pending.size ? "waiting" : "checking");
        tombRef.current = deleted;
        knownRef.current = known;
        revisionRef.current = Math.max(chosen?.revision || 0, got?.revision || 0, initial?.revision || 0);
        rowSaveRef.current = chosen?.large === true;
        applyRaw(() => restored.map(ensureNode));
        // 本文と記録を読み終えたここから、ひとまとめに保存してよい。
        bigReadRef.current = true;
        saveLocal();
        pullOnce();
        stop = listen();

        // 端末をしまうと websocket は切られる（iPad・携帯はとくに）。
        // 戻ってきたとき・つながり直したときに、繋ぎ直して読み直す。
        // 気づかないうちに切れたまま、が いちばん困る。
        const again = () => {
          if (document.visibilityState !== "visible") return;
          pullOnce();
          if (stop) stop();
          setLink("waking");
          stop = listen();
        };
        wakeRef.current = again;
        document.addEventListener("visibilitychange", again);
        window.addEventListener("online", again);
        // 受け取りが効いていない置き場（Realtime を入れていない等）でも
        // 置いていかれないよう、見ているあいだは、ときどき読み直す。
        every = setInterval(() => { if (document.visibilityState === "visible") pullOnce(); }, 60000);
        cleanupRef.current = () => {
          document.removeEventListener("visibilitychange", again);
          window.removeEventListener("online", again);
        };
      })());
      return async () => {
        alive = false;
        ownerRef.current = false;
        bigReadRef.current = false;
        readyRef.current = false;
        clearTimeout(timerRef.current);
        clearTimeout(inboxTimer.current);
        clearTimeout(retryRef.current);
        clearTimeout(localRetryRef.current);
        clearInterval(every);
        if (cleanupRef.current) cleanupRef.current();
        if (stop) stop();
        // React上の切替でも、前の書き込みが残る間は次の所有者に渡さない。
        while (workRef.current.size) await Promise.allSettled([...workRef.current]);
      };
    }, () => {
      ownerRef.current = false;
      bigReadRef.current = false;
      setOwner("unavailable");
    });
    return stopOwner;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  const undo = useCallback(() => {
    if (!ownerRef.current || stoppedRef.current) return;
    const h = histRef.current;
    if (!h.past.length) return;
    const prev = h.past[h.past.length - 1];
    const now = nodesRef.current;
    const restored = prepareLocal(now, prev);
    nodesRef.current = restored;
    setNodes(restored);
    coalesceRef.current = { key: null, at: 0 };
    syncHist({ past: h.past.slice(0, -1), future: [...h.future, now].slice(-100) });
  }, [prepareLocal]);

  const redo = useCallback(() => {
    if (!ownerRef.current || stoppedRef.current) return;
    const h = histRef.current;
    if (!h.future.length) return;
    const node = h.future[h.future.length - 1];
    const now = nodesRef.current;
    const restored = prepareLocal(now, node);
    nodesRef.current = restored;
    setNodes(restored);
    coalesceRef.current = { key: null, at: 0 };
    syncHist({ past: [...h.past, now].slice(-100), future: h.future.slice(0, -1) });
  }, [prepareLocal]);


  // 書き込み：同時に送るのは1件だけ。送信中の編集は、完了後に最新の木から拾う。
  useEffect(() => {
    if (!ownerRef.current || !readyRef.current) return;
    clearTimeout(timerRef.current);
    if (sendWaitRef.current === null) sendWaitRef.current = Date.now();
    const wait = Math.min(800, Math.max(0, 2000 - (Date.now() - sendWaitRef.current)));
    timerRef.current = setTimeout(() => trackOutlineWork(workRef.current, (async () => {
      sendWaitRef.current = null;
      if (!ownerRef.current || sendingRef.current || stoppedRef.current) return;
      const rows = flattenTree(nodesRef.current);
      const before = new Map(syncedRef.current);
      const here = new Set(rows.map((r) => r.id));
      const changed = rows.filter((r) => queueRef.current.pending.get(r.id)?.kind === "put" || before.get(r.id) !== outlineRowSignature(r));
      const gone = [...new Set([...before.keys(), ...tombRef.current])].filter((id) => !here.has(id));
      for (const id of here) tombRef.current.delete(id);
      if (!changed.length && !gone.length) { setSyncStatus("synced"); return; }
      // 旧形式から読んだ差分も、送る前に未送信の世代として残す。
      const missing = [
        ...changed.filter((row) => !queueRef.current.pending.has(row.id)).map((row) => ({ id: row.id, kind: "put" })),
        ...gone.filter((id) => !queueRef.current.pending.has(id)).map((id) => ({ id, kind: "delete" })),
      ];
      queueRef.current = queueOutlineRows(queueRef.current, missing, serverRevisionsRef.current);
      gone.forEach((id) => tombRef.current.add(id));
      let sendChanged = changed;
      let sendGone = gone;
      let sent = [...changed.map((row) => row.id), ...gone].map((id) => queueRef.current.pending.get(id));
      let operationId = null;
      if (casRef.current === "available") {
        if (sent.some((op) => op?.expectedRevision === undefined)) {
          const [latestRows, latestRevisions] = await Promise.all([loadOutlineRows(), loadOutlineRevisions()]);
          if (!latestRows || !(latestRevisions instanceof Map)) {
            setSyncNote("error:送信前の世代を確認できませんでした");
            return;
          }
          const signatures = new Map(latestRows.map((row) => [row.id, outlineRowSignature(row)]));
          const resolved = resolveOutlineRevisions(
            queueRef.current, sent.map((op) => op.id), latestRevisions, signatures);
          queueRef.current = resolved.queue;
          serverRevisionsRef.current = latestRevisions;
          if (resolved.conflicts.length) {
            setSyncNote(`conflict:${resolved.conflicts.join(",")}`);
            saveLocal();
            return;
          }
          sent = sent.map((op) => queueRef.current.pending.get(op.id));
        }
        const prepared = prepareOutlineOperation(
          queueRef.current, sent.map((op) => op.id), crypto.randomUUID());
        queueRef.current = prepared.queue;
        sent = prepared.sent;
        operationId = prepared.operationId;
        const ids = new Set(sent.map((op) => op.id));
        sendChanged = changed.filter((row) => ids.has(row.id));
        sendGone = gone.filter((id) => ids.has(id));
      }
      sendingRef.current = true;
      setSyncStatus("sending");
      try {
        // 保存前に送ると、返事を失って開き直したときに再送の根拠が無くなる。
        if (!await saveLocal()) {
          if (!stoppedRef.current) {
            clearTimeout(retryRef.current);
            retryRef.current = setTimeout(() => setRetry((n) => n + 1), 15000);
          }
          return;
        }
        if (stoppedRef.current) return;
        let err;
        let acceptedRevisions = new Map();
        try {
          if (casRef.current === "available") {
            const expected = new Map(sent.map((op) => [op.id, op.expectedRevision]));
            const result = await saveOutlineRowsCas(sendChanged, sendGone, operationId, expected);
            if (result === undefined) {
              // SQLをまだ入れていない環境は従来経路へ戻す。導入済みの通信失敗では戻さない。
              casRef.current = "legacy";
              err = await saveOutlineRows(sendChanged, sendGone);
            } else if (result.error) err = result.error;
            else if (result.conflicts?.length) {
              setSyncNote(`conflict:${result.conflicts.map((item) => item.id).join(",")}`);
              return;
            } else {
              acceptedRevisions = result.revisions;
              for (const [id, revision] of acceptedRevisions) serverRevisionsRef.current.set(id, revision);
            }
          } else {
            err = await saveOutlineRows(sendChanged, sendGone);
          }
        }
        catch (error) { err = error?.message || String(error); }
        if (stoppedRef.current) return;
        if (isOutlineTableMissing()) { setSyncNote("missing-table"); return; }
        if (err) {
          setSyncNote(`error:${err}`);
          clearTimeout(retryRef.current);
          retryRef.current = setTimeout(() => setRetry((n) => n + 1), 15000);
          return;
        }
        clearTimeout(retryRef.current);
        setSyncNote((cur) => (cur.startsWith("error:") ? "" : cur));
        queueRef.current = acknowledgeOutlineRows(queueRef.current, sent, acceptedRevisions);
        for (const id of sendGone) if (!queueRef.current.pending.has(id)) tombRef.current.delete(id);
        const next = new Map(syncedRef.current);
        sendGone.forEach((id) => next.delete(id));
        sendChanged.forEach((row) => next.set(row.id, outlineRowSignature(row)));
        syncedRef.current = next;
        knownRef.current = new Set(next.keys());
        // 送信完了と、送信中の追加編集も同じ本文の控えへ確定する。
        saveLocal();
        setRetry((n) => n + 1);
      } finally {
        sendingRef.current = false;
        if (!stoppedRef.current) setSyncStatus(queueRef.current.pending.size ? "waiting" : "synced");
      }

    })()), wait);
    return () => clearTimeout(timerRef.current);
  }, [nodes, retry, saveLocal]);

  // アウトラインを触っていたときの Ctrl+Z は、こちらで受ける。
  // タスク側の取り消しと取り合いにならないよう、先に捕まえて止める。
  const inOutlineRef = useRef(false);
  useEffect(() => {
    const mark = (e) => { inOutlineRef.current = !!e.target?.closest?.("[data-outliner]"); };
    const onKey = (e) => {
      if (!(e.metaKey || e.ctrlKey) || !inOutlineRef.current) return;
      const key = e.key.toLowerCase();
      if (key !== "z" && key !== "y") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (key === "y" || e.shiftKey) redo(); else undo();
    };
    window.addEventListener("pointerdown", mark, true);
    window.addEventListener("focusin", mark, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", mark, true);
      window.removeEventListener("focusin", mark, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [undo, redo]);

  // ぜんぶ消したあとに、同期の覚えも白紙に戻す
  const resetSync = useCallback(() => {
    if (!ownerRef.current || stoppedRef.current) return;
    tombRef.current = new Set();
    knownRef.current = new Set();
    syncedRef.current = new Map();
    queueRef.current = { sequence: queueRef.current.sequence, pending: new Map() };
    setSyncStatus(sendingRef.current ? "sending" : "waiting");
    saveLocal();
  }, [saveLocal]);

  // 向こう（Supabase）の姿に、この端末をそのまま合わせる。
  // 端末ごとに中身が食い違ったとき、どれか1台を正として揃えるための口。
  // 突き合わせではなく置き換えなので、この端末だけの書きかけは消える。
  const pullRemote = useCallback(async () => {
    if (!ownerRef.current || stoppedRef.current) return { ok: false, why: "別のタブで編集中です" };
    if (sendingRef.current) return { ok: false, why: "送信が終わってから、もう一度押してください" };
    // 置き換えの途中で、直前の送信タイマーが古い未送信記録を再送しないよう止める。
    readyRef.current = false;
    clearTimeout(timerRef.current);
    sendWaitRef.current = null;
    try {
      const [rows, revisions] = await trackOutlineWork(workRef.current, Promise.all([loadOutlineRows(), loadOutlineRevisions()]));
      if (!ownerRef.current || stoppedRef.current || !rows) return { ok: false, why: isOutlineTableMissing() ? "置き場がありません" : "読めませんでした" };
      if (casRef.current === "available" && !(revisions instanceof Map)) return { ok: false, why: "向こうの世代を確認できませんでした" };
      if (revisions instanceof Map) serverRevisionsRef.current = revisions;
      const remote = buildTree(rows);
      const replacement = remote.length ? remote : [ensureNode({ id: "start", text: "" })];
      // 通常編集の経路を通すと、置換そのものが一瞬だけ未送信変更になる。
      // 先にキューを捨て、履歴だけを手動で残して受信扱いで置き換える。
      queueRef.current = { sequence: queueRef.current.sequence, pending: new Map() };
      tombRef.current = new Set();
      syncedRef.current = new Map(flattenTree(remote).map((r) => [r.id, outlineRowSignature(r)]));
      knownRef.current = new Set(syncedRef.current.keys());
      const previous = nodesRef.current;
      applyRaw(() => replacement);
      const history = histRef.current;
      syncHist({ past: [...history.past, previous].slice(-100), future: [] });
      setSyncNote((cur) => cur.startsWith("conflict:") ? "" : cur);
      const saved = await saveLocal();
      if (!saved) return { ok: false, why: "この端末への保存が完了していません" };
      setSyncStatus("synced");
      return { ok: true, count: flattenTree(remote).length };
    } finally {
      readyRef.current = true;
      // 置換中に止めた送信判定を、空になったキューからやり直す。
      if (ownerRef.current && !stoppedRef.current) setRetry((n) => n + 1);
    }
  }, [applyRaw, saveLocal]);

  const value = useMemo(() => ({
    nodes, setNodes: apply, setNodesRaw: applyRaw, view, setView, resetSync, pullRemote,
    clearRemote: () => ownerRef.current && !stoppedRef.current ? trackOutlineWork(workRef.current, clearOutlineRows()) : Promise.resolve("別のタブで編集中です"),
    owner, link, syncedAt, syncStatus, refresh: () => wakeRef.current?.(),
    undo, redo, canUndo: histCount.past > 0, canRedo: histCount.future > 0,
    syncNote, dismissSync: () => setSyncNote(""), localSave, retryLocalSave: () => {
      saveLocal();
      setRetry((n) => n + 1);
    },
    dismissLocalInfo: () => setLocalSave((prev) => ({ ...prev, hidden: true })),
    getLocalCheckpoint: () => bigReadRef.current
      ? outlineCheckpoint(nodesRef.current, queueRef.current, tombRef.current, knownRef.current, revisionRef.current, new Date().toISOString()) : null,
  }), [nodes, apply, applyRaw, undo, redo, histCount, syncNote, view, setView, resetSync, pullRemote, owner, link, syncedAt, syncStatus, localSave, saveLocal]);
  // 「いまの木」はしまっておき、使うときに読む
  const api = useMemo(() => ({
    addMemo: (dateLabel, text) => {
      if (!ownerRef.current || stoppedRef.current) return null;
      const got = addMemoUnderDate(nodesRef.current, dateLabel, text);
      apply(() => got.nodes);
      return got;
    },
  }), [apply]);

  return (
    <OutlineApiContext.Provider value={api}>
      <OutlineContext.Provider value={value}>
        {owner !== "active" && (
          <div data-outline-owner={owner} role="status" className="border-b border-amber-400/30 bg-amber-400/10 p-2 text-xs text-amber-100">
            {owner === "waiting"
              ? "アウトラインは別のタブで編集中です。このタブは待機しています。編集タブを閉じると、最新の保存内容を読み直して引き継ぎます。"
              : "このブラウザーではアウトラインのタブ間保護を使えません。対応ブラウザーで開いてください。"}
          </div>
        )}
        {children}
      </OutlineContext.Provider>
    </OutlineApiContext.Provider>
  );
}

// 木を使わず、書き足すだけの側はこちら（描き直しに巻き込まれない）
export function useOutlineApi() {
  const ctx = React.useContext(OutlineApiContext);
  if (!ctx) throw new Error("OutlineProvider の中で使ってください");
  return ctx;
}

export function useOutline() {
  const ctx = React.useContext(OutlineContext);
  if (ctx) return ctx;
  throw new Error("OutlineProvider の中で使ってください");
}

// Quietliner と同じ見本（色の値もそのまま）
const TEXT_COLORS = [
  { label: "そのまま", value: null },
  { label: "赤", value: "#e03535" },
  { label: "橙", value: "#d97322" },
  { label: "黄", value: "#b88b0f" },
  { label: "緑", value: "#1a8c40" },
  { label: "青", value: "#2355a8" },
  { label: "紫", value: "#7b3fbf" },
  { label: "灰", value: "#767676" },
];
const BG_COLORS = [
  { label: "なし", value: null },
  { label: "赤", value: "rgba(255,80,80,0.10)" },
  { label: "橙", value: "rgba(255,160,50,0.12)" },
  { label: "黄", value: "rgba(255,220,50,0.13)" },
  { label: "緑", value: "rgba(50,200,100,0.10)" },
  { label: "青", value: "rgba(50,130,255,0.10)" },
  { label: "紫", value: "rgba(180,80,255,0.10)" },
  { label: "灰", value: "rgba(120,120,120,0.09)" },
];
// 見出しの大きさ。Quietliner の倍率に合わせてある。
const HEADING = {
  1: { fontSize: "1.55em", fontWeight: 650, lineHeight: 1.28 },
  2: { fontSize: "1.28em", fontWeight: 610, lineHeight: 1.32 },
  3: { fontSize: "1.1em", fontWeight: 560 },
};

function classNames(...xs) {
  return xs.filter(Boolean).join(" ");
}

// 何も無いときの始まり。空の行をひとつだけ。
// 案内の行を作ると、入れ直すたびに向こうへ足され、端末ごとに増えてしまう。
// id を決め打ちにしてあるのも同じ理由（同じ行として重なる）。
function defaultOutline() {
  return [ensureNode({ id: "start", text: "" })];
}

function readLocalOutline() {
  try { return JSON.parse(localStorage.getItem(OUTLINE_KEY) || "null"); }
  catch { return null; }
}

function load(raw) {
  try {
    const saved = readOutlineSnapshot(raw);
    if (saved) return saved.nodes.map(ensureNode);
  } catch { /* 読めない形式は、起動処理でも止めて保存済みの本体を守る */ }
  return defaultOutline();
}



// 行の文字。探しているときは当たったところに印、ふだんは #タグ を色づけ。
function Marked({ text, query }) {
  if (String(query || "").trim()) {
    const parts = splitByQuery(text, query);
    if (parts.length === 1 && !parts[0].hit) return text;
    return parts.map((p, i) => (p.hit
      ? <mark key={i} className="rounded bg-amber-300/30 px-px text-inherit">{p.text}</mark>
      : <span key={i}>{p.text}</span>));
  }
  const parts = splitTags(text);
  if (parts.length === 1 && !parts[0].tag) return text;
  return parts.map((p, i) => (p.tag
    ? <span key={i} data-tag className="text-sky-300/80">{p.text}</span>
    : <span key={i}>{p.text}</span>));
}

// アウトライン（Quietliner）。
export default function Outliner() {
  const { nodes, setNodes, undo, redo, canUndo, canRedo, syncNote, dismissSync, localSave, retryLocalSave, dismissLocalInfo, getLocalCheckpoint, view, setView, resetSync, pullRemote, clearRemote, owner, link, syncedAt, syncStatus, refresh } = useOutline();
  // 接続中でも、保存失敗や未送信の編集があれば同期済みとは表示しない。
  const syncState = owner === "unavailable" ? "tab-unavailable"
    : owner !== "active" ? "tab-waiting"
    : localSave.status === "read-error" ? "read-error"
    : localSave.status === "error" ? "local-error"
      : link === "off" ? "local-only"
        : localSave.busy || localSave.status === "loading" ? "saving"
          : syncNote === "missing-table" || syncNote.startsWith("error:") ? "error"
            : syncNote.startsWith("conflict:") ? "conflict"
            : syncNote.startsWith("missing-col:") || absentOutlineColumns().length > 0 ? "partial" : syncStatus;
  const syncLabel = {
    "tab-unavailable": "編集を保留", "tab-waiting": "別タブで編集中", checking: "同期を確認中", waiting: "送信待ち", sending: "送信中", synced: "同期済み",
    saving: "保存待ち", "local-error": "保存できません", "read-error": "読み出しエラー",
    error: "同期エラー", conflict: "確認が必要", partial: "一部未同期", "local-only": "この端末のみ",
  }[syncState];
  const [viewOpen, setViewOpen] = useState(false);
  // 狭い画面では、設定を下から出すシートにする。
  // ぶら下げたままだと枠の外に出てしまい、指が届かない。
  const [narrow, setNarrow] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const sync = () => setNarrow(mq.matches);
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  const [drive, setDrive] = useState(readDriveSetting);
  const saveDrive = (patchIt) => {
    const next = { ...drive, ...patchIt };
    setDrive(next);
    writeDriveSetting(next);
  };
  const [zoomId, setZoomId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [menuId, setMenuId] = useState(null);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState([]);     // まとめて選んだ行
  const [tagHint, setTagHint] = useState(null); // { id, items, at }  #タグの候補
  const [band, setBand] = useState(null);       // なぞって選ぶときの枠
  const [dateView, setDateView] = useState(false);     // 日付の順に並べて見る
  // 書くことに集中：打っているあいだは、細かい表示を引っ込める。
  // 指やマウスが動いたら、すぐ戻す（押したいものが見えないと困るので）。
  const [calm, setCalm] = useState(false);
  const calmTimer = useRef(null);
  const wake = useCallback(() => {
    clearTimeout(calmTimer.current);
    setCalm(false);
  }, []);
  const hush = useCallback(() => {
    if (!view.immersive) return;
    clearTimeout(calmTimer.current);
    calmTimer.current = setTimeout(() => setCalm(true), 450);
  }, [view.immersive]);
  useEffect(() => {
    if (!view.immersive) { setCalm(false); return; }
    window.addEventListener("pointermove", wake);
    window.addEventListener("pointerdown", wake);
    return () => {
      window.removeEventListener("pointermove", wake);
      window.removeEventListener("pointerdown", wake);
      clearTimeout(calmTimer.current);
    };
  }, [view.immersive, wake]);
  // 書いていない（どの行も開いていない）ときは、静かにしない
  useEffect(() => { if (!editingId) setCalm(false); }, [editingId]);
  // 日付ビューで、既定と違う開き方にした見出し（年月は畳む、日は開くが既定）
  const [flippedDates, setFlippedDates] = useState(new Set());
  const anchorRef = useRef(null);                // Shift+クリックの起点
  const [note, setNote] = useState("");       // 持ち込みの結果を知らせる
  const searchRef = useRef(null);
  const fileRef = useRef(null);
  const listRef = useRef(null);
  // 掴んでいるあいだの様子。落ちる場所は線で見せる。
  const dragRef = useRef(null);
  const [drag, setDrag] = useState(null);   // { id, top, depth }
  const INDENT = 20;
  // 編集に入ったときのカーソル位置。-1 は末尾。
  const caretRef = useRef(null);
  const menuRef = useRef(null);

  // まとめて選んでいるときのキー操作
  useEffect(() => {
    if (!picked.length) return;
    function onKey(e) {
      const inText = ["input", "textarea"].includes(document.activeElement?.tagName?.toLowerCase());
      if (e.key === "Escape") { clearPick(); return; }
      if (inText) return;
      if (e.key === "Tab") { e.preventDefault(); bulkIndent(e.shiftKey); return; }
      if (e.key === "Backspace" || e.key === "Delete") { e.preventDefault(); bulkDelete(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); bulkComplete(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c") { e.preventDefault(); bulkCopy(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // タイプライター：書いている行を、枠の決まった高さに保つ。
  // 画面ではなく「この枠」の中で合わせる（枠ごとに転がすため）。
  const keepAtAnchor = useCallback(() => {
    if (!view.typewriter || !editingId) return;
    const row = listRef.current?.querySelector(`[data-row="${editingId}"]`);
    const box = row?.closest("[data-pane-id]") || listRef.current?.parentElement;
    if (!row || !box) return;
    const r = row.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    const want = b.top + b.height * (view.anchor ?? 0.6);
    const delta = r.top + r.height / 2 - want;
    if (Math.abs(delta) > 2) box.scrollTop += delta;
  }, [view.typewriter, view.anchor, editingId]);

  // 行が編集欄に変わると高さが少し動くので、整ってから合わせる
  useEffect(() => {
    const id = requestAnimationFrame(keepAtAnchor);
    return () => cancelAnimationFrame(id);
  }, [keepAtAnchor, nodes]);

  // ⌘/Ctrl+K で探す欄に移る（Quietliner と同じ）
  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // メニューの外を押したら閉じる
  useEffect(() => {
    if (!menuId) return;
    function onDown(e) {
      if (!menuRef.current?.contains(e.target)) setMenuId(null);
    }
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [menuId]);

  // 星をつけた行。押すとそこへ飛ぶ（Quietliner のサイドバーに当たるもの）
  const favorites = useMemo(() => collectFavorites(nodes), [nodes]);
  const zoomPath = useMemo(() => (zoomId ? pathTo(nodes, zoomId) : null), [nodes, zoomId]);
  const zoomNode = zoomPath?.at(-1) || null;
  const shown = zoomNode ? zoomNode.children : nodes;
  // 探しているあいだは、当たった行とその親だけを出す
  // 日付の見出しの開き／閉じ
  const flipDate = (id) => setFlippedDates((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const searching = query.trim().length > 0;
  const filtered = useMemo(() => (searching ? filterByQuery(shown, query) : shown), [shown, query, searching]);
  // 日付ビューでは、年＞年/月＞年/月/日 に組み直して見せる（元の木は触らない）
  const listed = useMemo(() => {
    if (!dateView) return filtered;
    const open = (node) => ({
      ...node,
      collapsed: node.virtual
        ? (node.defaultOpen ? flippedDates.has(node.id) : !flippedDates.has(node.id))
        : node.collapsed,
      children: (node.children || []).map(open),
    });
    // 行に日付が入っていなくても、見出しの並びから割り出して並べる
    return groupByDate(fillDates(filtered)).map(open);
  }, [dateView, filtered, flippedDates]);
  // 日付ビューと検索中は、形を変える操作をしない（見えている並びが元と違うため）
  const frozen = searching || dateView;
  const rows = useMemo(() => visibleRows(listed), [listed]);

  const edit = useCallback((id, caret = -1) => {
    caretRef.current = caret;
    setEditingId(id);
    // いま触っている行が、まとめて選ぶときの起点になる
    anchorRef.current = id;
  }, []);

  // ズームしているときは、その子の並びだけを差し替える
  const applyShown = useCallback((makeNext) => {
    setNodes((prev) => {
      if (!zoomNode) return makeNext(prev);
      const here = pathTo(prev, zoomNode.id)?.at(-1);
      if (!here) return prev;
      return updateNode(prev, zoomNode.id, { children: makeNext(here.children) });
    });
  }, [zoomNode]);

  function patch(id, p, opts) {
    setNodes((prev) => updateNode(prev, id, p), opts);
  }

  // 連続して打っているあいだは、取り消しの1手にまとめる
  const typeText = (id, text) => patch(id, { text }, { coalesce: `text:${id}` });

  // #… を打っているあいだ、使ったことのあるタグを出す
  function refreshTagHint(id, el) {
    const at = hashtagAtCursor(el.value, el.selectionStart);
    if (!at) { setTagHint(null); return; }
    const items = tagSuggestions(allTags, at.query);
    setTagHint(items.length ? { id, items, sel: 0 } : null);
  }

  // 候補を選んだとき。打ちかけの #… を置き換えて、続きを打てるようにする。
  function takeTag(node, el, tag) {
    const got = applyTag(el.value, el.selectionStart, tag);
    typeText(node.id, got.text);
    setTagHint(null);
    requestAnimationFrame(() => {
      const live = document.querySelector(`[data-row="${node.id}"] textarea`);
      if (live) { live.focus(); live.setSelectionRange(got.caret, got.caret); }
    });
  }

  function exportJson() {
    const text = JSON.stringify(buildExport(nodes), null, 2);
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `outline-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNote("書き出しました");
  }

  // ほかのアプリの書き出しを取り込む。
  //   .json … Quietliner（行に id があるので、2回読んでも増えない）
  //   .md / .html / .zip … WorkFlowy や Notion（id が無いので、同じ文字の行に重ねる）
  async function importFile(file) {
    if (!file) return;
    setNote("読み込んでいます…");
    try {
      const name = file.name || "";
      let result = null;

      if (/\.zip$/i.test(name)) {
        const got = await parseZip(await file.arrayBuffer());
        // 取り込んだぶんは畳んで入れる（何千行も開いた状態だと見失う）。
        // あわせて、見出しから日付を拾って行に持たせる（日付ビュー用）。
        result = { ...mergeByText(nodes, fillDates(got.items), { collapseNew: true }), how: `zip の中の ${got.files} ファイル` };
      } else {
        const text = await file.text();
        const looksJson = /\.json$/i.test(name) || /^\s*[[{]/.test(text);
        if (looksJson) {
          const got = importOutline(nodes, JSON.parse(text));
          result = { ...got, nodes: fillDates(got.nodes), how: "Quietliner の書き出し" };
        } else {
          const got = parseByFormat(name, text);
          result = {
            ...mergeByText(nodes, fillDates(got.items), { collapseNew: true }),
            how: got.format === "workflowy-html" ? "WorkFlowy の HTML" : "箇条書きの書き出し",
          };
        }
      }

      setNodes(() => result.nodes);
      const parts = [];
      if (result.added) parts.push(`${result.added}件を足した`);
      if (result.updated) parts.push(`${result.updated}件を更新`);
      if (result.matched) parts.push(`${result.matched}件は既にあった`);
      if (result.merged) parts.push(`${result.merged}件は同じ名前の行にまとめた`);
      if (result.skipped) parts.push(`${result.skipped}件は向こうで消えていたので飛ばした`);
      setNote(`${result.how}：${parts.length ? parts.join("、") : "変わりはありませんでした"}`);
    } catch (e) {
      setNote(`読めませんでした：${e?.message || e}`);
    }
  }

  // ● を掴んで木ごと動かす。落ちる場所は、すぐ上の行と横の動きで決める。
  function startDrag(e, node) {
    if (e.button !== undefined && e.button !== 0) return;
    if (frozen) return; // 見えている並びが元の木と違うときは、並べ替えない
    e.preventDefault();
    const list = listRef.current;
    if (!list) return;
    const listTop = list.getBoundingClientRect().top;
    const startDepth = rows.find((r) => r.node.id === node.id)?.depth ?? 0;
    const measured = rows.flatMap((r) => {
      const el = list.querySelector(`[data-row="${r.node.id}"]`);
      if (!el) return [];   // 描き替えの隙に消えていることがある
      const box = el.getBoundingClientRect();
      return [{ id: r.node.id, depth: r.depth, top: box.top - listTop, height: box.height }];
    });
    if (!measured.length) return;
    dragRef.current = { id: node.id, startX: e.clientX, startDepth, rows: measured, moved: false, drop: null };

    const move = (ev) => {
      const d = dragRef.current;
      if (!d) return;
      if (!d.moved && Math.abs(ev.clientX - d.startX) + Math.abs(ev.clientY - e.clientY) < 4) return;
      d.moved = true;
      const y = ev.clientY - listTop;
      let i = 0;
      while (i < d.rows.length && y > d.rows[i].top + d.rows[i].height / 2) i += 1;
      const prev = d.rows[i - 1] || null;
      const next = d.rows[i] || null;
      const maxDepth = prev ? prev.depth + 1 : 0;
      const minDepth = next ? next.depth : 0;
      const raw = d.startDepth + Math.round((ev.clientX - d.startX) / INDENT);
      const depth = Math.max(Math.min(minDepth, maxDepth), Math.min(maxDepth, Math.max(minDepth, raw)));
      d.drop = { prevId: prev?.id ?? null, depth };
      setDrag({ id: d.id, top: prev ? prev.top + prev.height : 0, depth });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      const d = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!d?.moved || !d.drop) return;
      applyShown((listNodes) => moveSubtreeTo(listNodes, d.id, d.drop.prevId, d.drop.depth));
      // 動かした直後のクリックで、ズームに入らないようにする
      setTimeout(() => { skipZoomRef.current = false; }, 0);
      skipZoomRef.current = true;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    // 指が画面の外へ出たときにも、掴んだままにならないようにする
    window.addEventListener("pointercancel", up);
  }
  const skipZoomRef = useRef(false);

  const allTags = useMemo(() => collectAllTags(nodes), [nodes]);
  const pickedSet = useMemo(() => new Set(picked), [picked]);
  function clearPick() { setPicked([]); anchorRef.current = null; }

  // Shift+クリックで、起点からここまでをまとめて選ぶ
  function pickTo(id) {
    const from = anchorRef.current || id;
    setPicked(rangeBetween(listed, from, id));
    anchorRef.current = from;
    setEditingId(null);
  }
  // Ctrl/⌘+クリックで、1行ずつ足し引きする
  function togglePick(id) {
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    anchorRef.current = id;
    setEditingId(null);
  }
  // 余白をなぞって、通った行をまとめて選ぶ。
  // 文字の上から始めたときは、ほかの行にまたいだ時点で切り替える
  //（同じ行の中では、ふつうの文字選択のままにする）。
  function startBand(e, fromId = null) {
    if (e.button !== 0) return;
    const list = listRef.current;
    if (!list) return;
    // 転がす入れ物（枠）。この中での位置で数えると、送っても選びが続く。
    const box = list.closest("[data-pane-id]") || list.parentElement;
    const boxRect = () => box.getBoundingClientRect();
    const toContentY = (clientY) => clientY - boxRect().top + box.scrollTop;

    const start = { x: e.clientX, y: e.clientY, contentY: toContentY(e.clientY) };
    let acting = !fromId;      // 余白からなら、すぐ選び始める
    if (acting) e.preventDefault();
    let last = { x: e.clientX, y: e.clientY };
    let raf = 0;

    const rowAt = (x, y) => document.elementFromPoint(x, y)?.closest("[data-row]")?.getAttribute("data-row") || null;

    // いまの枠に重なっている行を拾う。位置は「枠の中」で見るので、
    // 送って画面から出ていった行も選ばれたまま残る。
    const paint = () => {
      const r = boxRect();
      const curContentY = toContentY(last.y);
      const top = Math.min(start.contentY, curContentY);
      const bottom = Math.max(start.contentY, curContentY);

      const hit = [...list.querySelectorAll("[data-row]")].filter((el) => {
        const b = el.getBoundingClientRect();
        const elTop = b.top - r.top + box.scrollTop;
        return elTop + b.height > top && elTop < bottom;
      }).map((el) => el.getAttribute("data-row"));
      if (fromId && !hit.includes(fromId)) hit.unshift(fromId);
      setPicked(hit);

      // 枠は画面の座標で描く（枠の外にはみ出さないように切る）
      const viewTop = Math.max(r.top, top - box.scrollTop + r.top);
      const viewBottom = Math.min(r.bottom, bottom - box.scrollTop + r.top);
      setBand({
        left: Math.min(start.x, last.x),
        top: viewTop,
        width: Math.abs(last.x - start.x),
        height: Math.max(0, viewBottom - viewTop),
      });
    };

    // 端に近づいたら、枠の中を送る（押さえたまま下まで選べるように）
    const tick = () => {
      const r = boxRect();
      const edge = 48;
      let by = 0;
      if (last.y > r.bottom - edge) by = Math.min(24, (last.y - (r.bottom - edge)) / 2);
      else if (last.y < r.top + edge) by = -Math.min(24, ((r.top + edge) - last.y) / 2);
      if (by) {
        box.scrollTop += by;
        paint();
      }
      raf = requestAnimationFrame(tick);
    };

    const move = (ev) => {
      last = { x: ev.clientX, y: ev.clientY };
      if (!acting) {
        const far = Math.abs(ev.clientX - start.x) + Math.abs(ev.clientY - start.y) > 8;
        // 文字から始めたときは、別の行に入ったら選択に切り替える
        const over = rowAt(ev.clientX, ev.clientY);
        if (!far || !over || over === fromId) return;
        acting = true;
        window.getSelection()?.removeAllRanges();
        setEditingId(null);
        anchorRef.current = fromId;
        raf = requestAnimationFrame(tick);
      }
      ev.preventDefault();
      paint();
    };
    const up = () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setBand(null);
    };
    if (acting) raf = requestAnimationFrame(tick);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  // 画面の順にそろえる（まとめて動かすときに順番が要る）
  const orderedPick = () => visibleRows(listed).map((r) => r.node.id).filter((id) => pickedSet.has(id));

  function bulkIndent(back) {
    const ids = orderedPick();
    if (!ids.length) return;
    applyShown((list) => (back ? outdentMany(list, ids) : indentMany(list, ids)));
  }
  function bulkDelete() {
    const ids = orderedPick();
    if (!ids.length) return;
    applyShown((list) => removeMany(list, ids));
    clearPick();
  }
  function bulkComplete() {
    const ids = orderedPick();
    if (!ids.length) return;
    const allDone = ids.every((id) => pathTo(listed, id)?.at(-1)?.completed);
    applyShown((list) => patchMany(list, ids, { completed: !allDone }));
  }
  async function bulkCopy() {
    const ids = orderedPick();
    if (!ids.length) return;
    try {
      await navigator.clipboard.writeText(textOf(listed, ids));
      setNote(`${ids.length}件をコピーしました`);
    } catch { setNote("コピーできませんでした"); }
  }

  // いまだけの口：中身をぜんぶ空にする。
  // ふつうの書き換えと同じ道を通すので、⌘Z で戻せるし、
  // 向こう（Supabase）の行も、このあとの保存で消える。
  const [confirmClear, setConfirmClear] = useState(false);
  async function clearAll() {
    setNodes(() => [makeNode("")]);
    setZoomId(null);
    clearPick();
    setConfirmClear(false);
    setNote("消しています…");
    // 手元が知っている id に頼らず、向こうの表そのものを空にする。
    // 読めていなかった行が残っていると、次の読み込みで戻ってくるため。
    const err = await clearRemote();
    if (err) { setNote(`向こうを空にできませんでした：${err}`); return; }
    resetSync();
    setNote("ぜんぶ消しました（⌘Z で戻せます）");
  }

  // 控え：この端末に置いてあるもの一式を、ドライブへ。
  // Supabase が飛んでも、ここから戻せるようにしておく。
  function collectAll() {
    const store = {};
    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (!key) continue;
        // 合言葉は控えに入れない
        if (key === "taskspace-drive-token") continue;
        if (/^(taskspace-|notion-like-taskdb|ts-)/.test(key)) store[key] = localStorage.getItem(key);
      }
    } catch { /* 読めないものは諦める */ }
    // 大きい本文と未送信記録も、画面の最新の姿を同じ控えへ入れる。
    const outline = getLocalCheckpoint();
    if (!outline) throw new Error("保存済みの内容を確認できていません");
    store["taskspace-outline-v1"] = JSON.stringify(outline);
    return { app: "taskspace", at: new Date().toISOString(), store };
  }

  async function runBackup(manual = false) {
    if (!hasDrive()) {
      if (manual) setNote("置き場が決まっていません（上の URL と合言葉を入れてください）");
      return;
    }
    if (manual) setNote("控えています…");
    try {
      const got = await backupToDrive(collectAll());
      setNote(`控えました（${got.name || "backups"}）`);
    } catch (e) {
      setNote(`控えられませんでした：${e?.message || e}`);
    }
  }

  // ほどよい間隔で、ひとりでに控える（開いたあと少し置いてから、1日1回）
  useEffect(() => {
    if (!hasDrive() || hoursSinceBackup() < 24) return;
    const id = setTimeout(() => runBackup(false), 30000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 画像をドライブに預けて、その URL を行に書く。
  // 行が空ならそこへ、文字があれば下に新しい行を作って入れる。
  async function putImage(file, node) {
    if (!hasDrive()) {
      setNote("画像の置き場が決まっていません（⚙ の「画像の置き場」で設定してください）");
      return;
    }
    setNote(`画像を置いています… ${file.name || ""}`);
    try {
      // どこに貼ったものかを、名前と説明に残す（あとで探せるように）
      const where = pathTo(nodes, node?.id)?.slice(0, -1).map((n) => truncateTitle(n.text, 20)).join(" / ");
      const hint = String(node?.text || "").trim() || where?.split(" / ").at(-1) || "";
      const got = await uploadToDrive(file, readDriveSetting(), { hint, where });
      if (node && !String(node.text || "").trim()) {
        patch(node.id, { text: got.url });
      } else {
        const made = makeNode(got.url);
        applyShown((list) => (node ? insertAfter(list, node.id, made) : [...list, made]));
      }
      setNote("画像を置きました");
    } catch (e) {
      setNote(`置けませんでした：${e?.message || e}`);
    }
  }

  // 画像の右下を掴んで、大きさを変える。
  // 離したときにだけ木へ書き戻す（動かしているあいだは絵だけ動かす）。
  function startResize(e, node) {
    e.preventDefault();
    e.stopPropagation();
    const box = e.currentTarget.closest("[data-row-image-box]");
    const img = box?.querySelector("img");
    if (!img) return;
    const startX = e.clientX;
    const startW = img.getBoundingClientRect().width;
    const limit = box.parentElement?.getBoundingClientRect().width || 1200;
    let last = startW;
    const move = (ev) => {
      last = Math.max(60, Math.min(limit, Math.round(startW + (ev.clientX - startX))));
      img.style.width = `${last}px`;
      img.style.maxHeight = "none";
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      patch(node.id, { imageWidth: Math.round(last) });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  // 貼り付け・落とし込みから画像を拾う
  const imageFrom = (dt) => [...(dt?.files || [])].find((f) => f.type.startsWith("image/"))
    || [...(dt?.items || [])].map((i) => (i.kind === "file" ? i.getAsFile() : null))
       .find((f) => f && f.type.startsWith("image/"));

  function addAtEnd() {
    const made = makeNode("");
    applyShown((list) => [...list, made]);
    edit(made.id, 0);
  }

  function moveFocus(id, dir) {
    const at = rows.findIndex((r) => r.node.id === id);
    const next = rows[at + dir];
    if (next) edit(next.node.id, dir > 0 ? 0 : -1);
  }

  function onKeyDown(e, node) {
    const el = e.currentTarget;
    const value = el.value;
    const selStart = el.selectionStart;
    const selEnd = el.selectionEnd;
    const collapsed = selStart === selEnd;
    const meta = e.ctrlKey || e.metaKey;
    if (e.nativeEvent.isComposing) return; // かな漢字変換の途中は触らない

    // タグの候補が出ているあいだは、そちらを先に操る
    const hint = tagHint?.id === node.id ? tagHint : null;
    if (hint) {
      if (e.key === "ArrowDown") { e.preventDefault(); setTagHint({ ...hint, sel: Math.min(hint.sel + 1, hint.items.length - 1) }); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setTagHint({ ...hint, sel: Math.max(hint.sel - 1, 0) }); return; }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) { e.preventDefault(); takeTag(node, el, hint.items[hint.sel]); return; }
      if (e.key === "Escape") { e.preventDefault(); setTagHint(null); return; }
    }

    // Ctrl/⌘+Enter で完了を切り替える
    if (meta && e.key === "Enter") {
      e.preventDefault();
      patch(node.id, { completed: !node.completed });
      return;
    }
    // Ctrl/⌘+. で畳む／開く
    if (meta && e.key === ".") {
      if (!node.children?.length) return;
      e.preventDefault();
      patch(node.id, { collapsed: !node.collapsed });
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const before = value.slice(0, selStart);
      const after = value.slice(selEnd);
      const made = makeNode(after);
      applyShown((list) => insertAfter(updateNode(list, node.id, { text: before }), node.id, made));
      edit(made.id, 0);
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      applyShown((list) => (e.shiftKey ? outdent(list, node.id) : indent(list, node.id)));
      edit(node.id, selStart);
      return;
    }
    // Alt+↑↓ で、兄弟のあいだを行ごと動かす
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      applyShown((list) => moveSibling(list, node.id, e.key === "ArrowUp" ? -1 : 1));
      edit(node.id, selStart);
      return;
    }
    // 探しているあいだは、見えていない行が隣にいる。くっつけると
    // 画面に無いものに文字が混ざるので、つなぎ合わせはやらない。
    if (frozen && (e.key === "Backspace" || e.key === "Delete")) {
      if (e.key === "Backspace" && collapsed && selStart === 0 && value.length === 0) {
        e.preventDefault();
        const got = deleteNodeSafe(shown, node.id);
        applyShown(() => got.nodes);
        if (got.focusId) edit(got.focusId, -1);
      }
      return;
    }
    if (e.key === "Backspace" && collapsed && selStart === 0) {
      // 空の行は消す。子がいれば、その場所に繰り上げる。
      if (value.length === 0) {
        e.preventDefault();
        const got = node.children?.length
          ? deleteNodeKeepChildren(shown, node.id)
          : deleteNodeSafe(shown, node.id);
        applyShown(() => got.nodes);
        if (got.focusId) edit(got.focusId, -1);
        return;
      }
      const got = mergeIntoPrevious(shown, node.id);
      if (!got.focusId) return;
      e.preventDefault();
      applyShown(() => got.nodes);
      edit(got.focusId, got.caret);
      return;
    }
    // 行末の Delete で、次の行を引き上げる
    if (e.key === "Delete" && collapsed && selStart === value.length) {
      const got = mergeNext(shown, node.id);
      if (got.caret == null) return;
      e.preventDefault();
      applyShown(() => got.nodes);
      edit(node.id, got.caret);
      return;
    }
    // Shift+↑↓：行の端から、まとめて選ぶほうへ移る
    if (e.shiftKey && !e.altKey && !meta && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      const up = e.key === "ArrowUp";
      const atEdge = up ? selStart === 0 : selEnd === value.length;
      if (!atEdge) return;
      const order = rows.map((r) => r.node.id);
      const at = order.indexOf(node.id);
      const to = order[at + (up ? -1 : 1)];
      if (!to) return;
      e.preventDefault();
      const from = anchorRef.current || node.id;
      anchorRef.current = from;
      setPicked(rangeBetween(listed, from, to));
      setEditingId(null);
      return;
    }
    if (e.key === "ArrowUp" && collapsed && selStart === 0) { e.preventDefault(); moveFocus(node.id, -1); return; }
    if (e.key === "ArrowDown" && collapsed && selEnd === value.length) { e.preventDefault(); moveFocus(node.id, 1); return; }
    if (e.key === "ArrowLeft" && collapsed && selStart === 0) { e.preventDefault(); moveFocus(node.id, -1); return; }
    if (e.key === "ArrowRight" && collapsed && selEnd === value.length) { e.preventDefault(); moveFocus(node.id, 1); return; }
    if (e.key === "Escape") { e.preventDefault(); setEditingId(null); }
  }

  // ズームの題。Enter でいちばん上の子を作り、↓ で中に降りる。
  function onTitleKeyDown(e) {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const made = makeNode("");
      setNodes((prev) => insertChild(prev, zoomNode.id, made));
      edit(made.id, 0);
      return;
    }
    if (e.key === "ArrowDown" && rows[0]) { e.preventDefault(); edit(rows[0].node.id, 0); }
  }

  function textareaRef(el, node) {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
    if (el.dataset.placed === node.id) return;
    el.dataset.placed = node.id;
    const caret = caretRef.current;
    const at = caret == null || caret < 0 ? el.value.length : Math.min(caret, el.value.length);
    el.setSelectionRange(at, at);
  }

  return (
    <div
      data-outliner
      inert={owner !== "active" ? true : undefined}
      data-calm={calm ? "" : undefined}
      className="mx-auto w-full max-w-3xl px-1 py-2"
    >
      <div
        data-outline-top
        className={classNames(
          "mb-2 flex items-center gap-1 transition-opacity duration-500",
          calm && "pointer-events-none opacity-0",
        )}
      >
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-neutral-600" />
          <input
            ref={searchRef}
            data-outline-search
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") { setQuery(""); e.currentTarget.blur(); } }}
            placeholder="探す（⌘K・#タグでも）"
            className="w-full rounded-md border border-white/10 bg-white/[0.03] py-1 pl-7 pr-7 text-[11px] ts-text outline-none placeholder:text-neutral-700 focus:border-white/25"
          />
          {query && (
            <button
              data-search-clear
              onClick={() => setQuery("")}
              title="やめる"
              className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-neutral-600 hover:text-neutral-200"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        <span
          data-outline-sync
          data-sync={syncState}
          role="status"
          aria-live="polite"
          title={syncState === "synced" ? "この端末の変更を送信し、手元にも保存しました" : "接続状態とは別に、この端末の保存・送信を表示します"}
          className={classNames(
            "shrink-0 text-[10px]",
            syncState === "synced" ? "text-emerald-300/80" : "text-neutral-500",
          )}
        >{syncLabel}</span>
        <button
          data-outline-link
          data-link={link}
          onClick={refresh}
          title={{
            live: "ほかの端末とつながっています（押すと読み直す）",
            waking: "つなぎ直しています（押すと読み直す）",
            closed: "切れています（押すとつなぎ直す）",
            error: "つながりません（押すとつなぎ直す）",
            off: "この端末だけで動いています",
          }[link]}
          className={classNames(
            "shrink-0 rounded-md border px-1.5 py-1 text-[10px] transition",
            link === "live" ? "border-emerald-400/30 text-emerald-300/80 hover:bg-emerald-400/10"
              : link === "off" ? "border-white/10 text-neutral-600 hover:bg-white/[0.07]"
                : "border-amber-400/40 text-amber-300/90 hover:bg-amber-400/10",
          )}
        >
          {link === "live" ? "●" : link === "waking" ? "◌" : link === "off" ? "○" : "▲"}
          {syncedAt && link === "live" && (
            <span className="ml-1 tabular-nums text-neutral-500">{syncedAt.slice(11, 16)}</span>
          )}
        </button>

        <button
          data-date-view
          onClick={() => setDateView((v) => !v)}
          title="日付の順に並べて見る（元の並びは変わりません）"
          className={classNames(
            "shrink-0 rounded-md border px-2 py-1 text-[11px] transition",
            dateView ? "border-sky-400/40 bg-sky-400/10 text-sky-200" : "border-white/10 text-neutral-500 hover:bg-white/[0.07] hover:text-neutral-200",
          )}
        >
          日付
        </button>

        <div className="relative shrink-0">
          <button
            data-outline-view
            onClick={() => setViewOpen((v) => !v)}
            title="見た目"
            className="rounded-md border border-white/10 p-1 text-neutral-500 transition hover:bg-white/[0.07] hover:text-neutral-200"
          >
            <Settings2 className="h-3 w-3" />
          </button>
          {viewOpen && narrow && (
            <div
              data-view-backdrop
              onClick={() => setViewOpen(false)}
              className="fixed inset-0 z-40"
            />
          )}
          {viewOpen && (
            <div
              data-view-panel
              className={classNames(
                "z-50 overflow-y-auto overscroll-contain rounded-lg border border-white/15 ts-surface p-2 shadow-2xl",
                narrow
                  ? "fixed inset-x-2 bottom-2 max-h-[72vh] w-auto"
                  : "absolute right-0 top-full mt-1 max-h-[80vh] w-52",
              )}
            >
              {narrow && (
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[10px] text-neutral-500">見た目と置き場</span>
                  <button
                    data-view-close
                    onClick={() => setViewOpen(false)}
                    className="rounded border border-white/10 px-2 py-1 text-[11px] text-neutral-300"
                  >
                    閉じる
                  </button>
                </div>
              )}
              <div className="mb-1 text-[10px] text-neutral-500">字の大きさ</div>
              <div className="mb-2 flex items-center gap-1">
                <button data-font-smaller onClick={() => setView({ fontSize: Math.max(11, view.fontSize - 1) })} className="flex-1 rounded border border-white/10 py-1 text-[11px] text-neutral-300 hover:bg-white/[0.07]">−</button>
                <span data-font-size className="w-10 text-center text-[11px] tabular-nums ts-text">{view.fontSize}px</span>
                <button data-font-larger onClick={() => setView({ fontSize: Math.min(24, view.fontSize + 1) })} className="flex-1 rounded border border-white/10 py-1 text-[11px] text-neutral-300 hover:bg-white/[0.07]">＋</button>
              </div>

              <div className="mb-1 text-[10px] text-neutral-500">行揃え</div>
              <div className="mb-2 flex gap-1">
                {[["left", "左"], ["center", "中央"], ["right", "右"], ["justify", "均等"]].map(([key, label]) => (
                  <button
                    key={key}
                    data-align={key}
                    onClick={() => setView({ align: key })}
                    className={classNames(
                      "flex-1 rounded border py-1 text-[10px] transition",
                      view.align === key ? "border-white/30 bg-white/15 ts-text" : "border-white/10 text-neutral-400 hover:bg-white/[0.07]",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="mb-2 border-t border-white/10 pt-2">
                <div className="mb-1 text-[10px] text-neutral-500">画像の置き場（Google ドライブ）</div>
                <input
                  data-drive-url
                  value={drive.url}
                  onChange={(e) => saveDrive({ url: e.target.value.trim() })}
                  placeholder="GAS の URL（…/exec）"
                  className="mb-1 w-full rounded border border-white/10 bg-black/25 px-2 py-1 text-[10px] ts-text outline-none placeholder:text-neutral-700"
                />
                <input
                  data-drive-token
                  type="password"
                  value={drive.token}
                  onChange={(e) => saveDrive({ token: e.target.value })}
                  placeholder="合言葉"
                  className="mb-1 w-full rounded border border-white/10 bg-black/25 px-2 py-1 text-[10px] ts-text outline-none placeholder:text-neutral-700"
                />
                <div className="mb-1 flex gap-1">
                  <button
                    data-drive-test
                    onClick={async () => {
                      setNote("つながるか試しています…");
                      try {
                        const got = await pingDrive({ url: drive.url, token: drive.token });
                        setNote(`つながりました（フォルダ：${got.folder || "?"}）`);
                      } catch (e) { setNote(`つながりません：${e?.message || e}`); }
                    }}
                    className="min-h-[34px] flex-1 rounded border border-white/10 px-2 py-1 text-[10px] text-neutral-400 hover:bg-white/[0.07]"
                  >
                    つながるか試す
                  </button>
                  <button
                    data-drive-backup
                    onClick={() => runBackup(true)}
                    className="min-h-[34px] flex-1 rounded border border-white/10 px-2 py-1 text-[10px] text-neutral-400 hover:bg-white/[0.07]"
                  >
                    いま控える
                  </button>
                </div>
                <div className="mb-2 text-[10px] leading-relaxed text-neutral-600">
                  画像はドライブに置き、行には URL だけを書きます。
                  中身まるごとの控えも、ここへ1日1回ぶん置きます
                  {lastBackupAt() ? `（前回：${lastBackupAt().slice(0, 16).replace("T", " ")}）` : "（まだ控えていません）"}。
                  置き方は docs/gas-image-upload.gs を見てください。
                </div>
              </div>

              <div className="mb-2 border-t border-white/10 pt-2">
                <div className="mb-1 text-[10px] text-neutral-500">日付</div>
                <button
                  data-fill-dates
                  onClick={() => {
                    const before = flattenTree(nodes).filter((r) => r.date).length;
                    setNodes((prev) => fillDates(prev));
                    const after = flattenTree(fillDates(nodes)).filter((r) => r.date).length;
                    setNote(after > before ? `${after - before}件に日付を入れました` : "入れるものはありませんでした");
                  }}
                  className="mb-1 w-full rounded border border-white/10 px-2 py-1.5 text-left text-[11px] text-neutral-400 transition hover:bg-white/[0.07]"
                >
                  見出しから日付を割り当てる
                </button>
                <div className="mb-2 text-[10px] leading-relaxed text-neutral-600">
                  「2026 ＞ 2026/01 ＞ 2026/01/02」のような並びを読んで、
                  その下の行に日付を持たせます。手で入れた日付は変えません。
                </div>
              </div>

              <div className="mb-2 border-t border-white/10 pt-2">
                <div className="mb-1 text-[10px] text-neutral-500">端末どうしを揃える</div>
                <button
                  data-outline-pull
                  onClick={async () => {
                    setNote("向こうを読んでいます…");
                    const got = await pullRemote();
                    setNote(got.ok ? `向こうに合わせました（${got.count} 行）` : `合わせられません：${got.why}`);
                  }}
                  className="mb-1 w-full rounded border border-white/10 px-2 py-1.5 text-left text-[11px] text-neutral-400 transition hover:bg-white/[0.07]"
                >
                  向こう（Supabase）に合わせる
                </button>
                <div className="mb-2 text-[10px] leading-relaxed text-neutral-600">
                  この端末の中身を、向こうの姿でそっくり入れ替えます。
                  端末ごとに違ってしまったときは、正しい1台で入れ直したあと、
                  ほかの端末でこれを押すと揃います（⌘Z で戻せます）。
                </div>

                <div className="mb-1 text-[10px] text-neutral-500">片付け（いまだけ）</div>
                <button
                  data-outline-clear
                  onClick={() => (confirmClear ? clearAll() : setConfirmClear(true))}
                  onBlur={() => setConfirmClear(false)}
                  className={classNames(
                    "mb-1 w-full rounded border px-2 py-1.5 text-left text-[11px] transition",
                    confirmClear
                      ? "border-red-400/50 bg-red-400/15 text-red-100"
                      : "border-white/10 text-neutral-400 hover:bg-white/[0.07]",
                  )}
                >
                  {confirmClear ? "もう一度押すと、ぜんぶ消す" : "アウトラインをぜんぶ消す"}
                </button>
                <div className="text-[10px] leading-relaxed text-neutral-600">
                  この端末からも Supabase からも消えます。⌘Z で戻せますが、
                  念のため先に ↓ で書き出しておくと安心です。
                </div>
              </div>

              <button
                data-immersive
                onClick={() => setView({ immersive: !view.immersive })}
                className={classNames(
                  "mb-1 flex w-full items-center justify-between rounded border px-2 py-1.5 text-[11px] transition",
                  view.immersive ? "border-sky-400/40 bg-sky-400/10 text-sky-200" : "border-white/10 text-neutral-400 hover:bg-white/[0.07]",
                )}
              >
                <span>書くことに集中</span>
                <span className="text-[10px]">{view.immersive ? "ON" : "OFF"}</span>
              </button>
              <div className="mb-2 text-[10px] leading-relaxed text-neutral-600">
                打っているあいだ、まわりの細かい表示を引っ込めます。
                指やマウスを動かすか、Esc で戻ります。
              </div>

              <button
                data-typewriter
                onClick={() => setView({ typewriter: !view.typewriter })}
                className={classNames(
                  "flex w-full items-center justify-between rounded border px-2 py-1.5 text-[11px] transition",
                  view.typewriter ? "border-sky-400/40 bg-sky-400/10 text-sky-200" : "border-white/10 text-neutral-400 hover:bg-white/[0.07]",
                )}
              >
                <span>タイプライター</span>
                <span className="text-[10px]">{view.typewriter ? "ON" : "OFF"}</span>
              </button>
              <div className="mt-1 text-[10px] leading-relaxed text-neutral-600">
                書いている行が、いつも同じ高さに来るように送ります。
              </div>
            </div>
          )}
        </div>

        <button
          data-outline-undo
          onClick={undo}
          disabled={!canUndo}
          title="元に戻す（⌘Z）"
          className="shrink-0 rounded-md border border-white/10 p-1 text-neutral-500 transition hover:bg-white/[0.07] hover:text-neutral-200 disabled:opacity-25"
        >
          <Undo2 className="h-3 w-3" />
        </button>
        <button
          data-outline-redo
          onClick={redo}
          disabled={!canRedo}
          title="やり直す（⌘⇧Z）"
          className="shrink-0 rounded-md border border-white/10 p-1 text-neutral-500 transition hover:bg-white/[0.07] hover:text-neutral-200 disabled:opacity-25"
        >
          <Redo2 className="h-3 w-3" />
        </button>
        <button
          data-outline-import
          onClick={() => fileRef.current?.click()}
          title="取り込む（Quietliner の .json / WorkFlowy の .md・.html / Notion の .zip）。2回読んでも増えません"
          className="shrink-0 rounded-md border border-white/10 p-1 text-neutral-500 transition hover:bg-white/[0.07] hover:text-neutral-200"
        >
          <Upload className="h-3 w-3" />
        </button>
        <button
          data-outline-export
          onClick={exportJson}
          title="JSON に書き出す"
          className="shrink-0 rounded-md border border-white/10 p-1 text-neutral-500 transition hover:bg-white/[0.07] hover:text-neutral-200"
        >
          <Download className="h-3 w-3" />
        </button>
        <input
          ref={fileRef}
          data-outline-file
          type="file"
          accept=".json,.md,.markdown,.txt,.html,.htm,.zip,application/json,text/markdown,text/html,application/zip"
          className="hidden"
          onChange={(e) => { importFile(e.target.files?.[0]); e.target.value = ""; }}
        />
      </div>

      {localSave.status === "saving" && localSave.large && !localSave.hidden && (
        <div data-outline-local-saving role="status" className="mb-2 rounded border border-white/10 bg-white/[0.03] p-2 text-[10px] leading-relaxed text-neutral-400">
          この端末に保存しています…
        </div>
      )}

      {localSave.status === "saved" && localSave.large && !localSave.hidden && (
        <div data-outline-toobig role="status" className="mb-2 flex items-start justify-between gap-2 rounded border border-white/10 bg-white/[0.03] p-2 text-[10px] leading-relaxed text-neutral-400">
          <div>中身が大きいので、この端末の大きな置き場に保存しました。</div>
          <button onClick={dismissLocalInfo} className="shrink-0 rounded border border-white/10 px-2 py-1 text-[10px] text-neutral-400 hover:bg-white/[0.07]">
            閉じる
          </button>
        </div>
      )}

      {localSave.status === "read-error" && (
        <div data-outline-local-read-error role="alert" className="mb-2 rounded border border-red-400/30 bg-red-400/[0.08] p-2 text-[10px] leading-relaxed text-red-100">
          <div className="mb-1 font-semibold">保存済みの内容を安全に確認できませんでした</div>
          <div className="mb-2 text-red-100/80">
            元の内容を守るため、保存と同期を止めています。画面で書いた内容はJSONに書き出してから、この画面を開き直してください。
          </div>
          <button data-outline-local-export onClick={exportJson} className="rounded border border-red-300/30 px-2 py-1 text-[10px] text-red-100 transition hover:bg-red-400/15">
            JSONに書き出す
          </button>
        </div>
      )}

      {localSave.status === "error" && (
        <div data-outline-local-error role="alert" className="mb-2 rounded border border-red-400/30 bg-red-400/[0.08] p-2 text-[10px] leading-relaxed text-red-100">
          <div className="mb-1 font-semibold">この端末に保存できていません</div>
          <div className="mb-2 text-red-100/80">
            画面には残っています。もう一度保存するか、JSONに書き出してください。保存は自動でも再試行します。
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button data-outline-local-retry onClick={retryLocalSave} disabled={localSave.busy} className="rounded border border-red-300/30 px-2 py-1 text-[10px] text-red-100 transition hover:bg-red-400/15 disabled:opacity-50">
              {localSave.busy ? "保存中…" : "もう一度保存"}
            </button>
            <button data-outline-local-export onClick={exportJson} className="rounded border border-red-300/30 px-2 py-1 text-[10px] text-red-100 transition hover:bg-red-400/15">
              JSONに書き出す
            </button>
          </div>
        </div>
      )}

      {syncNote.startsWith("error:") && (
        <div data-outline-sync-error className="mb-2 rounded border border-red-400/30 bg-red-400/[0.08] p-2 text-[10px] leading-relaxed text-red-100">
          <div className="mb-1 font-semibold">ほかの端末へ送れていません</div>
          <div className="mb-1 text-red-100/80">Supabase に送れませんでした：{syncNote.slice(6)}</div>
          <div className="mb-1 text-red-100/70">
            新しい表に RLS（行レベルセキュリティ）がかかっていると、書き込みが断られます。
            タスクの表と同じ扱いにするなら、SQL Editor で次を実行してください。
          </div>
          <pre className="mb-1 overflow-auto whitespace-pre-wrap break-all rounded bg-black/30 p-2 text-[10px] text-red-50/90">
alter table outline_nodes disable row level security;
          </pre>
          <button onClick={dismissSync} className="rounded border border-red-300/30 px-2 py-1 text-[10px] text-red-100 transition hover:bg-red-400/15">
            閉じる
          </button>
        </div>
      )}

      {syncNote.startsWith("conflict:") && (
        <div data-outline-sync-conflict role="alert" className="mb-2 rounded border border-amber-400/30 bg-amber-400/[0.08] p-2 text-[10px] leading-relaxed text-amber-100">
          <div className="mb-1 font-semibold">別の端末に新しい変更があります</div>
          <div className="mb-2 text-amber-100/80">
            この端末の未送信内容は端末内に残し、上書きを止めました。JSONへ控えてから「向こうに合わせる」で最新版を取り込めます。
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button data-outline-conflict-export onClick={exportJson} className="rounded border border-amber-300/30 px-2 py-1 text-[10px] text-amber-100 transition hover:bg-amber-400/15">
              JSONに書き出す
            </button>
            <button onClick={dismissSync} className="rounded border border-amber-300/30 px-2 py-1 text-[10px] text-amber-100 transition hover:bg-amber-400/15">
              閉じる
            </button>
          </div>
        </div>
      )}

      {syncNote.startsWith("missing-col:") && (
        <div data-outline-missing-col className="mb-2 rounded border border-amber-400/30 bg-amber-400/[0.08] p-2 text-[10px] leading-relaxed text-amber-100">
          <div className="mb-1 font-semibold">置き場に足りない列があります</div>
          <div className="mb-1 text-amber-100/80">
            {syncNote.slice("missing-col:".length).replace(/,/g, "・")} が無いので、そのぶんだけ
            ほかの端末に伝わりません（文字と並びは伝わります）。SQL Editor で足してください。
          </div>
          <pre className="mb-1 overflow-auto whitespace-pre-wrap break-all rounded bg-black/30 p-2 text-[10px] text-amber-50/90">
{outlineColumnsSql(syncNote.slice("missing-col:".length).split(","))}
          </pre>
          <div className="flex gap-1.5">
            <button
              data-outline-copy-col-sql
              onClick={async () => {
                const sql = outlineColumnsSql(syncNote.slice("missing-col:".length).split(","));
                try { await navigator.clipboard.writeText(sql); setNote("SQL をコピーしました"); }
                catch { setNote("コピーできませんでした。手で選んでください"); }
              }}
              className="rounded border border-amber-300/30 px-2 py-1 text-[10px] text-amber-100 transition hover:bg-amber-400/15"
            >
              SQL をコピー
            </button>
            <button onClick={dismissSync} className="rounded border border-amber-300/30 px-2 py-1 text-[10px] text-amber-100 transition hover:bg-amber-400/15">
              閉じる
            </button>
          </div>
        </div>
      )}

      {syncNote === "missing-table" && (
        <div data-outline-sql className="mb-2 rounded border border-amber-400/30 bg-amber-400/[0.08] p-2 text-[10px] leading-relaxed text-amber-100">
          <div className="mb-1 font-semibold">この端末にしか残りません</div>
          <div className="mb-1 text-amber-100/80">
            Supabase にアウトラインの置き場が無いので、ほかの端末には伝わりません。
            SQL Editor に貼って実行すると、以後は同期します。
          </div>
          <pre className="mb-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-black/30 p-2 text-[10px] text-amber-50/90">
{outlineTableSql()}
          </pre>
          <div className="flex gap-1.5">
            <button
              onClick={async () => {
                try { await navigator.clipboard.writeText(outlineTableSql()); setNote("SQL をコピーしました"); }
                catch { setNote("コピーできませんでした。手で選んでください"); }
              }}
              className="rounded border border-amber-300/30 px-2 py-1 text-[10px] text-amber-100 transition hover:bg-amber-400/15"
            >
              SQL をコピー
            </button>
            <button onClick={dismissSync} className="rounded border border-amber-300/30 px-2 py-1 text-[10px] text-amber-100 transition hover:bg-amber-400/15">
              閉じる
            </button>
          </div>
        </div>
      )}

      {note && (
        <div data-outline-note className="mb-2 flex items-center justify-between gap-2 rounded border border-white/10 bg-white/[0.03] px-2 py-1 text-[10px] text-neutral-400">
          <span>{note}</span>
          <button onClick={() => setNote("")} className="rounded px-1 text-neutral-600 hover:text-neutral-200">閉じる</button>
        </div>
      )}

      {searching && (
        <div data-search-count className="mb-1 px-1 text-[10px] text-neutral-500">
          {rows.length ? `${rows.length}件` : "見つかりませんでした"}
        </div>
      )}

      {favorites.length > 0 && (
        <div
          data-favorites
          className={classNames(
            "mb-2 flex flex-wrap items-center gap-1 transition-opacity duration-500",
            calm && "pointer-events-none opacity-0",
          )}
        >
          <Star className="h-3 w-3 shrink-0 fill-amber-300/70 text-amber-300/70" />
          {favorites.map((fav) => (
            <button
              key={fav.id}
              data-favorite={fav.id}
              onClick={() => { setZoomId(fav.id); setEditingId(null); clearPick(); }}
              title={fav.text}
              className="max-w-[12rem] truncate rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[10px] text-neutral-400 transition hover:bg-white/[0.08] hover:text-neutral-200"
            >
              {truncateTitle(fav.text, 14)}
            </button>
          ))}
        </div>
      )}

      <div
        data-outline-crumbs
        className={classNames(
          "mb-2 flex flex-wrap items-center gap-1 text-[11px] text-neutral-500 transition-opacity duration-500",
          calm && "pointer-events-none opacity-0",
        )}
      >
        <button
          data-crumb
          onClick={() => setZoomId(null)}
          className={classNames("rounded px-1.5 py-0.5 transition hover:bg-white/[0.07]", !zoomId && "ts-text")}
        >
          ホーム
        </button>
        {(zoomPath || []).map((node, i) => (
          <React.Fragment key={node.id}>
            <span className="opacity-40">/</span>
            <button
              data-crumb
              title={node.text}
              onClick={() => setZoomId(node.id)}
              className={classNames(
                "rounded px-1.5 py-0.5 transition hover:bg-white/[0.07]",
                i === zoomPath.length - 1 && "ts-text",
              )}
            >
              {truncateTitle(node.text)}
            </button>
          </React.Fragment>
        ))}
      </div>

      {zoomNode && (
        <textarea
          key={zoomNode.id}
          data-zoom-title
          rows={1}
          value={zoomNode.text}
          onChange={(e) => typeText(zoomNode.id, e.target.value)}
          onKeyDown={onTitleKeyDown}
          placeholder="無題"
          className="mb-2 w-full resize-none bg-transparent px-1 text-xl font-semibold ts-text outline-none placeholder:text-neutral-700"
        />
      )}

      {band && (
        <div
          data-select-band
          className="pointer-events-none fixed z-[60] rounded border border-sky-400/60 bg-sky-400/10"
          style={{ left: band.left, top: band.top, width: band.width, height: band.height }}
        />
      )}

      <div
        ref={listRef}
        data-outline-list
        onPointerDown={(e) => {
          // 行の中身（文字・つまみ・ボタン）の上は、それぞれの操作にまかせる
          if (e.target.closest("[data-row-text], button, textarea, [data-tag-hint]")) return;
          clearPick();
          startBand(e);
        }}
        onDragOver={(e) => { if (imageFrom(e.dataTransfer)) e.preventDefault(); }}
        onDrop={(e) => {
          const file = imageFrom(e.dataTransfer);
          if (!file) return;
          e.preventDefault();
          const row = e.target.closest("[data-row]")?.getAttribute("data-row");
          putImage(file, row ? pathTo(listed, row)?.at(-1) : null);
        }}
        style={{
          fontSize: `${view.fontSize}px`,
          textAlign: view.align,
          // 上の行も下の行も決まった高さに来られるよう、前後に余白を置く
          // （これが無いと、最初の数行は押し下げられない）
          paddingTop: view.typewriter ? "45vh" : undefined,
          paddingBottom: view.typewriter ? "45vh" : undefined,
        }}
        className="relative flex flex-col"
      >
        {drag && (
          <div
            data-drop-line
            className="pointer-events-none absolute right-0 z-20 h-[2px] rounded bg-sky-400"
            style={{ top: drag.top - 1, left: drag.depth * INDENT + 24 }}
          />
        )}
        {nodes.length === 0 && (
          <button
            type="button"
            data-outline-empty
            onClick={() => {
              // 空の行を勝手に同期せず、書き始めたときにだけ作る。
              const made = makeNode("");
              setNodes((prev) => [...prev, made]);
              setQuery("");
              setDateView(false);
              setZoomId(null);
              edit(made.id, 0);
            }}
            className="w-full rounded px-6 py-2 text-left text-sm text-neutral-500 hover:bg-white/[0.03]"
          >
            書き始める
          </button>
        )}
        {rows.map(({ node, depth }) => {
          const hasKids = !!node.children?.length;
          const chars = countChars(node);
          const heading = HEADING[node.headingLevel] || null;
          const textStyle = {
            ...(heading || {}),
            ...(node.textColor ? { color: node.textColor } : {}),
          };
          return (
            <div
              key={node.id}
              data-row={node.id}
              data-depth={depth}
              data-completed={node.completed ? "true" : "false"}
              data-dragging={drag?.id === node.id ? "true" : undefined}
              data-picked={pickedSet.has(node.id) ? "true" : undefined}
              data-heading={node.headingLevel || ""}
              style={{
                paddingLeft: depth * INDENT + 4,
                background: node.bgColor || undefined,
                // 親のところに縦線を引く（WorkFlowy と同じ見え方）
                ...(depth > 0 && !calm ? {
                  backgroundImage: `repeating-linear-gradient(to right, var(--ts-guide) 0 1px, transparent 1px ${INDENT}px)`,
                  backgroundPosition: "11px 0",
                  backgroundSize: `${depth * INDENT}px 100%`,
                  backgroundRepeat: "no-repeat",
                } : {}),
              }}
              className={classNames(
                "group/row relative flex items-start gap-1 rounded py-[3px] pr-1 transition-opacity duration-500 hover:bg-white/[0.03]",
                drag?.id === node.id && "opacity-40",
                pickedSet.has(node.id) && "bg-sky-400/15 ring-1 ring-sky-400/30",
                // 書くことに集中：いま打っている行のまわりだけ残す
                calm && editingId !== node.id && "opacity-25",
              )}
            >
              <button
                data-fold={node.id}
                onClick={() => {
                  if (node.virtual) { flipDate(node.id); return; }
                  setNodes((prev) => toggleCollapse(prev, node.id));
                }}
                title={hasKids ? (node.collapsed ? "展開" : "折りたたむ") : ""}
                disabled={!hasKids}
                className={classNames(
                  "mt-[5px] shrink-0 rounded p-px text-neutral-500 transition hover:text-neutral-200",
                  !hasKids && "invisible",
                  calm && "opacity-0",
                  // 畳むつまみは、薄くても出しておく。ホバーで出すだけだと
                  // 触る機械では一生見えず、閉じられないままになる。
                  hasKids && !node.collapsed && "opacity-30 group-hover/row:opacity-100 focus:opacity-100",
                )}
              >
                {node.collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>

              <button
                data-zoom={node.id}
                onPointerDown={(e) => { if (!node.virtual) startDrag(e, node); }}
                onClick={() => {
                  if (skipZoomRef.current || node.virtual) return;
                  setZoomId(node.id);
                  setEditingId(null);
                }}
                title="クリックでズーム／ドラッグで移動"
                className={classNames(
                  "mt-[8px] grid h-[7px] w-[7px] shrink-0 place-items-center rounded-full transition",
                  node.collapsed ? "bg-white/70 ring-[5px] ring-white/15" : "bg-white/55 hover:ring-[5px] hover:ring-white/15",
                  calm && "opacity-0",
                  hasStoredBody(node) && !node.collapsed && "ring-[3px] ring-white/10",
                )}
              >
                <span className="sr-only">ズーム</span>
              </button>

              {editingId === node.id && !node.virtual ? (
                <textarea
                  autoFocus
                  data-outline-input
                  data-row-text
                  ref={(el) => textareaRef(el, node)}
                  rows={1}
                  value={node.text}
                  style={textStyle}
                  onChange={(e) => {
                    hush();
                    typeText(node.id, e.target.value);
                    refreshTagHint(node.id, e.target);
                    e.target.style.height = "auto";
                    e.target.style.height = `${e.target.scrollHeight}px`;
                  }}
                  onKeyDown={(e) => onKeyDown(e, node)}
                  onPaste={(e) => {
                    const file = imageFrom(e.clipboardData);
                    if (!file) return;           // 文字の貼り付けは、これまで通り
                    e.preventDefault();
                    putImage(file, node);
                  }}
                  onDrop={(e) => {
                    const file = imageFrom(e.dataTransfer);
                    if (!file) return;
                    e.preventDefault();
                    putImage(file, node);
                  }}
                  onBlur={() => { setEditingId((cur) => (cur === node.id ? null : cur)); setTagHint(null); }}
                  className={classNames(
                    "min-w-0 flex-1 resize-none bg-transparent px-1 py-0 text-[1em] leading-relaxed ts-text outline-none",
                    node.completed && "line-through opacity-50",
                  )}
                />
              ) : (
                <div
                  data-row-text
                  onPointerDown={(e) => { if (!e.shiftKey && !e.metaKey && !e.ctrlKey) startBand(e, node.id); }}
                  onClick={(e) => {
                    // 日付の見出しは、押したら開く／閉じる
                    if (node.virtual) { flipDate(node.id); return; }
                    // Shift / ⌘ クリックはまとめて選ぶ（Quietliner と同じ）
                    if (e.shiftKey) { e.preventDefault(); pickTo(node.id); return; }
                    if (e.metaKey || e.ctrlKey) { e.preventDefault(); togglePick(node.id); return; }
                    clearPick();
                    // 画像の行は、押しても絵のまま。URL を直すのは ⋯ から。
                    if (imageUrlOf(node.text)) { anchorRef.current = node.id; return; }
                    edit(node.id, -1);
                  }}
                  style={textStyle}
                  className={classNames(
                    "min-w-0 flex-1 cursor-text whitespace-pre-wrap break-words px-1 py-0 text-[1em] leading-relaxed",
                    node.text ? "ts-text" : "text-neutral-600",
                    node.completed && "line-through opacity-50",
                  )}
                >
                  {(() => {
                    const img = imageUrlOf(node.text);
                    if (!img) return node.text ? <Marked text={node.text} query={query} /> : "空の行";
                    // 画像の行。押せば、これまで通り文字（URL）を直せる。
                    return (
                      <span data-row-image-box className="relative inline-block max-w-full align-top">
                        <img
                          data-row-image
                          src={img}
                          alt=""
                          loading="lazy"
                          draggable={false}
                          referrerPolicy="no-referrer"
                          style={node.imageWidth ? { width: `${node.imageWidth}px` } : undefined}
                          className={classNames(
                            "max-w-full rounded border border-white/10",
                            !node.imageWidth && "max-h-80",
                          )}
                        />
                        <span
                          data-image-resize={node.id}
                          onPointerDown={(e) => startResize(e, node)}
                          title="ドラッグで大きさを変える（ダブルクリックでもとに戻す）"
                          onDoubleClick={(e) => { e.stopPropagation(); patch(node.id, { imageWidth: null }); }}
                          className="absolute bottom-1 right-1 h-3.5 w-3.5 cursor-nwse-resize rounded-sm border border-white/40 bg-black/50 opacity-0 transition hover:opacity-100 group-hover/row:opacity-70"
                        />
                      </span>
                    );
                  })()}
                </div>
              )}

              {tagHint?.id === node.id && (
                <div
                  data-tag-hint
                  className="absolute left-10 top-full z-40 mt-0.5 w-44 overflow-hidden rounded-lg border border-white/15 ts-surface py-1 shadow-2xl"
                >
                  {tagHint.items.map((tag, i) => (
                    <button
                      key={tag}
                      data-tag-option={tag}
                      onMouseDown={(e) => { e.preventDefault(); takeTag(node, document.querySelector(`[data-row="${node.id}"] textarea`), tag); }}
                      className={classNames(
                        "block w-full px-2 py-1 text-left text-[11px] transition",
                        i === tagHint.sel ? "bg-white/15 ts-text" : "text-neutral-400 hover:bg-white/[0.07]",
                      )}
                    >
                      #{tag}
                    </button>
                  ))}
                </div>
              )}

              <div
                data-row-actions
                className={classNames(
                  "flex shrink-0 items-center gap-0.5 self-start pt-0.5 transition-opacity duration-500",
                  calm && "pointer-events-none opacity-0",
                )}
              >
                {node.date && !node.virtual && (
                  <span
                    data-row-date={node.date}
                    title={`${node.date} のこと`}
                    className="shrink-0 rounded border border-white/10 px-1 py-px text-[9px] tabular-nums text-neutral-500"
                  >
                    {node.date.slice(5).replace("-", "/")}
                  </span>
                )}
                {node.favorite && <Star className="h-3 w-3 shrink-0 fill-amber-300 text-amber-300" />}
                <span
                  data-chars
                  title="この中にある文字の数"
                  className="min-w-[1.5rem] text-right text-[10px] tabular-nums text-neutral-700 opacity-0 transition group-hover/row:opacity-100"
                >
                  {chars > 0 ? chars : ""}
                </span>
                {!node.virtual && <button
                  data-row-menu={node.id}
                  onClick={() => setMenuId((v) => (v === node.id ? null : node.id))}
                  title="この行の設定"
                  className="rounded p-0.5 text-neutral-600 opacity-0 transition hover:bg-white/10 hover:text-neutral-200 group-hover/row:opacity-100"
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </button>}
              </div>

              {menuId === node.id && (
                <div
                  ref={menuRef}
                  data-row-menu-panel
                  className="absolute right-0 top-full z-50 mt-1 w-52 rounded-lg border border-white/15 ts-surface p-1 shadow-2xl"
                >
                  <button onClick={() => { setMenuId(null); setZoomId(node.id); }} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] text-neutral-300 hover:bg-white/[0.07]">⊙ ズームイン</button>
                  <button onClick={() => { setMenuId(null); patch(node.id, { completed: !node.completed }); }} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] text-neutral-300 hover:bg-white/[0.07]">
                    <Check className="h-3 w-3" /> {node.completed ? "完了を解除" : "完了にする"}
                  </button>
                  <button onClick={() => { setMenuId(null); patch(node.id, { favorite: !node.favorite }); }} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] text-neutral-300 hover:bg-white/[0.07]">
                    <Star className="h-3 w-3" /> {node.favorite ? "お気に入り解除" : "お気に入り"}
                  </button>
                  {imageUrlOf(node.text) && (
                    <button
                      data-row-edit-url
                      onClick={() => { setMenuId(null); edit(node.id, -1); }}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] text-neutral-300 hover:bg-white/[0.07]"
                    >
                      ✎ 画像の URL を直す
                    </button>
                  )}
                  {hasKids && (
                    <button onClick={() => { setMenuId(null); setNodes((prev) => toggleCollapse(prev, node.id)); }} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] text-neutral-300 hover:bg-white/[0.07]">
                      {node.collapsed ? "▶ 展開" : "▼ 折りたたむ"}
                    </button>
                  )}

                  <div className="my-1 border-t border-white/10" />
                  <div className="px-2 py-0.5 text-[10px] text-neutral-600">日付</div>
                  <div className="flex items-center gap-1 px-1.5 pb-1">
                    <input
                      type="date"
                      data-row-date-input
                      value={node.date || ""}
                      onChange={(e) => patch(node.id, { date: e.target.value || null })}
                      className="min-w-0 flex-1 rounded border border-white/10 bg-black/25 px-1 py-1 text-[10px] ts-text outline-none"
                    />
                    <button
                      data-row-date-today
                      onClick={() => patch(node.id, { date: new Date().toISOString().slice(0, 10) })}
                      title="今日にする"
                      className="rounded border border-white/10 px-1.5 py-1 text-[10px] text-neutral-400 hover:bg-white/[0.07]"
                    >
                      今日
                    </button>
                    <button
                      data-row-date-clear
                      onClick={() => patch(node.id, { date: null })}
                      title="日付を外す"
                      className="rounded border border-white/10 px-1.5 py-1 text-[10px] text-neutral-400 hover:bg-white/[0.07]"
                    >
                      ✕
                    </button>
                  </div>

                  <div className="my-1 border-t border-white/10" />
                  <div className="px-2 py-0.5 text-[10px] text-neutral-600">見出し</div>
                  <div className="flex gap-1 px-1.5 pb-1">
                    {[null, 1, 2, 3].map((level) => (
                      <button
                        key={level ?? "body"}
                        data-heading-chip={level ?? "body"}
                        onClick={() => patch(node.id, { headingLevel: level })}
                        className={classNames(
                          "flex-1 rounded border px-1 py-1 text-[10px] transition",
                          (node.headingLevel || null) === level
                            ? "border-white/30 bg-white/15 ts-text"
                            : "border-white/10 text-neutral-400 hover:bg-white/[0.07]",
                        )}
                      >
                        {level === null ? "本文" : `H${level}`}
                      </button>
                    ))}
                  </div>

                  <div className="px-2 py-0.5 text-[10px] text-neutral-600">文字色</div>
                  <div className="flex flex-wrap gap-1 px-1.5 pb-1">
                    {TEXT_COLORS.map(({ label, value }) => (
                      <button
                        key={label}
                        title={label}
                        data-text-color={value || "none"}
                        onClick={() => patch(node.id, { textColor: value })}
                        style={value ? { background: value } : undefined}
                        className={classNames(
                          "h-5 w-5 rounded border text-[9px] text-neutral-400",
                          (node.textColor || null) === value ? "border-white/60" : "border-white/15",
                        )}
                      >
                        {!value && "✕"}
                      </button>
                    ))}
                  </div>

                  <div className="px-2 py-0.5 text-[10px] text-neutral-600">背景色</div>
                  <div className="flex flex-wrap gap-1 px-1.5 pb-1">
                    {BG_COLORS.map(({ label, value }) => (
                      <button
                        key={label}
                        title={label}
                        data-bg-color={value || "none"}
                        onClick={() => patch(node.id, { bgColor: value })}
                        style={value ? { background: value } : undefined}
                        className={classNames(
                          "h-5 w-5 rounded border text-[9px] text-neutral-400",
                          (node.bgColor || null) === value ? "border-white/60" : "border-white/15",
                        )}
                      >
                        {!value && "✕"}
                      </button>
                    ))}
                  </div>

                  <div className="my-1 border-t border-white/10" />
                  <button
                    data-row-delete
                    onClick={() => {
                      setMenuId(null);
                      const got = deleteNodeSafe(shown, node.id);
                      applyShown(() => got.nodes);
                    }}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] text-red-300/80 hover:bg-red-400/10"
                  >
                    <Trash2 className="h-3 w-3" /> 削除
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {picked.length > 0 && (
        <div
          data-pick-bar
          className="sticky bottom-2 z-30 mt-2 flex flex-wrap items-center gap-1 rounded-xl border border-white/15 ts-surface px-2 py-1.5 shadow-2xl"
        >
          <span className="rounded-full border border-sky-400/30 bg-sky-500/15 px-2 py-0.5 text-[10px] text-sky-100">
            {picked.length}件
          </span>
          <button data-pick-outdent onClick={() => bulkIndent(true)} title="字下げを戻す（Shift+Tab）" className="rounded px-2 py-1 text-[11px] text-neutral-300 transition hover:bg-white/[0.07]">←</button>
          <button data-pick-indent onClick={() => bulkIndent(false)} title="字下げ（Tab）" className="rounded px-2 py-1 text-[11px] text-neutral-300 transition hover:bg-white/[0.07]">→</button>
          <button data-pick-complete onClick={bulkComplete} title="完了（⌘Enter）" className="rounded px-2 py-1 text-[11px] text-neutral-300 transition hover:bg-white/[0.07]">完了</button>
          <button data-pick-copy onClick={bulkCopy} title="コピー（⌘C）" className="rounded px-2 py-1 text-[11px] text-neutral-300 transition hover:bg-white/[0.07]">コピー</button>
          <button data-pick-delete onClick={bulkDelete} title="削除" className="rounded px-2 py-1 text-[11px] text-red-300/80 transition hover:bg-red-400/10">削除</button>
          <button data-pick-clear onClick={clearPick} title="選ぶのをやめる（Esc）" className="ml-auto rounded px-2 py-1 text-[11px] text-neutral-500 transition hover:bg-white/[0.07]">✕</button>
        </div>
      )}

      <button
        data-outline-add
        onClick={addAtEnd}
        className="mt-1 w-full rounded px-2 py-2 text-left text-[12px] text-neutral-600 transition hover:bg-white/[0.03] hover:text-neutral-400"
      >
        クリックして書き足す
      </button>
    </div>
  );
}
