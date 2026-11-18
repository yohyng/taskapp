import { test as base, expect } from "./helpers.js";
import { devices } from "@playwright/test";

// 触る画面では、なぞると「送り」。選ぶのは長押ししてから。
// 押しただけで選びに入ると、アウトラインを送れなくなる。
const test = base.extend({
  page: async ({ browser }, use) => {
    const ctx = await browser.newContext({ ...devices["iPad (gen 7)"], isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await use(page);
    await ctx.close();
  },
});

const setMode = (page, key, i = 0) => page.locator("[data-pane-mode]").nth(i).selectOption(key);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("taskspace-outline-v1", JSON.stringify(
    Array.from({ length: 60 }, (_, i) => ({ id: `n${i}`, text: `行 ${i}` })))));
  await page.goto("/");
  await page.waitForSelector("header");
  await setMode(page, "outline");
  await expect(page.locator("[data-outliner]")).toBeVisible();
});

const list = (page) => page.locator("[data-outline-list]");

test("指でなぞっても、行が選ばれない（送りたいだけ）", async ({ page }) => {
  const box = await list(page).boundingBox();
  const x = box.x + box.width / 2, y = box.y + 120;
  await page.touchscreen.tap(x, y - 60);   // 置き場所を確かめる程度
  await page.evaluate(([px, py]) => {
    const el = document.querySelector("[data-outline-list]");
    const send = (type, clientY) => el.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, isPrimary: true, pointerId: 3, pointerType: "touch", button: 0,
      clientX: px, clientY,
    }));
    send("pointerdown", py);
    for (let i = 1; i <= 6; i += 1) send("pointermove", py - i * 20);
    send("pointerup", py - 120);
  }, [x, y]);
  await expect(page.locator("[data-row][data-picked]")).toHaveCount(0);
  await expect(page.locator("[data-select-band]")).toHaveCount(0);
});

test("長押ししてからなぞると、まとめて選べる", async ({ page }) => {
  const box = await list(page).boundingBox();
  const x = box.x + box.width / 2, y = box.y + 80;
  await page.evaluate(async ([px, py]) => {
    const el = document.querySelector("[data-outline-list]");
    const send = (type, clientY) => el.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, isPrimary: true, pointerId: 4, pointerType: "touch", button: 0,
      clientX: px, clientY,
    }));
    send("pointerdown", py);
    await new Promise((done) => setTimeout(done, 600));   // 長押し
    for (let i = 1; i <= 6; i += 1) send("pointermove", py + i * 24);
    send("pointerup", py + 144);
  }, [x, y]);
  await expect.poll(async () => page.locator("[data-row][data-picked]").count()).toBeGreaterThan(1);
});

test("長押しのあいだだけ、送りを止める", async ({ page }) => {
  const box = await list(page).boundingBox();
  const x = box.x + box.width / 2, y = box.y + 80;
  const touchAction = () => list(page).evaluate((el) => getComputedStyle(el).touchAction);
  expect(await touchAction()).not.toBe("none");
  await page.evaluate(async ([px, py]) => {
    const el = document.querySelector("[data-outline-list]");
    el.setPointerCapture = () => {};
    el.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true, cancelable: true, isPrimary: true, pointerId: 5, pointerType: "touch", button: 0, clientX: px, clientY: py,
    }));
    await new Promise((done) => setTimeout(done, 600));
  }, [x, y]);
  expect(await touchAction()).toBe("none");
  await page.evaluate(() => document.querySelector("[data-outline-list]").dispatchEvent(
    new PointerEvent("pointerup", { bubbles: true, isPrimary: true, pointerId: 5, pointerType: "touch" })));
  await expect.poll(touchAction).not.toBe("none");
});
