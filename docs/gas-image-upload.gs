/**
 * Task Space — Google ドライブにつなぐための Apps Script。
 *   ・画像を置く（images/<年>/<月>/ に、日付と行の文字を入れた名前で）
 *   ・控えを置く（アプリの中身まるごと。backups フォルダに日付つきで）
 *
 * フォルダの中はこうなる
 *   <指定したフォルダ>/
 *     images/2026/10/2026-10-17_2131_打ち合わせのメモ_ab12cd.png
 *     backups/taskspace-2026-10-17-21-31.json
 *
 * 置き方
 *  1. script.google.com で新しいプロジェクトを作り、この中身を貼る
 *  2. FOLDER_ID と TOKEN を書き換える
 *       FOLDER_ID … 画像を入れるフォルダの ID
 *                   （フォルダを開いた URL の .../folders/ のうしろ）
 *       TOKEN     … 合言葉。アプリの設定にも同じものを入れる
 *  3. 「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」
 *       次のユーザーとして実行 … 自分
 *       アクセスできるユーザー … 全員
 *  4. 出てきた URL（/exec で終わるもの）を、アプリの設定に貼る
 *
 * 既存の更新ではFOLDER_IDとTOKENを今の値に保ち、コードを保存したあと
 * 「デプロイを管理」で既存のデプロイを編集し、新しいバージョンへ更新する。
 * 同じデプロイを更新すれば、端末に設定した /exec のURLを維持できる。
 *
 * 公開にすると URL を知っている人は誰でも投げられるので、TOKEN は必ず入れる。
 * 画像は「リンクを知っている全員が閲覧可」になる（表示に必要）。
 */

const FOLDER_ID = "ここにフォルダの ID";
const TOKEN = "ここに合言葉";
// 控えをいくつ残すか（古いものから消える）
const KEEP_BACKUPS = 30;

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (TOKEN && body.token !== TOKEN) return reply({ error: "合言葉が違います" });

    const folder = DriveApp.getFolderById(FOLDER_ID);

    // 控え（アプリの中身まるごと）。画像とは別のフォルダに置く。
    if (body.kind === "backup") {
      const name = "taskspace-" + new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-") + ".json";
      // 控えは backups/ にそのまま。名前が日付順なので、並べればそのまま時系列。
      // 大きいものは縮めて送られてくる（Safari が大きな POST を落とすため）。
      var text = body.json;
      if (body.gzipBase64) {
        var packed = Utilities.newBlob(Utilities.base64Decode(body.gzipBase64), "application/x-gzip", name + ".gz");
        text = Utilities.ungzip(packed).getDataAsString();
      }
      // 本文が欠けた要求を空の控えへ変えると、正常な古い控えまで整理で失う。
      if (typeof text !== "string" || !text.length) throw new Error("控えの本文がありません");
      if (body.expectedBytes !== undefined && (!Number.isSafeInteger(body.expectedBytes) || body.expectedBytes !== text.length)) {
        throw new Error("控えの長さが送信元と一致しません");
      }
      const parsed = JSON.parse(text);
      if (!parsed || parsed.app !== "taskspace" || !parsed.store || typeof parsed.store !== "object" || Array.isArray(parsed.store)) {
        throw new Error("Task Spaceの控えを読めません");
      }
      const outline = JSON.parse(parsed.store["taskspace-outline-v1"]);
      if (!Array.isArray(outline) && (!outline || !Array.isArray(outline.nodes))) throw new Error("控えにアウトラインがありません");
      if (parsed.store["notion-like-taskdb-prototype-v4"] !== undefined) JSON.parse(parsed.store["notion-like-taskdb-prototype-v4"]);
      const sha256 = backupDigest(text);
      if (body.expectedSha256 !== undefined && body.expectedSha256 !== sha256) throw new Error("控えの内容が送信元と一致しません");
      const box = subFolder(folder, "backups");
      const file = box.createFile(name, text, "application/json");
      try {
        if (file.getBlob().getDataAsString("UTF-8") !== text) throw new Error("保存した控えの読み直しが一致しません");
      } catch (error) {
        // この要求で作った不完全なファイルだけを片付け、前の控えは残す。
        try { file.setTrashed(true); } catch { /* 削除できなくても成功として返さない */ }
        throw error;
      }
      prune(box, KEEP_BACKUPS);
      // bytesは旧クライアントとの互換のためUTF-16の文字数を維持する。
      return reply({ ok: true, id: file.getId(), name: name, bytes: text.length, sha256: sha256 });
    }
    const bytes = Utilities.base64Decode(body.dataBase64);
    const name = body.name || ("image-" + new Date().toISOString().replace(/[:.]/g, "-"));
    const blob = Utilities.newBlob(bytes, body.mimeType || "image/png", name);

    // 画像は images/<年>/<月>/ に分けて入れる。あとから探しやすいように。
    var box = subFolder(folder, "images");
    var parts = String(body.folder || "").split("/");
    for (var i = 0; i < parts.length; i++) if (parts[i]) box = subFolder(box, parts[i]);

    const file = box.createFile(blob);
    // どの行に貼ったものかを、説明欄に残す（ドライブの検索で当たる）
    if (body.note) file.setDescription(String(body.note));
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    return reply({
      id: file.getId(),
      // アプリはこの URL をそのまま行に書く
      url: "https://drive.google.com/thumbnail?id=" + file.getId() + "&sz=w1600",
      name: file.getName(),
    });
  } catch (err) {
    return reply({ error: String(err) });
  }
}

// 設定画面の「つながるか試す」用
function doGet(e) {
  if (TOKEN && (!e || !e.parameter || e.parameter.token !== TOKEN)) {
    return reply({ error: "合言葉が違います" });
  }
  try {
    const folder = DriveApp.getFolderById(FOLDER_ID);
    return reply({ ok: true, folder: folder.getName(), backupProtocol: 2 });
  } catch (err) {
    return reply({ error: String(err) });
  }
}

function backupDigest(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)
    .map(function (value) { return ("0" + ((value + 256) % 256).toString(16)).slice(-2); }).join("");
}

// 名前のフォルダを、無ければ作って返す
function subFolder(parent, name) {
  const found = parent.getFoldersByName(name);
  return found.hasNext() ? found.next() : parent.createFolder(name);
}

// 古い控えを捨てる（名前が日付順なので、名前で並べれば足りる）
function prune(folder, keep) {
  const files = [];
  const it = folder.getFiles();
  while (it.hasNext()) files.push(it.next());
  files.sort(function (a, b) { return a.getName() < b.getName() ? 1 : -1; });
  for (let i = keep; i < files.length; i++) files[i].setTrashed(true);
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
