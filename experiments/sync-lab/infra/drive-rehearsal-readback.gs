// 追加の読取りは、この検証用ルートの配下だけに限定する。通常のGASには追加しない。
function rehearsalContains(file) {
  var pending = [{ item: file, depth: 0 }], visited = {};
  while (pending.length) {
    var entry = pending.pop();
    if (entry.depth >= 8) continue;
    var parents = entry.item.getParents();
    while (parents.hasNext()) {
      var parent = parents.next(), id = parent.getId();
      if (id === FOLDER_ID) return true;
      if (!visited[id]) { visited[id] = true; pending.push({ item: parent, depth: entry.depth + 1 }); }
    }
  }
  return false;
}
function rehearsalDigestBytes(bytes) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes)
    .map(function (value) { return ("0" + ((value + 256) % 256).toString(16)).slice(-2); }).join("");
}
function doGet(e) {
  if (!e || !e.parameter || e.parameter.token !== TOKEN) return reply({ error: "合言葉が違います" });
  try {
    var root = DriveApp.getFolderById(FOLDER_ID), action = e.parameter.action;
    if (!action) return reply({ ok: true, folder: root.getName(), folderId: root.getId(),
      backupProtocol: 2, rehearsalProtocol: 1, rehearsalId: REHEARSAL_ID, retentionEnabled: false });
    if (action !== "readBackup" && action !== "readImage") throw new Error("検証用の読取り操作が不正です");
    var file = DriveApp.getFileById(String(e.parameter.id || ""));
    if (!rehearsalContains(file)) throw new Error("検証フォルダー外のファイルは読めません");
    var blob = file.getBlob();
    if (action === "readBackup") {
      if (file.getMimeType() !== "application/json") throw new Error("控えのファイルではありません");
      var text = blob.getDataAsString("UTF-8");
      return reply({ ok: true, id: file.getId(), text: text, bytes: text.length, sha256: backupDigest(text) });
    }
    if (file.getMimeType().indexOf("image/") !== 0) throw new Error("画像のファイルではありません");
    var bytes = blob.getBytes();
    return reply({ ok: true, id: file.getId(), mimeType: file.getMimeType(), dataBase64: Utilities.base64Encode(bytes), sha256: rehearsalDigestBytes(bytes) });
  } catch (error) { return reply({ error: String(error) }); }
}
