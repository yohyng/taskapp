import { test, expect } from "./helpers.js";

// 画像の置き場（Google ドライブ／GAS）まわり
const GAS = "https://example.test/exec";

const setMode = (page, key, i = 0) => page.locator("[data-pane-mode]").nth(i).selectOption(key);
const outline = (page) => page.locator("[data-outliner]");
const note = (page) => page.locator("[data-outline-note]");

const open = async (page) => { await setMode(page, "outline"); await expect(outline(page)).toBeVisible(); };
const gear = async (page) => {
  await page.locator("[data-outline-view]").click();
  await expect(page.locator("[data-view-panel]")).toBeVisible();
};

// 置き場を先に決めておく
const withDrive = (page) => page.addInitScript(() => {
  localStorage.setItem("taskspace-drive-url", "https://example.test/exec");
  localStorage.setItem("taskspace-drive-token", "ひみつ");
  // ひとりでに控えないよう、いま控えたことにしておく
  localStorage.setItem("taskspace-drive-last-backup", new Date().toISOString());
  localStorage.setItem("taskspace-outline-v1", JSON.stringify([{ id: "one", text: "" }]));
});

// GAS のふりをする。送られた中身を集めて返す。
async function fakeGas(page, reply = { url: "https://drive.google.com/thumbnail?id=abc&sz=w1600", id: "abc" }) {
  const sent = [];
  await page.route(`${GAS}**`, async (route) => {
    const body = route.request().postData();
    sent.push(body ? JSON.parse(body) : null);
    await route.fulfill({
      status: 200,
      headers: { "access-control-allow-origin": "*" },
      contentType: "application/json",
      body: JSON.stringify(reply),
    });
  });
  return sent;
}

// 行に画像を貼り付ける
const pasteImage = (page) => page.evaluate(() => {
  const el = document.querySelector("[data-row] textarea[data-row-text]");
  const dt = new DataTransfer();
  dt.items.add(new File([new Uint8Array([1, 2, 3])], "ねこ.png", { type: "image/png" }));
  el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
});

test.describe("画像の置き場の設定", () => {
  test("URL と合言葉を入れると覚えている", async ({ page }) => {
    await open(page);
    await gear(page);
    await page.locator("[data-drive-url]").fill(GAS);
    await page.locator("[data-drive-token]").fill("ひみつ");
    await page.reload();
    await page.waitForSelector("header");
    await open(page);
    await gear(page);
    await expect(page.locator("[data-drive-url]")).toHaveValue(GAS);
    await expect(page.locator("[data-drive-token]")).toHaveValue("ひみつ");
  });

  test("合言葉は見えない形で置く", async ({ page }) => {
    await open(page);
    await gear(page);
    await expect(page.locator("[data-drive-token]")).toHaveAttribute("type", "password");
  });

  test("つながるか試せる", async ({ page }) => {
    await withDrive(page);
    await page.reload();
    await page.waitForSelector("header");
    await fakeGas(page, { ok: true, folder: "画像" });
    await open(page);
    await gear(page);
    await page.locator("[data-drive-test]").click();
    await expect(note(page)).toContainText("つながりました");
  });

  test("つながらなければ、そう出る", async ({ page }) => {
    await withDrive(page);
    await page.reload();
    await page.waitForSelector("header");
    await fakeGas(page, { error: "合言葉がちがいます" });
    await open(page);
    await gear(page);
    await page.locator("[data-drive-test]").click();
    await expect(note(page)).toContainText("合言葉がちがいます");
  });
});

test.describe("画像を貼る", () => {
  test("貼り付けると、その行に URL が入る", async ({ page }) => {
    await withDrive(page);
    await page.reload();
    await page.waitForSelector("header");
    const sent = await fakeGas(page);
    await open(page);
    await page.locator("[data-row] [data-row-text]").first().click();
    await pasteImage(page);
    await expect(note(page)).toContainText("画像を置きました");
    await expect(page.locator("[data-row] [data-row-text]").first()).toHaveValue(/drive\.google\.com/);
    // 名前は「日付_時刻_手がかり_しるし.拡張子」、置き場は年/月のフォルダ
    expect(sent[0].name).toMatch(/^\d{4}-\d{2}-\d{2}_\d{4}_ねこ_[a-z0-9]{6}\.png$/);
    expect(sent[0].folder).toMatch(/^\d{4}\/\d{2}$/);
    expect(sent[0].mimeType).toBe("image/png");
    expect(sent[0].dataBase64.length).toBeGreaterThan(0);
    expect(sent[0].token).toBe("ひみつ");
  });

  test("置き場が決まっていなければ、案内が出る", async ({ page }) => {
    await page.addInitScript(() =>
      localStorage.setItem("taskspace-outline-v1", JSON.stringify([{ id: "one", text: "" }])));
    await page.reload();
    await page.waitForSelector("header");
    await open(page);
    await page.locator("[data-row] [data-row-text]").first().click();
    await pasteImage(page);
    await expect(note(page)).toContainText("画像の置き場が決まっていません");
  });

  test("置けなければ、理由が出る", async ({ page }) => {
    await withDrive(page);
    await page.reload();
    await page.waitForSelector("header");
    await fakeGas(page, { error: "フォルダが見つかりません" });
    await open(page);
    await page.locator("[data-row] [data-row-text]").first().click();
    await pasteImage(page);
    await expect(note(page)).toContainText("フォルダが見つかりません");
  });
});

test.describe("控え（バックアップ）", () => {
  test("いま控える、で中身一式が飛ぶ", async ({ page }) => {
    await withDrive(page);
    await page.reload();
    await page.waitForSelector("header");
    const sent = await fakeGas(page, { ok: true, name: "taskspace-2026-01-01.json" });
    await open(page);
    await gear(page);
    await page.locator("[data-drive-backup]").click();
    await expect(note(page)).toContainText("控えました");
    expect(sent[0].kind).toBe("backup");
    const store = JSON.parse(sent[0].json).store;
    expect(store["taskspace-outline-v1"]).toBeTruthy();
    // 合言葉は控えに入れない
    expect(store["taskspace-drive-token"]).toBeUndefined();
  });

  test("置き場が無ければ、そう出る", async ({ page }) => {
    await open(page);
    await gear(page);
    await page.locator("[data-drive-backup]").click();
    await expect(note(page)).toContainText("置き場が決まっていません");
  });
});
