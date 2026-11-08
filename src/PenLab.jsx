import { useState } from "react";
import { createRoot } from "react-dom/client";
import SketchPad from "./SketchPad";
import { readSketchDraft, sketchFile } from "./lib/sketch";
import "./index.css";

const KEY = "fragments-pen-lab-draft";
export default function PenLab() {
  const [strokes, setStrokes] = useState([]);
  const [message, setMessage] = useState("");
  async function save() {
    const file = await sketchFile(strokes);
    const url = URL.createObjectURL(file), link = document.createElement("a");
    link.href = url; link.download = "書き味の比較.png"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  return <main className="mx-auto max-w-2xl p-4 ts-text">
    <h1 className="mb-2 text-lg font-semibold">fragments 書き味の比較</h1>
    <p className="mb-4 text-sm text-neutral-300">ペンを切り替えて、同じ文字や丸を書き比べてみてください。このページは同期せず、本番のメモには追加しません。</p>
    <SketchPad experimental strokes={strokes} onChange={setStrokes} />
    <div className="mt-4 flex flex-wrap gap-2 text-sm">
      <button data-pen-lab-save onClick={() => { try { localStorage.setItem(KEY, JSON.stringify(strokes)); setMessage("この端末に下書きを保存しました"); } catch { setMessage("下書きを保存できませんでした"); } }} className="rounded border border-white/20 px-3 py-2">下書きを残す</button>
      <button data-pen-lab-restore onClick={() => { try { setStrokes(readSketchDraft(KEY)); setMessage("下書きを戻しました"); } catch { setMessage("下書きを読み込めませんでした"); } }} className="rounded border border-white/20 px-3 py-2">下書きを戻す</button>
      <button data-pen-lab-export disabled={!strokes.length} onClick={() => save().catch(() => setMessage("画像を保存できませんでした"))} className="rounded border border-white/20 px-3 py-2 disabled:opacity-30">画像を保存</button>
    </div>
    <p role="status" className="mt-2 text-xs text-neutral-300">{message}</p>
  </main>;
}
createRoot(document.getElementById("root")).render(<PenLab />);
