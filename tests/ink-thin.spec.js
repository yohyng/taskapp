import { test, expect } from "@playwright/test";

// 細いペンで速く書くと、線が画素より細くなって点々に途切れて見えた
// （iPad Pro + Apple Pencil、太さ2）。輪郭を画素1つぶんなぞって塞いである。
// 入力の再現に頼らず、速い線を下書きとして直接置いて描かせる。

const seed = (page, width, straight = false) => page.addInitScript(([w, flat]) => {
  const points = [], times = [];
  for (let i = 0; i <= 320; i++) {
    const wobble = flat ? 0 : Math.sin(i / 3.1) * 0.06 + Math.sin(i * 1.9) * 0.004;
    points.push([0.06 + (i / 320) * 0.88, 0.5 + wobble]);
    times.push(i * 2);   // 2ms ごと＝速い線。ここで細くなる。
  }
  localStorage.setItem("taskspace-quick-sketch-v1", JSON.stringify([
    { color: "#202020", width: w, height: 900, paperWidth: 600, brush: "speed-extreme-v1", times, points },
  ]));
}, [width, straight]);

// 線が通っているはずの範囲で、黒がまったく無い縦の列＝途切れ
const breaks = (page) => page.locator("[data-sketch-canvas]").evaluate((el) => {
  const { data, width, height } = el.getContext("2d").getImageData(0, 0, el.width, el.height);
  const dark = (x, y) => data[(y * width + x) * 4] < 150;
  let empty = 0;
  for (let x = Math.round(width * 0.08); x < Math.round(width * 0.92); x++) {
    let any = false;
    for (let y = 0; y < height && !any; y++) if (dark(x, y)) any = true;
    if (!any) empty += 1;
  }
  return empty;
});

for (const width of [1, 2, 4, 10]) {
  test(`太さ ${width} の速い線が、点々に途切れない`, async ({ page }) => {
    await seed(page, width);
    await page.goto("/sketch.html");
    await page.waitForSelector("[data-sketch-canvas]");
    await expect.poll(() => breaks(page), { timeout: 10000 }).toBe(0);
  });
}

test("太い線の見た目は、塞いでも変わらない", async ({ page }) => {
  await seed(page, 10, true);   // まっすぐな線で、縦に数えれば太さになる
  await page.goto("/sketch.html");
  await page.waitForSelector("[data-sketch-canvas]");
  // 画素1つぶんの縁なので、太さ10の線が太る割合はごくわずか
  // 1本ぶんの太さ＝縦に黒が続いた、いちばん長いところ
  const thickest = await page.locator("[data-sketch-canvas]").evaluate((el) => {
    const { data, width, height } = el.getContext("2d").getImageData(0, 0, el.width, el.height);
    let best = 0;
    for (let x = Math.round(width * 0.1); x < Math.round(width * 0.9); x += 7) {
      let run = 0;
      for (let y = 0; y < height; y++) {
        if (data[(y * width + x) * 4] < 150) { run += 1; best = Math.max(best, run); } else run = 0;
      }
    }
    return best;
  });
  // 紙 600 に対して canvas は 1200（2倍）。太さ10 は 20 画素ぶん。
  // 塞ぐ縁は画素1つぶんなので、ここを大きく超えない。
  expect(thickest).toBeGreaterThan(8);
  expect(thickest).toBeLessThanOrEqual(23);
});
