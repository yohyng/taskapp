import { test, expect, storedTasks, todayKey } from "./helpers.js";

const open = (page) => page.locator("[data-quick-add]").click();
const dialog = (page) => page.locator("[data-quick-add-dialog]");
const titled = async (page, t) => (await storedTasks(page)).find((x) => x.title === t);

test.describe("タスク追加のポップアップ", () => {
  test("＋ を押すと、画面の真ん中に大きく出る", async ({ page }) => {
    await open(page);
    await expect(dialog(page)).toBeVisible();
    const box = await dialog(page).locator("textarea").boundingBox();
    expect(box.width).toBeGreaterThan(250);
    // iOS が勝手に拡大しない大きさ
    const size = await dialog(page).locator("textarea").evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
    expect(size).toBeGreaterThanOrEqual(16);
  });

  test("Enter で追加でき、続けて打てる", async ({ page }) => {
    const before = (await storedTasks(page)).length;
    await open(page);
    await page.keyboard.type("ひとつめ");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await storedTasks(page)).length).toBe(before + 1);
    // 入力は空になり、ポップアップは開いたまま
    await expect(dialog(page).locator("textarea")).toHaveValue("");
    await expect(dialog(page)).toBeVisible();

    await page.keyboard.type("ふたつめ");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await storedTasks(page)).length).toBe(before + 2);
  });

  test("既定では今日に置かれる", async ({ page }) => {
    await open(page);
    await page.keyboard.type("きょうのこと");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await titled(page, "きょうのこと"))?.scheduledDate).toBe(todayKey());
  });

  test("「日付なし」を選ぶと TRAY に入る", async ({ page }) => {
    await open(page);
    await dialog(page).getByRole("button", { name: "日付なし" }).click();
    await dialog(page).locator("textarea").fill("いつかやる");
    await dialog(page).locator("[data-add-task]").click();
    await expect.poll(async () => (await titled(page, "いつかやる"))?.scheduledDate).toBe("");
  });

  test("Shift+Enter では追加されない（改行になる）", async ({ page }) => {
    const before = (await storedTasks(page)).length;
    await open(page);
    await page.keyboard.type("いちぎょうめ");
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("にぎょうめ");
    expect((await storedTasks(page)).length).toBe(before);
    await expect(dialog(page).locator("textarea")).toHaveValue("いちぎょうめ\nにぎょうめ");
  });

  test("Escape と背景クリックで閉じる", async ({ page }) => {
    await open(page);
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toBeHidden();

    await open(page);
    await dialog(page).click({ position: { x: 5, y: 5 } });
    await expect(dialog(page)).toBeHidden();
  });

  test("空のままでは追加できない", async ({ page }) => {
    await open(page);
    await expect(dialog(page).locator("[data-add-task]")).toBeDisabled();
    await expect(dialog(page).locator("[data-add-memo]")).toBeDisabled();
  });
});

test.describe("スマホの上の帯", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("ボタンが1段に収まり、＋だけ横に広い", async ({ page }) => {
    const add = await page.locator("[data-quick-add]").boundingBox();
    // 見るのは操作ボタンの列（ページのタブは別の段にある）
    const others = await page.locator("[data-header-actions] button").evaluateAll((els) =>
      els.filter((e) => !e.hasAttribute("data-quick-add"))
        .map((e) => { const r = e.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), w: Math.round(r.width) }; }));
    // ＋ はほかのボタンより目に見えて広い
    expect(add.width).toBeGreaterThan(Math.max(...others.map((o) => o.w)) * 2);
    // 上下がぴったり揃う（高さ違いで段差に見えない）
    const tops = [...others.map((o) => o.top), Math.round(add.y)];
    const bottoms = [...others.map((o) => o.bottom), Math.round(add.y + add.height)];
    expect(new Set(tops).size).toBe(1);
    expect(new Set(bottoms).size).toBe(1);
  });
});

