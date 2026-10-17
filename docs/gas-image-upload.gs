/**
 * Task Space — Google ドライブにつなぐための Apps Script。
 *   ・画像を置く（行に貼った画像の実体）
 *   ・控えを置く（アプリの中身まるごと。backups フォルダに日付つきで）
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
      const box = subFolder(folder, "backups");
      const name = "taskspace-" + new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-") + ".json";
      const file = box.createFile(name, body.json || "{}", "application/json");
      prune(box, KEEP_BACKUPS);
      return reply({ ok: true, id: file.getId(), name: name });
    }
    const bytes = Utilities.base64Decode(body.dataBase64);
    const name = body.name || ("image-" + new Date().toISOString().replace(/[:.]/g, "-"));
    const blob = Utilities.newBlob(bytes, body.mimeType || "image/png", name);

    const file = folder.createFile(blob);
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
    return reply({ ok: true, folder: folder.getName() });
  } catch (err) {
    return reply({ error: String(err) });
  }
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
