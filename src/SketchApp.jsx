import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import SketchBoard from "./SketchBoard";
import { readSketchDraft, sketchFile, SKETCH_DRAFT_KEY } from "./lib/sketch";
import { hasDrive, uploadToDrive } from "./lib/drive";
import { queueMemo } from "./lib/memo-queue";
import "./index.css";

// 手書きだけのページ。
// アプリ本体（タスク・アウトライン・同期）はここに載せない。
// 実機の計測で、書いている最中に画面を止めていたのは手書きではなく、
// 同じタブで動いていたアウトラインの読み直しと書き戻しだった。
// 載せなければ、そもそも止まりようがない。

const BACK = "/";

export default function SketchApp() {
  const [strokes, setStrokes] = useState(readSketchDraft);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const uploadRef = useRef(null);
  useEffect(() => () => { uploadRef.current?.abort(); uploadRef.current = null; }, []);
  // 本体と同じ手触りにする（Esc で戻る）
  useEffect(() => {
    const onKey = (event) => { if (event.key === "Escape") location.href = BACK; };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function change(next) {
    setStrokes(next);
    setMessage("");
    try {
      if (next.length) localStorage.setItem(SKETCH_DRAFT_KEY, JSON.stringify(next));
      else localStorage.removeItem(SKETCH_DRAFT_KEY);
    } catch { setMessage("下書きを端末に保存できません。画面を閉じずにメモへ追加してください。"); }
  }

  async function save() {
    if (!strokes.length || uploadRef.current) return;
    if (!hasDrive()) { setMessage("画像の置き場を設定すると追加できます。手書きの下書きは残っています。"); return; }
    const controller = new AbortController();
    uploadRef.current = controller;
    setSaving(true);
    setMessage("画像を保存しています…");
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const file = await sketchFile(strokes);
      if (controller.signal.aborted) return;
      const got = await uploadToDrive(file, undefined, { hint: "手書きのメモ", where: "sketch" }, { signal: controller.signal });
      if (uploadRef.current !== controller || controller.signal.aborted) return;
      // 木へ入れるのはアプリ側。ここでは追加待ちに積むだけ。
      if (!queueMemo({ image: got.url })) { setMessage("追加待ちに積めませんでした。下書きは残しています。"); return; }
      change([]);
      setMessage("メモに追加しました（アプリを開くと一覧に出ます）");
    } catch {
      if (uploadRef.current === controller) setMessage("手書きは下書きに残っています。つながってからもう一度追加してください。");
    } finally {
      clearTimeout(timer);
      if (uploadRef.current === controller) { uploadRef.current = null; setSaving(false); }
    }
  }

  return <SketchBoard
    strokes={strokes}
    onChange={change}
    onClose={() => { location.href = BACK; }}
    onSave={save}
    saving={saving}
    message={message}
  />;
}

createRoot(document.getElementById("root")).render(<SketchApp />);
