import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
const source = readFileSync(new URL("../../docs/gas-image-upload.gs", import.meta.url), "utf8");
const iterator = (list) => { let index = 0; return { hasNext: () => index < list.length, next: () => list[index++] }; };

export function createGas({ corruptReadback = false } = {}) {
  const created = [], trashed = [], readbacks = [];
  const old = Array.from({ length: 31 }, (_, i) => ({
    getName: () => `taskspace-2026-10-${String(i + 1).padStart(2, "0")}-00-00.json`,
    setTrashed: () => trashed.push(i),
  }));
  const folder = {
    getName: () => "試験用フォルダ", getFoldersByName: () => iterator([folder]),
    createFile: (name, text, mime) => {
      created.push({ name, text, mime });
      return { getId: () => "new-backup", getBlob: () => ({ getDataAsString: () => {
        readbacks.push(text);
        return corruptReadback ? text.replace("日本語", "別内容") : text;
      } }), setTrashed: () => trashed.push("new-backup") };
    },
    getFiles: () => iterator(old),
  };
  const context = {
    DriveApp: { getFolderById: () => folder },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: (text) => ({ setMimeType: () => JSON.parse(text) }) },
    Utilities: {
      base64Decode: (text) => Buffer.from(text, "base64"),
      newBlob: (data) => data,
      ungzip: (blob) => ({ getDataAsString: () => gunzipSync(blob).toString("utf8") }),
      DigestAlgorithm: { SHA_256: "sha256" }, Charset: { UTF_8: "utf8" },
      computeDigest: (_algorithm, text) => [...createHash("sha256").update(text).digest()].map((v) => v > 127 ? v - 256 : v),
    },
  };
  runInNewContext(source, context);
  return { created, trashed, readbacks,
    post: (body) => context.doPost({ postData: { contents: JSON.stringify({ token: "ここに合言葉", kind: "backup", ...body }) } }),
    ping: () => context.doGet({ parameter: { token: "ここに合言葉" } }),
  };
}

