import { test, expect } from "./helpers.js";

// rgb()/rgba() は 0-255、color-mix が返す color(srgb ...) は 0-1。
// 両方を 0-255 に正規化してから合成・比較する。
const CONTRAST_HELPERS = `
  function parseColor(c) {
    if (!c) return null;
    const n = (c.match(/[-\\d.]+/g) || []).map(Number);
    if (c.startsWith("color(")) {
      return { rgb: [n[0] * 255, n[1] * 255, n[2] * 255], a: c.includes("/") ? n[3] : 1 };
    }
    return { rgb: [n[0], n[1], n[2]], a: n.length > 3 ? n[3] : 1 };
  }
  function over(fg, bg) { return fg.rgb.map((v, i) => v * fg.a + bg[i] * (1 - fg.a)); }
  function lum(rgb) {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
  }
  function ratio(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  function effBg(el) {
    const stack = [];
    let cur = el;
    while (cur) {
      const c = parseColor(getComputedStyle(cur).backgroundColor);
      if (c && c.a > 0) { stack.push(c); if (c.a >= 0.999) break; }
      cur = cur.parentElement;
    }
    let base = [255, 255, 255];
    for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i], base);
    return base;
  }
`;

function contrastLadder(page) {
  return page.evaluate(`(() => {
    ${CONTRAST_HELPERS}
    const out = {};
    for (const cls of ["text-neutral-300", "text-neutral-400", "text-neutral-500", "text-neutral-600"]) {
      const el = [...document.querySelectorAll("." + cls)].find((e) => e.textContent.trim().length > 0);
      if (!el) continue;
      const bg = effBg(el);
      out[cls] = Number(ratio(over(parseColor(getComputedStyle(el).color), bg), bg).toFixed(2));
    }
    return out;
  })()`);
}

const rootColors = (page) =>
  page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector(".min-h-screen"));
    return { bg: cs.backgroundColor, color: cs.color };
  });

async function pickTheme(page, title) {
  await page.locator('button[title="Settings"]').click();
  await page.locator(`button[title="${title}"]`).click();
  await page.locator('button[title="Settings"]').click();
}

test.describe("配色", () => {
  test("プリセットを選ぶと背景と文字色が変わり保存される", async ({ page }) => {
    expect(await rootColors(page)).toEqual({ bg: "rgb(10, 10, 10)", color: "rgb(245, 245, 245)" });

    await pickTheme(page, "紙");
    expect(await rootColors(page)).toEqual({ bg: "rgb(250, 249, 247)", color: "rgb(28, 25, 23)" });
    expect(
      JSON.parse(await page.evaluate(() => localStorage.getItem("taskspace-app-theme")))
    ).toEqual({ bg: "#faf9f7", text: "#1c1917" });
  });

  test("既定に戻せる", async ({ page }) => {
    await pickTheme(page, "紺");
    expect((await rootColors(page)).bg).not.toBe("rgb(10, 10, 10)");

    await page.locator('button[title="Settings"]').click();
    await page.getByRole("button", { name: "既定に戻す" }).click();
    expect((await rootColors(page)).bg).toBe("rgb(10, 10, 10)");
  });

  test("明るい配色でも補助文字のコントラストが落ちない", async ({ page }) => {
    const dark = await contrastLadder(page);
    expect(Object.keys(dark).length).toBeGreaterThan(0);

    for (const preset of ["紙", "薄灰", "紺"]) {
      await pickTheme(page, preset);
      const ladder = await contrastLadder(page);
      for (const [cls, value] of Object.entries(dark)) {
        // 既定（暗）の階調から大きく劣化しないこと
        expect(ladder[cls], `${preset} の ${cls}`).toBeGreaterThan(value - 1.6);
      }
    }
  });

  // 反転ボタン（bg-white + text-neutral-950）は既定では開いていないパネル内に
  // あるので、要素を探す代わりに土台の対応関係を確かめる。
  // white=文字色 / neutral-950=背景色 が保たれていれば、どの配色でも反転が成立する。
  test("反転に使う色が背景・文字と対応している", async ({ page }) => {
    for (const preset of ["既定", "紙", "紺"]) {
      await pickTheme(page, preset);
      const v = await page.evaluate(() => {
        const cs = getComputedStyle(document.documentElement);
        const get = (n) => cs.getPropertyValue(n).trim();
        return {
          bg: get("--ts-bg"),
          text: get("--ts-text"),
          white: get("--color-white"),
          n950: get("--color-neutral-950"),
        };
      });
      expect(v.white, `${preset}: --color-white`).toBe(v.text);
      expect(v.n950, `${preset}: --color-neutral-950`).toBe(v.bg);
    }
  });
});
