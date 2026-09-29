import { test, expect, block, dayBlock, storedTask, storedTasks, countInPanel } from "./helpers.js";

test.describe("フォーカスモード", () => {
  const enable = (page) => page.locator('button[title="フォーカスモード"]').click();

  test("有効にすると全ビューのタスクに目印が付く", async ({ page }) => {
    await enable(page);
    const counts = await page.evaluate(() => {
      const all = [...document.querySelectorAll("[data-task-id]")];
      return { total: all.length, ringed: all.filter((e) => e.className.includes("ring-amber")).length };
    });
    expect(counts.total).toBeGreaterThan(0);
    expect(counts.ringed).toBe(counts.total);
  });

  test("タスクをクリックするとオーバーレイが開き、編集には入らない", async ({ page }) => {
    await enable(page);
    await block(page, "a-parent").click();
    await expect(page.getByText("Esc で閉じる")).toBeVisible();
    await expect(page.locator("textarea")).toHaveCount(0);

    await page.keyboard.press("Escape");
    await expect(page.getByText("Esc で閉じる")).toHaveCount(0);
  });

  test("タイトルをクリックしても編集にならずフォーカスされる", async ({ page }) => {
    await enable(page);
    await block(page, "a-solo").locator("div.cursor-crosshair").first().click();
    await expect(page.getByText("Esc で閉じる")).toBeVisible();
    await expect(page.locator("textarea")).toHaveCount(0);
  });

  test("7daysのタスクでも効く", async ({ page }) => {
    await enable(page);
    await dayBlock(page, "d-1").click();
    await expect(page.getByText("Esc で閉じる")).toBeVisible();
  });

  test("オーバーレイに親と子が出る", async ({ page }) => {
    await enable(page);
    await block(page, "a-parent").click();
    const overlay = page.locator("div.fixed.inset-0").filter({ hasText: "Esc で閉じる" });
    await expect(overlay.getByText("子タスク1")).toBeVisible();
    await expect(overlay.getByText("子タスク2")).toBeVisible();
  });
});

test.describe("STOCKビュー", () => {
  test("追加・改名・色変更ができて保存される", async ({ page }) => {
    await page.getByRole("button", { name: "STOCKビューを追加" }).click();
    await expect.poll(async () =>
      page.evaluate(() => JSON.parse(localStorage.getItem("taskspace-stock-views") || "[]").length)
    ).toBe(2);

    // 2つ目を改名（クリック1回で編集に入る）
    await page.locator('button[title="クリックで名前を変更"]').nth(1).click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("あとで");
    await page.keyboard.press("Enter");

    await expect.poll(async () =>
      page.evaluate(() => JSON.parse(localStorage.getItem("taskspace-stock-views"))[1].name)
    ).toBe("あとで");

    // 色を変える
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem("taskspace-stock-views"))[1].color);
    await page.locator('button[title="色を変える"]').nth(1).click();
    // 開いた色パレットは、その丸ボタンの祖先パネル内に現れる
    await page
      .locator('button[title="色を変える"]')
      .nth(1)
      .locator("xpath=ancestor::div[2]")
      .locator("div.flex.flex-wrap > button")
      .nth(3)
      .click();
    await expect.poll(async () =>
      page.evaluate(() => JSON.parse(localStorage.getItem("taskspace-stock-views"))[1].color)
    ).not.toBe(before);
  });

  test("Moveパネルから選択分をSTOCKに入れられる", async ({ page }) => {
    await block(page, "a-solo").click();
    await page.getByRole("button", { name: "Move…" }).click();
    await page.locator('div[class*="fixed"] button', { hasText: "STOCK" }).first().click();

    await expect.poll(async () => (await storedTask(page, "a-solo")).stock).toBe(true);
    expect(await storedTask(page, "a-solo")).toMatchObject({ project: "ALPHA", scheduledDate: "" });
  });

  test("親をSTOCKに入れると子もそのビューに並ぶ", async ({ page }) => {
    await block(page, "a-parent").click();
    await page.getByRole("button", { name: "Move…" }).click();
    await page.locator('div[class*="fixed"] button', { hasText: "STOCK" }).first().click();
    await expect.poll(async () => (await storedTask(page, "a-parent")).stock).toBe(true);

    // 親1 + 子2 = 3行（子は親の下にぶら下がって描かれる）
    await expect.poll(async () => countInPanel(page, "STOCK")).toBe(3);
  });

  test("ビューを消しても中のタスクは消えない", async ({ page }) => {
    await block(page, "a-solo").click();
    await page.getByRole("button", { name: "Move…" }).click();
    await page.locator('div[class*="fixed"] button', { hasText: "STOCK" }).first().click();
    await expect.poll(async () => (await storedTask(page, "a-solo")).stock).toBe(true);

    const before = (await storedTasks(page)).length;
    // 消せるのは2つ以上あるときだけなので、もう1つ追加してから1つ消す
    await page.getByRole("button", { name: "STOCKビューを追加" }).click();
    await page.locator('button[title="このビューを削除（中のタスクは消えません）"]').first().click();

    await expect.poll(async () => (await storedTask(page, "a-solo")).stock).toBe(false);
    expect(await storedTasks(page)).toHaveLength(before);
  });
});
