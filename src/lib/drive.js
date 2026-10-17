// 画像を Google ドライブに置く（GAS の Web アプリ経由）。
// 鍵はアプリに持たせない。置き場の URL と合言葉は、使う人が設定に入れる。
// 中身は docs/gas-image-upload.gs。

const URL_KEY = "taskspace-drive-url";
const TOKEN_KEY = "taskspace-drive-token";

export function readDriveSetting() {
  try {
    return {
      url: localStorage.getItem(URL_KEY) || "",
      token: localStorage.getItem(TOKEN_KEY) || "",
    };
  } catch { return { url: "", token: "" }; }
}

export function writeDriveSetting({ url, token }) {
  try {
    localStorage.setItem(URL_KEY, url ?? "");
    localStorage.setItem(TOKEN_KEY, token ?? "");
  } catch { /* 入らなくても、その場かぎりで動く */ }
}

export function hasDrive() {
  return !!readDriveSetting().url;
}

// File / Blob を base64 にする（GAS に渡す形）
export function toBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("画像を読めませんでした"));
    reader.onload = () => {
      const out = String(reader.result || "");
      resolve(out.slice(out.indexOf(",") + 1));   // data:...;base64, を落とす
    };
    reader.readAsDataURL(file);
  });
}

// 送って、表示できる URL をもらう。
// Content-Type は付けない（付けると先に OPTIONS が飛び、GAS が答えられない）。
// ドライブに並ぶ名前を、あとから見て分かる形にする。
//   2026-10-17_2131_ねこの写真_ab12cd.png
// 置き場では年月のフォルダに分けて入る（GAS 側でやる）。
const EXT = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/heic": "heic", "image/svg+xml": "svg" };

export function tidyName(file, hint = "", at = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  const stamp = `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}_${p(at.getHours())}${p(at.getMinutes())}`;
  const fromFile = String(file?.name || "").replace(/\.[a-z0-9]+$/i, "");
  // 貼り付けた画像の名前はたいてい image.png なので、行の文字のほうを使う
  const plain = String(hint || "").trim() || (/^(image|スクリーンショット|screenshot)/i.test(fromFile) ? "" : fromFile);
  const label = plain
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[\\/:*?"<>|#\n\t]+/g, " ")
    .trim()
    .slice(0, 40)
    .replace(/\s+/g, "-");
  const tail = Math.random().toString(36).slice(2, 8);
  const ext = EXT[file?.type] || String(file?.name || "").split(".").pop()?.toLowerCase() || "png";
  return [stamp, label, tail].filter(Boolean).join("_") + `.${ext}`;
}

export async function uploadToDrive(file, setting = readDriveSetting(), about = {}) {
  if (!setting.url) throw new Error("置き場が決まっていません（設定で GAS の URL を入れてください）");
  const at = new Date();
  const payload = {
    token: setting.token || "",
    name: tidyName(file, about.hint, at),
    mimeType: file.type || "image/png",
    // 置き場では年/月のフォルダに分ける
    folder: `${at.getFullYear()}/${String(at.getMonth() + 1).padStart(2, "0")}`,
    // どこに貼ったものか（ドライブの説明欄に入れておく）
    note: [about.hint, about.where].filter(Boolean).join(" / ").slice(0, 300),
    dataBase64: await toBase64(file),
  };
  const res = await fetch(setting.url, { method: "POST", body: JSON.stringify(payload) });
  if (!res.ok) throw new Error(`置き場が答えません（${res.status}）`);
  const got = await res.json().catch(() => { throw new Error("置き場の返事を読めませんでした"); });
  if (got.error) throw new Error(got.error);
  if (!got.url) throw new Error("置き場から URL が返りませんでした");
  return got;
}

// 設定画面の「つながるか試す」
export async function pingDrive(setting = readDriveSetting()) {
  if (!setting.url) throw new Error("URL が空です");
  const url = `${setting.url}${setting.url.includes("?") ? "&" : "?"}token=${encodeURIComponent(setting.token || "")}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`つながりません（${res.status}）`);
  const got = await res.json().catch(() => { throw new Error("返事を読めませんでした"); });
  if (got.error) throw new Error(got.error);
  return got;
}

// --- 控え（バックアップ） ---

const LAST_BACKUP_KEY = "taskspace-drive-last-backup";

export function lastBackupAt() {
  try { return localStorage.getItem(LAST_BACKUP_KEY) || ""; } catch { return ""; }
}

// ドライブに控えを置く。中身は呼ぶ側が作る（タスクもアウトラインも設定も）。
export async function backupToDrive(payload, setting = readDriveSetting()) {
  if (!setting.url) throw new Error("置き場が決まっていません");
  const res = await fetch(setting.url, {
    method: "POST",
    body: JSON.stringify({ kind: "backup", token: setting.token || "", json: JSON.stringify(payload) }),
  });
  if (!res.ok) throw new Error(`置き場が答えません（${res.status}）`);
  const got = await res.json().catch(() => { throw new Error("置き場の返事を読めませんでした"); });
  if (got.error) throw new Error(got.error);
  try { localStorage.setItem(LAST_BACKUP_KEY, new Date().toISOString()); } catch { /* noop */ }
  return got;
}

// 前の控えから、どれだけ経ったか（時間）。まだ無ければ Infinity。
export function hoursSinceBackup() {
  const at = lastBackupAt();
  if (!at) return Infinity;
  return (Date.now() - new Date(at).getTime()) / 3600000;
}
