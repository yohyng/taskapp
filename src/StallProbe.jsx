import { useRef, useState } from "react";
import { createStallProbe } from "./lib/stall-probe";

// 本番と同じ画面のまま、止まった瞬間だけを記録する小窓。
// 検証用のビルドで ?probe=1 を付けたときだけ出る。通常の配信物には入らない。
export default function StallProbe() {
  const probeRef = useRef(null);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState(null);
  const [note, setNote] = useState("");
  const probe = () => (probeRef.current ||= createStallProbe());

  return <div data-stall-probe className="fixed bottom-2 right-2 z-[999] w-64 rounded-lg border border-amber-400/40 bg-neutral-900/95 p-2 text-[11px] text-neutral-200 shadow-2xl">
    <div className="mb-1 flex items-center gap-2">
      <span className="mr-auto font-semibold">止まりの計測</span>
      <button type="button" data-probe-toggle
        onClick={() => {
          if (running) { probe().stop(); setReport(probe().report()); setRunning(false); }
          else { probe().start(); setReport(null); setNote(""); setRunning(true); }
        }}
        className={`rounded border px-2 py-1 ${running ? "border-red-400/50 bg-red-400/15 text-red-100" : "border-emerald-400/40 bg-emerald-400/10 text-emerald-200"}`}>
        {running ? "とめる" : "はじめる"}
      </button>
    </div>
    {report ? <div data-probe-report className="max-h-56 overflow-y-auto">
      <div className="tabular-nums">{report.seconds}秒／50ms超のフレーム {report.frameGap.over50} 回（最大 {report.frameGap.max}ms）</div>
      <div className="mb-1 tabular-nums text-neutral-400">長いフレーム {report.longFrames.count} 回／longtask {report.longtask.count} 回</div>
      {report.blame.length ? <ol className="space-y-0.5">
        {report.blame.slice(0, 6).map((item) => <li key={item.name} className="break-all text-[10px] text-neutral-300">
          <span className="tabular-nums text-amber-200">{item.total}ms</span>（{item.count}回・最大{item.max}ms） {item.name}
        </li>)}
      </ol> : <div className="text-[10px] text-neutral-500">止まりは記録されませんでした</div>}
    </div> : <div className="text-[10px] text-neutral-500">「はじめる」を押して、いつもどおり書いてください。</div>}
    <div className="mt-1 flex gap-1">
      <button type="button" data-probe-copy disabled={!report}
        onClick={async () => {
          try { await navigator.clipboard.writeText(JSON.stringify(report, null, 2)); setNote("写しました"); }
          catch { setNote("写せませんでした"); }
        }}
        className="flex-1 rounded border border-white/15 px-2 py-1 disabled:opacity-30">結果を写す</button>
      {note && <span className="self-center text-[10px] text-neutral-400">{note}</span>}
    </div>
  </div>;
}
