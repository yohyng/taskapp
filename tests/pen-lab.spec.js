import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function draw(page, pressures) {
  const canvas = page.locator("[data-sketch-canvas]");
  await canvas.scrollIntoViewIfNeeded();
  await canvas.evaluate((element, pressures) => {
    element.setPointerCapture = () => {};
    element.hasPointerCapture = () => false;
    const rect = element.getBoundingClientRect();
    const points = [[0.2, 0.4], [0.22, 0.405], [0.24, 0.395], [0.26, 0.405], [0.28, 0.4]];
    points.forEach(([x, y], i) => {
      const event = new PointerEvent(i === 0 ? "pointerdown" : "pointermove", { bubbles: true, pointerId: 3, pointerType: "pen", isPrimary: true, button: 0, clientX: rect.left + x * rect.width, clientY: rect.top + y * rect.height, pressure: pressures?.[i] ?? 0.5 });
      Object.defineProperty(event, "timeStamp", { value: i * 8 + 1 });
      element.dispatchEvent(event);
    });
    const last = points.at(-1);
    element.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 3, pointerType: "pen", isPrimary: true, button: 0, clientX: rect.left + last[0] * rect.width, clientY: rect.top + last[1] * rect.height, pressure: 0 }));
  }, pressures);
}

test("書き味：現在の線を保ち、粘る線の終点・下書き・PNGを同じ形にする", async ({ page }) => {
  const network = [];
  page.on("request", (request) => { if (/supabase|script.google/.test(request.url())) network.push(request.url()); });
  await page.goto("/pen-lab.html");
  const feel = page.locator("[data-sketch-feel]");
  await expect(feel).toHaveValue("flow");
  await feel.selectOption("raw");
  await draw(page); await page.locator("[data-pen-lab-save]").click();
  const raw = await page.evaluate(() => JSON.parse(localStorage.getItem("fragments-pen-lab-draft")));
  await page.locator("[data-sketch-clear]").click();
  await feel.selectOption("soft");
  await draw(page); await page.locator("[data-pen-lab-save]").click();
  const soft = await page.evaluate(() => JSON.parse(localStorage.getItem("fragments-pen-lab-draft")));
  expect(soft[0].points[1]).not.toEqual(raw[0].points[1]);
  expect(soft[0].points[0]).toEqual(raw[0].points[0]);
  expect(soft[0].points.at(-1)).toEqual(raw[0].points.at(-1));
  const pixels = await page.locator("canvas").evaluate((canvas) => canvas.toDataURL());
  await page.reload(); await expect(feel).toHaveValue("soft");
  await page.locator("[data-pen-lab-restore]").click();
  await expect.poll(() => page.locator("canvas").evaluate((canvas) => canvas.toDataURL())).toBe(pixels);
  const pending = page.waitForEvent("download");
  await page.locator("[data-pen-lab-export]").click();
  const png = await readFile(await (await pending).path());
  expect(`data:image/png;base64,${png.toString("base64")}`).toBe(pixels);
  expect(network).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem("taskspace-outline-v1"))).toBeNull();
});

test("描画の確認：低遅延方式の切替で線を消さず、更新頻度を任意で測る", async ({ page }) => {
  const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/pen-lab.html"); await draw(page);
  const pixels = await page.locator("canvas").evaluate((canvas) => canvas.toDataURL());
  await page.locator("[data-sketch-diagnostics] summary").click();
  await expect(page.locator("[data-sketch-frequency]")).toContainText("約", { timeout: 10000 });
  await page.locator("[data-sketch-low-latency]").check();
  await expect(page.locator("[data-sketch-latency-status]")).toContainText("低遅延の描画：");
  await expect.poll(() => page.locator("canvas").evaluate((canvas) => canvas.toDataURL())).toBe(pixels);
  await page.locator("[data-sketch-low-latency]").uncheck();
  await expect.poll(() => page.locator("canvas").evaluate((canvas) => canvas.toDataURL())).toBe(pixels);
  expect(errors).toEqual([]);
});


for (const style of ["light", "core", "flow"]) test(`${style === "flow" ? "なめらかな芯のある" : style === "core" ? "芯のある" : "軽やかな"}ペン：筆圧と復元・PNGの見た目を保つ`, async ({ page }) => {
  await page.goto("/pen-lab.html");
  await expect(page.locator("[data-sketch-feel]")).toHaveValue("flow");
  await page.locator("[data-sketch-feel]").selectOption(style);
  await expect(page.locator("[data-sketch-pressure]")).toBeChecked();
  await draw(page, [0.02, 0.08, 0.3, 0.6, 0.9]);
  await page.locator("[data-pen-lab-save]").click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("fragments-pen-lab-draft")));
  expect(saved[0].pressureStyle).toBe(style);
  expect(saved[0].points[0][2]).toBeLessThan(0.03);
  expect(saved[0].points.at(-1)[2]).toBeGreaterThan(style === "flow" ? 0.3 : 0.89);
  const pixels = await page.locator("canvas").evaluate((canvas) => canvas.toDataURL());
  await page.reload(); await page.locator("[data-pen-lab-restore]").click();
  await expect.poll(() => page.locator("canvas").evaluate((canvas) => canvas.toDataURL())).toBe(pixels);
  const pending = page.waitForEvent("download");
  await page.locator("[data-pen-lab-export]").click();
  const png = await readFile(await (await pending).path());
  expect(`data:image/png;base64,${png.toString("base64")}`).toBe(pixels);
});


test("直前の筆圧と補正値を端末だけで取り出せる", async ({ page }) => {
  await page.goto("/pen-lab.html");
  await draw(page, [0.05, 0.2, 0.35, 0.25, 0.4]);
  await page.locator("[data-sketch-diagnostics] summary").click();
  await expect(page.locator("[data-sketch-input-trace]")).toContainText("筆圧");
  const pending = page.waitForEvent("download");
  await page.locator("[data-sketch-export-trace]").click();
  const trace = JSON.parse(await readFile(await (await pending).path(), "utf8"));
  expect(trace.version).toBe("1.22.7");
  expect(trace.samples.length).toBeGreaterThan(0);
  expect(trace.samples.length).toBeLessThanOrEqual(4096);
  expect(trace.samples.some((s) => s.raw[2] !== s.filtered[2])).toBe(true);
});
