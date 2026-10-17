// ほかのアプリの書き出しを読む。
//   ・字下げの箇条書き（WorkFlowy の .md、Notion の .md）
//   ・WorkFlowy の .html（行に id が入っているので、読み直しても増えない）
// どれも { text, children, completed, ... } の木にして返す。

// --- 字下げの箇条書き ---

const BULLET = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const CHECK = /^\[([ xX])\]\s+(.*)$/;
const INDENT_OF = /^(\s*)/;

// 字下げの幅は書き出し元によって違う（2 / 4 / タブ）。実際の値から決める。
function indentUnit(lines) {
  const widths = new Set();
  for (const line of lines) {
    const m = BULLET.exec(line);
    if (m && m[1].length > 0) widths.add(m[1].replace(/\t/g, "    ").length);
  }
  if (!widths.size) return 2;
  return [...widths].reduce((a, b) => (a && a <= b ? a : b));
}

// 飾りを落として、素の文字にする（**太字** や ==しるし== など）
function plain(text) {
  return String(text || "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/==(.+?)==/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .trim();
}

export function parseIndentedMarkdown(raw) {
  const lines = String(raw || "").replace(/\r\n?/g, "\n").split("\n");
  const unit = indentUnit(lines) || 2;
  const roots = [];
  const lastAt = new Map();   // 深さ → その深さの、いちばん最後の行
  let current = null;
  // 見出しの中にある箇条書きは、その見出しの子にする（Notion の書き出し）
  let sectionDepth = -1;

  const put = (node, depth) => {
    if (depth <= 0) roots.push(node);
    else {
      let d = depth - 1;
      while (d >= 0 && !lastAt.get(d)) d -= 1;
      if (d < 0) roots.push(node);
      else lastAt.get(d).children.push(node);
    }
    lastAt.set(depth, node);
    for (const key of [...lastAt.keys()]) if (key > depth) lastAt.delete(key);
    current = node;
    return node;
  };

  // 先頭の、箇条書きでも見出しでもない1行は書き出し元の題（WorkFlowy の "Home"）。
  // その下が本当の根なので、題そのものは入れない。
  let skipTitle = false;
  const firstMeaning = lines.find((l) => l.trim());
  if (firstMeaning && !BULLET.test(firstMeaning) && !HEADING.test(firstMeaning.trim())
      && lines.some((l) => BULLET.test(l))) {
    skipTitle = true;
  }

  for (const line of lines) {
    if (!line.trim()) { current = null; continue; }
    if (skipTitle) { skipTitle = false; continue; }

    const head = HEADING.exec(line.trim());
    if (head) {
      const level = Math.min(3, head[1].length);
      const pad = INDENT_OF.exec(line)[1].replace(/\t/g, "    ").length;
      if (pad === 0) {
        // 行頭の見出しは、そこから下のひとまとまりの親になる（Notion の書き出し）
        sectionDepth = level - 1;
        put({ text: plain(head[2]), headingLevel: level, children: [] }, sectionDepth);
      } else {
        // 字下げの中にある見出しは、箇条書きの中身。
        // ここで親子の深さを入れ替えてしまうと、以降の行がぜんぶずれる。
        put({ text: plain(head[2]), headingLevel: level, children: [] },
          sectionDepth + 1 + Math.floor(pad / unit));
      }
      continue;
    }

    const bullet = BULLET.exec(line);
    if (bullet) {
      const indent = Math.floor(bullet[1].replace(/\t/g, "    ").length / unit);
      let body = bullet[2];
      let completed = false;
      const check = CHECK.exec(body);
      if (check) { completed = check[1].toLowerCase() === "x"; body = check[2]; }
      put({ text: plain(body), completed, children: [] }, sectionDepth + 1 + indent);
      continue;
    }

    // 箇条書きでない行。すぐ上の行の続きとして足す（Notion の説明文など）
    const text = plain(line);
    if (!text) continue;
    const pad = INDENT_OF.exec(line)[1].replace(/\t/g, "    ").length;
    // 空行をはさんだ続き（段落の切れ目）では current が切れている。
    // そのまま根に置くと、そこから下の親子が丸ごとずれてしまうので、
    // 字下げの深さから「どの行の続きか」を拾い直す。
    //   「- 本文」の続きは、その中黒のぶんだけ深く字下げされている。
    const host = current || (pad > 0 ? lastAt.get(Math.floor(pad / unit) - 1) : null);
    if (host) {
      host.text = host.text ? `${host.text}\n${text}` : text;
      current = host;
    } else {
      put({ text, children: [] }, pad > 0 ? Math.floor(pad / unit) : sectionDepth + 1);
    }
  }

  return roots;
}

// --- WorkFlowy の HTML ---

// <li> の中の <div class="name"> が行、その下の <ul> が子。
// data-chid が行の id なので、読み直しても増えない。
export function parseWorkflowyHtml(raw) {
  if (typeof DOMParser === "undefined") return [];
  const doc = new DOMParser().parseFromString(String(raw || ""), "text/html");

  const readList = (ul) => {
    const out = [];
    for (const li of ul.children) {
      if (li.tagName !== "LI") continue;
      const name = li.querySelector(":scope > div.name, :scope > .name");
      const note = li.querySelector(":scope > div.note, :scope > .note");
      const kids = li.querySelector(":scope > ul");
      const text = (name?.textContent || "").trim();
      const noteText = (note?.textContent || "").trim();
      out.push({
        id: name?.getAttribute("data-chid") || undefined,
        text: noteText ? `${text}\n${noteText}` : text,
        completed: li.className.includes("done") || name?.className.includes("done") || false,
        children: kids ? readList(kids) : [],
      });
    }
    return out;
  };

  const top = doc.querySelector("body > ul, ul");
  if (!top) return [];
  // いちばん外の題（Home など）は書き出し元の名前。入れ物にはしない。
  return readList(top);
}

// --- どの形か見分ける ---

export function parseByFormat(name, content) {
  const lower = String(name || "").toLowerCase();
  if (lower.endsWith(".html") || lower.endsWith(".htm") || /^\s*<(!doctype|div|ul|html)/i.test(content)) {
    const got = parseWorkflowyHtml(content);
    if (got.length) return { items: got, format: "workflowy-html" };
  }
  if (lower.endsWith(".md") || lower.endsWith(".markdown") || lower.endsWith(".txt")) {
    const got = parseIndentedMarkdown(content);
    if (got.length) return { items: got, format: "markdown" };
  }
  // 名前で分からないときは、中身で見る
  const got = parseIndentedMarkdown(content);
  if (got.length) return { items: got, format: "markdown" };
  throw new Error("中身を読み取れませんでした");
}

// --- Notion の .zip ---

// 書き出しは zip の中に .md と画像が入っている。
// ほどくのに外の部品は足さず、ブラウザが持っている DecompressionStream を使う。
async function inflateRaw(bytes) {
  if (typeof DecompressionStream === "undefined") throw new Error("この機械では zip をほどけません");
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// zip の末尾にある目次をたどって、中のファイルを1つずつ取り出す
export async function readZipEntries(buffer) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  // 中央ディレクトリの終わり（EOCD）を後ろから探す
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0 && i > bytes.length - 66000; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("zip の形になっていません");

  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  const out = [];
  const utf8 = new TextDecoder();

  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(at, true) !== 0x02014b50) break;
    const method = view.getUint16(at + 10, true);
    const sizeC = view.getUint32(at + 20, true);
    const nameLen = view.getUint16(at + 28, true);
    const extraLen = view.getUint16(at + 30, true);
    const commentLen = view.getUint16(at + 32, true);
    const localAt = view.getUint32(at + 42, true);
    const name = utf8.decode(bytes.subarray(at + 46, at + 46 + nameLen));
    at += 46 + nameLen + extraLen + commentLen;

    // 本体の前にも頭（ローカルヘッダ）が付いている。その長さぶん進める。
    const lName = view.getUint16(localAt + 26, true);
    const lExtra = view.getUint16(localAt + 28, true);
    const from = localAt + 30 + lName + lExtra;
    const raw = bytes.subarray(from, from + sizeC);
    out.push({ name, method, bytes: raw });
  }
  return { entries: out, inflate: inflateRaw };
}

// zip の中から、読めるものだけを取り出して木にする
export async function parseZip(buffer) {
  const { entries, inflate } = await readZipEntries(buffer);
  const texts = entries.filter((e) => /\.(md|markdown|txt|html?)$/i.test(e.name) && !e.name.startsWith("__MACOSX"));
  if (!texts.length) throw new Error("zip の中に、読める書き出し（.md / .html）がありませんでした");

  const utf8 = new TextDecoder();
  const items = [];
  for (const entry of texts) {
    const raw = entry.method === 0 ? entry.bytes : await inflate(entry.bytes);
    const content = utf8.decode(raw);
    try {
      const got = parseByFormat(entry.name, content);
      items.push(...got.items);
    } catch { /* 読めないものは飛ばす */ }
  }
  if (!items.length) throw new Error("zip の中身を読み取れませんでした");
  return { items, format: "zip", files: texts.length };
}
