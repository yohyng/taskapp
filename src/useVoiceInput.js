import { useCallback, useEffect, useRef, useState } from "react";

function release(session, abort = true) {
  if (!session) return;
  session.onresult = session.onstart = session.onend = session.onerror = null;
  if (abort) {
    try { session.abort(); } catch { /* すでに終了していても入力は残す */ }
  }
}

const messages = {
  "not-allowed": "マイクを許可すると音声入力できます。手入力もそのまま使えます。",
  "service-not-allowed": "この環境では、キーボードのマイクから音声入力してください。",
  "audio-capture": "マイクが見つかりません。接続や端末の設定を確認してください。",
  "no-speech": "声を聞き取れませんでした。もう一度マイクを押して話してください。",
  network: "いま音声入力につながりません。入力した文字はそのまま残っています。",
};

export function useVoiceInput({ enabled, value, onText, inputRef }) {
  const sessionRef = useRef(null);
  const [state, setState] = useState({ phase: "idle", message: "" });
  const cancel = useCallback(() => {
    const session = sessionRef.current;
    sessionRef.current = null;
    release(session);
    setState({ phase: "idle", message: "" });
  }, []);
  useEffect(() => {
    // 閉じる・開き直す・アンマウントの境目で、古い認識結果を切り離す。
    return () => {
      const session = sessionRef.current;
      sessionRef.current = null;
      release(session);
    };
  }, [enabled]);

  function toggle() {
    if (sessionRef.current) {
      if (state.phase === "starting") { cancel(); return; }
      setState({ phase: "stopping", message: "音声を確定しています" });
      try { sessionRef.current.stop(); } catch { cancel(); }
      return;
    }
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      setState({ phase: "idle", message: "このブラウザーは音声入力に未対応です。キーボードにマイクがあれば利用できます。" });
      inputRef.current?.focus();
      return;
    }
    const start = inputRef.current?.selectionStart ?? value.length;
    const end = inputRef.current?.selectionEnd ?? start;
    const before = value.slice(0, start), after = value.slice(end);
    try {
      const session = new Recognition();
      session.lang = "ja-JP";
      session.continuous = true;
      session.interimResults = true;
      session.maxAlternatives = 1;
      sessionRef.current = session;
      setState({ phase: "starting", message: "マイクを準備しています" });
      session.onstart = () => {
        if (sessionRef.current === session) setState({ phase: "listening", message: "聞いています。話し終わったら停止を押してください" });
      };
      session.onresult = (event) => {
        if (sessionRef.current !== session) return;
        // 結果一覧は同じ確定文を何度も含む。追記せず、この録音の範囲だけ置き換える。
        const text = Array.from(event.results, (result) => result[0]?.transcript || "").join("");
        if (text) onText(before + text + after);
      };
      session.onerror = (event) => {
        if (sessionRef.current !== session) return;
        sessionRef.current = null;
        release(session);
        setState({ phase: "idle", message: event.error === "aborted" ? "" : messages[event.error] || "音声入力を開始できませんでした。手入力はそのまま使えます。" });
      };
      session.onend = () => {
        if (sessionRef.current !== session) return;
        sessionRef.current = null;
        release(session, false);
        setState({ phase: "idle", message: "" });
      };
      session.start();
    } catch {
      const session = sessionRef.current;
      sessionRef.current = null;
      release(session);
      setState({ phase: "idle", message: "音声入力を開始できませんでした。手入力はそのまま使えます。" });
    }
  }
  return { ...state, toggle, cancel };
}