test.describe("入力欄の大きさを変える", () => {
  const grip = (page) => page.locator("[data-quick-add-resize]");
  const area = (page) => dialog(page).locator("textarea");
  const h = async (page) => Math.round((await area(page).boundingBox()).height);

  test("下の帯を引っぱると、大きくなる", async ({ page }) => {
    await open(page);
    const before = await h(page);
    const g = await grip(page).boundingBox();
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
    await page.mouse.down();
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2 + 120, { steps: 8 });
    await page.mouse.up();

    expect(await h(page)).toBeGreaterThan(before + 80);
  });

  test("上に引っぱれば小さくなる。小さくしすぎない", async ({ page }) => {
    await open(page);
    const g = await grip(page).boundingBox();
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
    await page.mouse.down();
    await page.mouse.move(g.x + g.width / 2, g.y - 400, { steps: 8 });
    await page.mouse.up();

    const now = await h(page);
    expect(now).toBeLessThan(96);
    expect(now).toBeGreaterThanOrEqual(72); // 潰れない
  });

  test("変えた大きさは、閉じても読み直しても残る", async ({ page }) => {
    await open(page);
    const g = await grip(page).boundingBox();
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
    await page.mouse.down();
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2 + 100, { steps: 8 });
    await page.mouse.up();
    const grown = await h(page);

    await page.keyboard.press("Escape");
    await page.reload();
    await page.waitForSelector("header");
    await open(page);
    expect(Math.abs((await h(page)) - grown)).toBeLessThan(4);
  });

  test("ダブルクリックで元に戻る", async ({ page }) => {
    await open(page);
    const g = await grip(page).boundingBox();
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
    await page.mouse.down();
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2 + 100, { steps: 8 });
    await page.mouse.up();
    expect(await h(page)).toBeGreaterThan(150);

    await grip(page).dblclick();
    expect(await h(page)).toBe(96);
  });
});

test.describe("ポップアップの操作が、後ろに漏れない", () => {
  const grip = (page) => page.locator("[data-quick-add-resize]");
  // 範囲選択の矩形が出ているか
  const marquee = (page) => page.evaluate(() =>
    [...document.querySelectorAll("div")].some((e) => {
      const st = getComputedStyle(e);
      return st.position === "fixed" && /sky|border-sky/.test(e.className) &&
        e.getBoundingClientRect().height > 40 && e.getBoundingClientRect().width > 40;
    }));

  test("大きさを変えても、後ろの範囲選択が走らない", async ({ page }) => {
    await open(page);
    const g = await grip(page).boundingBox();
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
    await page.mouse.down();
    await page.mouse.move(g.x + g.width / 2 + 150, g.y + 220, { steps: 10 });
    expect(await marquee(page)).toBe(false);
    await page.mouse.up();
    // 後ろのタスクが選ばれていない
    await expect(page.getByText("件選択中", { exact: false })).toHaveCount(0);
  });

  test("ポップアップの余白をドラッグしても、後ろは動かない", async ({ page }) => {
    await open(page);
    const box = await dialog(page).locator("form").boundingBox();
    await page.mouse.move(box.x + 10, box.y + box.height - 6);
    await page.mouse.down();
    await page.mouse.move(box.x + 200, box.y + box.height + 260, { steps: 10 });
    expect(await marquee(page)).toBe(false);
    await page.mouse.up();
    await expect(page.getByText("件選択中", { exact: false })).toHaveCount(0);
  });
});

test("後ろを暗くしない", async ({ page }) => {
  await open(page);
  const bg = await dialog(page).evaluate((e) => getComputedStyle(e).backgroundColor);
  // 透明（rgba(0,0,0,0) か none）であること
  expect(["rgba(0, 0, 0, 0)", "transparent"]).toContain(bg);
  // 窓そのものは透けない
  const panel = await dialog(page).locator("form").evaluate((e) => getComputedStyle(e).backgroundColor);
  expect(panel).not.toContain("rgba(0, 0, 0, 0)");
  // 背景を押せば、これまで通り閉じる
  await dialog(page).click({ position: { x: 5, y: 5 } });
  await expect(dialog(page)).toBeHidden();
});

