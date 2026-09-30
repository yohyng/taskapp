import { test, expect, block, storedTask, storedTasks, todayKey } from "./helpers.js";

const menuPanel = (page) => page.locator("div.absolute.top-full");
const menuItem = (page, text) => menuPanel(page).locator("button", { hasText: text });

async function slashOnBlock(page, id, query) {
  await block(page, id).locator("div.cursor-pointer").first().dblclick();
  await expect(page.locator("textarea")).toHaveCount(1);
  await page.keyboard.press("End");
  await page.keyboard.type(" /" + query);
}

test.describe("ブロック種別", () => {
  test("見出しにすると、チェックボックスが消えて強調される", async ({ page }) => {
    await slashOnBlock(page, "a-solo", "見出し1");
    await page.keyboard.press("Enter");

    await expect.poll(async () => (await storedTask(page, "a-solo")).blockType).toBe("heading1");
    // クラス名ではなく実際の描画結果で見る
    const weight = await block(page, "a-solo")
      .locator("div[style]").first()
      .evaluate((el) => getComputedStyle(el).fontWeight);
    expect(Number(weight)).toBeGreaterThanOrEqual(700);
    // 完了トグルは持たない
    await expect(block(page, "a-solo").locator("svg.lucide-circle")).toHaveCount(0);
  });

  test("区切り線にすると本文がなくなり、線だけになる", async ({ page }) => {
    await slashOnBlock(page, "a-solo", "区切り");
    await page.keyboard.press("Enter");

    await expect.poll(async () => (await storedTask(page, "a-solo")).blockType).toBe("divider");
    const row = block(page, "a-solo");
    await expect(row.locator("span.h-px")).toBeVisible();
    await expect(row.getByText("単独タスク")).toHaveCount(0);
    // 行としては残るので選択できる
    await row.click();
    await expect(page.getByText(/件選択中/)).toBeVisible();
  });

  test("コールアウトは目印つきの枠になる", async ({ page }) => {
    await slashOnBlock(page, "a-solo", "コールアウト");
    await page.keyboard.press("Enter");

    await expect.poll(async () => (await storedTask(page, "a-solo")).blockType).toBe("callout");
    await expect(block(page, "a-solo").getByText("💡")).toBeVisible();
  });

  test("タスクに戻せる", async ({ page }) => {
    await slashOnBlock(page, "a-solo", "見出し1");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await storedTask(page, "a-solo")).blockType).toBe("heading1");

    await slashOnBlock(page, "a-solo", "ToDo");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await storedTask(page, "a-solo")).blockType).toBe("task");
  });
});

test.describe("追加欄のスラッシュ", () => {
  test("追加欄で / を打つとメニューが出る", async ({ page }) => {
    await page.getByPlaceholder("このProjectに追加").first().click();
    await page.keyboard.type("/");
    await expect(menuItem(page, "見出し1")).toBeVisible();
  });

  test("文字を書いてからコマンドを選ぶと、その文字でタスクが作られる", async ({ page }) => {
    const before = (await storedTasks(page)).length;
    await page.getByPlaceholder("このProjectに追加").first().click();
    await page.keyboard.type("あたらしい見出し /見出し1");
    await page.keyboard.press("Enter");

    await expect.poll(async () => (await storedTasks(page)).length).toBe(before + 1);
    const created = (await storedTasks(page)).find((t) => t.title === "あたらしい見出し");
    expect(created).toMatchObject({ blockType: "heading1" });
  });

  test("7daysの追加欄でも使える", async ({ page }) => {
    const before = (await storedTasks(page)).length;
    await page.getByPlaceholder("追加…").first().click();
    await page.keyboard.type("きょうやる /今日");
    await page.keyboard.press("Enter");

    await expect.poll(async () => (await storedTasks(page)).length).toBe(before + 1);
    const created = (await storedTasks(page)).find((t) => t.title === "きょうやる");
    expect(created.scheduledDate).toBe(todayKey());
  });
});

test.describe("ブロックの操作列", () => {
  test("ホバーで + と ⠿ が出て、+ で下にブロックが増える", async ({ page }) => {
    const before = (await storedTasks(page)).length;
    const row = block(page, "a-solo");
    await row.hover();

    const plus = row.locator('button[title="下にブロックを追加"]');
    await expect(plus).toBeVisible();
    await expect(row.locator('span[title="ドラッグで移動"]')).toBeVisible();

    await plus.click();
    await expect.poll(async () => (await storedTasks(page)).length).toBe(before + 1);
    // 追加された空ブロックがそのまま編集状態になる
    await expect(page.locator("textarea")).toHaveCount(1);
  });

  test("⠿ をクリックしても選択にはならない", async ({ page }) => {
    const row = block(page, "a-solo");
    await row.hover();
    await row.locator('span[title="ドラッグで移動"]').click();
    await expect(page.getByText(/件選択中/)).toHaveCount(0);
  });

  test("空のブロックには入力のヒントが出る", async ({ page }) => {
    const row = block(page, "a-solo");
    await row.hover();
    await row.locator('button[title="下にブロックを追加"]').click();
    await expect(page.locator("textarea")).toHaveAttribute("placeholder", /コマンドは/);
  });
});