test.describe("メモに書きとめる", () => {
  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const outlineOf = (page) => page.evaluate(() =>
    JSON.parse(localStorage.getItem("taskspace-outline-v1") || "[]"));

  test("ヘッダーのボタンは「ノート」", async ({ page }) => {
    await expect(page.locator("[data-quick-add]")).toContainText("ノート");
  });

  test("メモに追加すると、今日の日付の下に入る", async ({ page }) => {
    await open(page);
    await dialog(page).locator("textarea").fill("おもいついたこと");
    await dialog(page).locator("[data-add-memo]").click();

    await expect.poll(async () => {
      const tree = await outlineOf(page);
      const day = tree.find((x) => x.text === today());
      return day?.children?.map((c) => c.text);
    }).toEqual(["おもいついたこと"]);
  });

  test("同じ日に続けて書くと、同じ日付の下に並ぶ", async ({ page }) => {
    await open(page);
    await dialog(page).locator("textarea").fill("ひとつめ");
    await dialog(page).locator("[data-add-memo]").click();
    await dialog(page).locator("textarea").fill("ふたつめ");
    await dialog(page).locator("[data-add-memo]").click();

    await expect.poll(async () => {
      const tree = await outlineOf(page);
      return tree.filter((x) => x.text === today()).length;
    }).toBe(1);
    const tree = await outlineOf(page);
    expect(tree.find((x) => x.text === today()).children.map((c) => c.text))
      .toEqual(["ひとつめ", "ふたつめ"]);
  });

  test("メモはタスクを増やさない", async ({ page }) => {
    const before = (await storedTasks(page)).length;
    await open(page);
    await dialog(page).locator("textarea").fill("メモだけ");
    await dialog(page).locator("[data-add-memo]").click();
    await expect(dialog(page).locator("textarea")).toHaveValue("");
    expect((await storedTasks(page)).length).toBe(before);
  });

  test("タスクに追加すると、これまで通りタスクになる", async ({ page }) => {
    const before = (await storedTasks(page)).length;
    await open(page);
    await dialog(page).locator("textarea").fill("やること");
    await dialog(page).locator("[data-add-task]").click();
    await expect.poll(async () => (await storedTasks(page)).length).toBe(before + 1);
    expect((await outlineOf(page)).some((x) => x.text === today())).toBe(false);
  });

  test("Enter は前に使ったほうを繰り返す", async ({ page }) => {
    await open(page);
    await dialog(page).locator("textarea").fill("メモにする");
    await dialog(page).locator("[data-add-memo]").click();

    // 次は Enter だけでメモになる
    await dialog(page).locator("textarea").fill("これもメモ");
    await page.keyboard.press("Enter");
    await expect.poll(async () => {
      const tree = await outlineOf(page);
      return tree.find((x) => x.text === today())?.children?.map((c) => c.text);
    }).toEqual(["メモにする", "これもメモ"]);
  });

  test("選んだほうは覚えていて、開き直しても同じ", async ({ page }) => {
    await open(page);
    await dialog(page).locator("textarea").fill("めも");
    await dialog(page).locator("[data-add-memo]").click();
    await page.keyboard.press("Escape");

    await page.reload();
    await page.waitForSelector("header");
    await open(page);
    await expect(dialog(page)).toContainText("いまはメモ");
  });

  test("書いたメモは、アウトラインに出る", async ({ page }) => {
    await open(page);
    await dialog(page).locator("textarea").fill("画面にも出る");
    await dialog(page).locator("[data-add-memo]").click();
    await page.keyboard.press("Escape");

    await page.locator("[data-pane-mode]").first().selectOption("outline");
    await expect(page.getByText("画面にも出る")).toBeVisible();
    await expect(page.locator("[data-outliner]").getByText(today())).toBeVisible();
  });
});