test.describe("全角のコマンド呼び出し", () => {
  for (const trigger of ["；", "／"]) {
    test(`「${trigger}」でもメニューが開く`, async ({ page }) => {
      await block(page, "a-solo").locator("div.cursor-pointer").first().dblclick();
      await page.keyboard.press("End");
      await page.keyboard.type(" " + trigger);
      await expect(menuItem(page, "見出し1")).toBeVisible();
    });
  }

  test("「；」で選んだコマンドが実行され、記号は残らない", async ({ page }) => {
    await block(page, "b-1").locator("div.cursor-pointer").first().dblclick();
    await page.keyboard.press("End");
    await page.keyboard.type(" ；今日");
    await page.keyboard.press("Enter");

    await expect.poll(async () => (await storedTask(page, "b-1")).scheduledDate).toBe(todayKey());
    expect((await storedTask(page, "b-1")).title).toBe("ベータ1");
  });
});

test.describe("マークダウン記法での変換", () => {
  const CASES = [
    ["# ", "heading1"],
    ["## ", "heading2"],
    ["### ", "heading3"],
    ["- ", "bulleted"],
    ["1. ", "numbered"],
    ["> ", "quote"],
    ["[] ", "task"],
    ["--- ", "divider"],
  ];

  for (const [prefix, expected] of CASES) {
    test(`「${prefix.trim()}」で ${expected} になる`, async ({ page }) => {
      // 空のブロックを用意して、その行頭に記法を打つ
      const row = block(page, "a-solo");
      await row.hover();
      await row.locator('button[title="下にブロックを追加"]').click();
      await expect(page.locator("textarea")).toHaveCount(1);

      const id = await page.evaluate(() =>
        document.querySelector("textarea").closest("[data-task-id]").getAttribute("data-task-id"));
      await page.keyboard.type(prefix);

      await expect.poll(async () => (await storedTask(page, id)).blockType).toBe(expected);
      // 記法そのものは残らない
      const ta = page.locator("textarea");
      if (await ta.count()) await expect(ta).toHaveValue("");
    });
  }
});

test.describe("ブロック種別の見た目", () => {
  test("ToDo だけがチェックボックスを持つ", async ({ page }) => {
    // 既定（task）にはある
    await expect(block(page, "a-solo").locator("svg.lucide-circle")).toHaveCount(1);

    await slashOnBlock(page, "a-solo", "テキスト");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await storedTask(page, "a-solo")).blockType).toBe("text");
    await expect(block(page, "a-solo").locator("svg.lucide-circle")).toHaveCount(0);
  });

  test("箇条書きには • が付く", async ({ page }) => {
    await slashOnBlock(page, "a-solo", "箇条書き");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await storedTask(page, "a-solo")).blockType).toBe("bulleted");
    await expect(block(page, "a-solo").getByText("•")).toBeVisible();
  });

  test("番号付きリストは連番になり、別種を挟むと振り直す", async ({ page }) => {
    // ALPHA は a-parent / a-solo の2ルート。両方を numbered にすると 1, 2 になる。
    for (const id of ["a-parent", "a-solo"]) {
      await slashOnBlock(page, id, "番号付き");
      await page.keyboard.press("Enter");
      await expect.poll(async () => (await storedTask(page, id)).blockType).toBe("numbered");
    }
    const marks = () => page.evaluate(() =>
      ["a-parent", "a-solo"].map((id) => {
        const row = document.querySelector(`[data-task-id="${id}"]`);
        return [...row.querySelectorAll("span")].map((s) => s.textContent).find((t) => /^\d+\.$/.test(t));
      }));
    expect(await marks()).toEqual(["1.", "2."]);

    // 間に別種を挟むと、後ろは 1 に戻る
    await slashOnBlock(page, "a-parent", "テキスト");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await storedTask(page, "a-parent")).blockType).toBe("text");
    await expect.poll(async () => (await marks())[1]).toBe("1.");
  });

  test("引用は左に線が付く", async ({ page }) => {
    await slashOnBlock(page, "a-solo", "引用");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await storedTask(page, "a-solo")).blockType).toBe("quote");
    const w = await block(page, "a-solo").evaluate((el) => getComputedStyle(el).borderLeftWidth);
    expect(parseFloat(w)).toBeGreaterThan(0);
  });
});
