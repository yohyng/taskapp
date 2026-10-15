import { test, expect } from "./helpers.js";

const openSettings = (page) =>
  page.locator('button[title="Columns / Category Settings"], button[title*="Settings"]').first().click();
const wake = (page) => page.locator('[data-keep-awake="wake"]');
const pip = (page) => page.locator('[data-keep-awake="pip"]');

// Wake Lock と PiP の有無は機械によって違うので、テストでは作って差し替える。
// addInitScript は関数を文字列にして送るので、外の値は引数で渡す。
const fakeWakeLock = (ok) => window.navigator && Object.defineProperty(navigator, "wakeLock", {
  configurable: true,
  value: { request: async () => {
    if (!ok) throw new Error("denied");
    return { release: async () => {}, addEventListener: () => {} };
  } },
});
// hasWakeLock は "wakeLock" in navigator で見るので、鍵ごと外す
const noWakeLock = () => { delete Navigator.prototype.wakeLock; };
const fakePip = (ok) => {
  Object.defineProperty(document, "pictureInPictureEnabled", { configurable: true, value: true });
  HTMLVideoElement.prototype.play = async function () {};
  HTMLVideoElement.prototype.requestPictureInPicture = ok
    ? async function () { Object.defineProperty(document, "pictureInPictureElement", { configurable: true, value: this }); }
    : async function () { throw new Error("denied"); };
  document.exitPictureInPicture = async () => {};
};

// scripts は [関数, 引数] の組
const boot = async (page, ...scripts) => {
  for (const [fn, arg] of scripts) await page.addInitScript(fn, arg);
  await page.reload();
  await page.waitForSelector("header");
  await openSettings(page);
};

test.describe("画面を保たせる設定", () => {
  test("設定の中にあり、上の帯には出ていない", async ({ page }) => {
    await expect(page.locator("header [data-keep-awake]")).toHaveCount(0);
    await boot(page, [fakeWakeLock, true], [fakePip, true]);
    await expect(wake(page)).toContainText("画面を自動でスリープさせない");
    await expect(pip(page)).toContainText("小窓");
  });

  test("小窓は、スリープ防止と別に出せる", async ({ page }) => {
    await boot(page, [fakeWakeLock, true], [fakePip, true]);
    await pip(page).click();
    await expect(pip(page)).toContainText("ON");
    // もう片方は触らない
    await expect(wake(page)).toContainText("OFF");

    await pip(page).click();
    await expect(pip(page)).toContainText("OFF");
  });

  test("スリープ防止だけでも入れられる", async ({ page }) => {
    await boot(page, [fakeWakeLock, true], [fakePip, true]);
    await wake(page).click();
    await expect(wake(page)).toContainText("ON");
    await expect(pip(page)).toContainText("OFF");
  });

  test("小窓しか使えない機械では、小窓だけ出す", async ({ page }) => {
    // wakeLock を持たない機械のふり
    await boot(page, [noWakeLock, null], [fakePip, true]);
    await expect(wake(page)).toHaveCount(0);
    await expect(pip(page)).toBeVisible();
  });

  test("出せなかったときは、できなかったと出す", async ({ page }) => {
    await boot(page, [fakeWakeLock, false], [fakePip, false]);
    await wake(page).click();
    await expect(wake(page)).toContainText("できなかった");
    await pip(page).click();
    await expect(pip(page)).toContainText("できなかった");
  });
});

// 小窓そのものは、動かしている機械が対応していないと試せない。
// ただし「映像が始まらずに断られる」という失敗は、本物のキャンバスで再現できる。
test.describe("小窓に出す映像", () => {
  test("映像が始まってから小窓を頼む", async ({ page }) => {
    await page.addInitScript(() => {
      window.__pipCalls = [];
      Object.defineProperty(document, "pictureInPictureEnabled", { configurable: true, value: true });
      // 本物の video / captureStream のまま、小窓に上げるところだけ差し替える
      HTMLVideoElement.prototype.requestPictureInPicture = async function () {
        window.__pipCalls.push({ w: this.videoWidth, h: this.videoHeight, paused: this.paused });
        Object.defineProperty(document, "pictureInPictureElement", { configurable: true, value: this });
      };
      document.exitPictureInPicture = async () => {};
    });
    await page.reload();
    await page.waitForSelector("header");
    await openSettings(page);

    await pip(page).click();
    await expect(pip(page)).toContainText("ON");

    // 中身のある映像を渡せていること（真っ白なまま頼むと実機では断られる）
    const calls = await page.evaluate(() => window.__pipCalls);
    expect(calls).toHaveLength(1);
    expect(calls[0].w).toBeGreaterThan(0);
    expect(calls[0].h).toBeGreaterThan(0);
    expect(calls[0].paused).toBe(false);
  });

  test("断られたら、その理由をそのまま出す", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(document, "pictureInPictureEnabled", { configurable: true, value: true });
      HTMLVideoElement.prototype.requestPictureInPicture = async () => {
        throw new Error("Document not focused");
      };
    });
    await page.reload();
    await page.waitForSelector("header");
    await openSettings(page);

    await pip(page).click();
    await expect(pip(page)).toContainText("できなかった");
    await expect(page.getByText("出せませんでした：Document not focused")).toBeVisible();
  });
});

test.describe("入れたままにしておける", () => {
  test("スリープ防止は、読み直しても入ったまま", async ({ page }) => {
    await boot(page, [fakeWakeLock, true], [fakePip, true]);
    await wake(page).click();
    await expect(wake(page)).toContainText("ON");

    await page.reload();
    await page.waitForSelector("header");
    await openSettings(page);
    await expect(wake(page)).toContainText("ON");
  });

  test("切ったら、読み直しても切れたまま", async ({ page }) => {
    await boot(page, [fakeWakeLock, true], [fakePip, true]);
    await wake(page).click();
    await wake(page).click();
    await expect(wake(page)).toContainText("OFF");

    await page.reload();
    await page.waitForSelector("header");
    await openSettings(page);
    await expect(wake(page)).toContainText("OFF");
  });

  test("読み直したあと、画面を保つのを自分で取り直す", async ({ page }) => {
    await page.addInitScript(() => {
      window.__wakeRequests = 0;
      Object.defineProperty(navigator, "wakeLock", {
        configurable: true,
        value: { request: async () => { window.__wakeRequests++; return { release: async () => {}, addEventListener: () => {} }; } },
      });
      localStorage.setItem("taskspace-keep-awake", "1");
    });
    await page.reload();
    await page.waitForSelector("header");
    // 設定を開かなくても、読み込んだ時点で取りにいく
    await expect.poll(() => page.evaluate(() => window.__wakeRequests)).toBeGreaterThan(0);
  });
});

test.describe("設定を閉じても続く", () => {
  test("小窓を出したまま設定を閉じても、消えない", async ({ page }) => {
    await page.addInitScript(() => {
      window.__exits = 0;
      Object.defineProperty(document, "pictureInPictureEnabled", { configurable: true, value: true });
      HTMLVideoElement.prototype.requestPictureInPicture = async function () {
        Object.defineProperty(document, "pictureInPictureElement", { configurable: true, value: this });
      };
      document.exitPictureInPicture = async () => { window.__exits++; };
    });
    await page.reload();
    await page.waitForSelector("header");
    await openSettings(page);
    await pip(page).click();
    await expect(pip(page)).toContainText("ON");

    await openSettings(page);                     // パネルを閉じる
    await expect(pip(page)).toHaveCount(0);
    await openSettings(page);                     // 開き直す
    await expect(pip(page)).toContainText("ON");  // 出たまま
    expect(await page.evaluate(() => window.__exits)).toBe(0);
  });
});

test.describe("押した勢いが切れないこと", () => {
  // 小窓は「押した直後」でないと開けない。await を挟むと資格が切れて
  // "not triggered by a user activation" で断られる。
  test("頼むときに、まだ操作直後とみなされている", async ({ page }) => {
    await page.addInitScript(() => {
      window.__activeAtRequest = null;
      window.__sameTask = null;
      // クリックと同じ回のうちだけ立っている旗。次の回には倒れる。
      window.addEventListener("click", () => {
        window.__inClickTask = true;
        setTimeout(() => { window.__inClickTask = false; }, 0);
      }, true);
      Object.defineProperty(document, "pictureInPictureEnabled", { configurable: true, value: true });
      HTMLVideoElement.prototype.requestPictureInPicture = async function () {
        // 実機が見ているのはここ。false だと user activation 切れで断られる。
        window.__activeAtRequest = navigator.userActivation?.isActive ?? null;
        window.__sameTask = !!window.__inClickTask;
        Object.defineProperty(document, "pictureInPictureElement", { configurable: true, value: this });
      };
      document.exitPictureInPicture = async () => {};
    });
    await page.reload();
    await page.waitForSelector("header");
    await openSettings(page);
    await pip(page).click();
    await expect(pip(page)).toContainText("ON");

    expect(await page.evaluate(() => window.__activeAtRequest)).toBe(true);
    // 押した回のうちに頼んでいること。間に待ちを挟むと、実機では資格が切れる。
    expect(await page.evaluate(() => window.__sameTask)).toBe(true);
  });

  test("映像は、押す前から用意してある", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(document, "pictureInPictureEnabled", { configurable: true, value: true });
      HTMLVideoElement.prototype.requestPictureInPicture = async function () {};
    });
    await page.reload();
    await page.waitForSelector("header");
    await openSettings(page);
    // 設定を開いた時点で、流れている映像がある
    await expect.poll(() => page.evaluate(() =>
      [...document.querySelectorAll("video")].some((v) => v.videoWidth > 0))).toBe(true);
  });
});

test.describe("作った映像を断る機械でも出せる", () => {
  // Safari は canvas から作った映像を小窓に出せず、
  // 「この映像は小窓に対応していない」と断ってくる。
  const refuseStream = () => {
    Object.defineProperty(document, "pictureInPictureEnabled", { configurable: true, value: true });
    window.__pipSources = [];
    HTMLVideoElement.prototype.requestPictureInPicture = async function () {
      const isClip = !!this.src && !this.srcObject;
      window.__pipSources.push(isClip ? "clip" : "stream");
      if (!isClip) throw new Error("The video element does not support the Picture-in-Picture mode");
      Object.defineProperty(document, "pictureInPictureElement", { configurable: true, value: this });
    };
    document.exitPictureInPicture = async () => {};
  };

  test("断られたら、小さな動画に乗り換えて出す", async ({ page }) => {
    await page.addInitScript(refuseStream);
    await page.reload();
    await page.waitForSelector("header");
    await openSettings(page);

    await pip(page).click();
    await expect(pip(page)).toContainText("ON");
    expect(await page.evaluate(() => window.__pipSources)).toEqual(["stream", "clip"]);
  });

  test("どうやっても駄目な機械では、代わりの手を案内する", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(document, "pictureInPictureEnabled", { configurable: true, value: true });
      HTMLVideoElement.prototype.requestPictureInPicture = async function () {
        throw new Error("The video element does not support the Picture-in-Picture mode");
      };
    });
    await page.addInitScript(fakeWakeLock, true);
    await page.reload();
    await page.waitForSelector("header");
    await openSettings(page);

    await pip(page).click();
    // 英語のまま出し続けず、できないことを伝える
    await expect(page.locator("[data-pip-unavailable]")).toBeVisible();
    await expect(pip(page)).toHaveCount(0);
    // 代わりにスリープ防止を入れておく
    await expect(wake(page)).toContainText("ON");
  });

  test("できないと分かったら、次からボタンを出さない", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(document, "pictureInPictureEnabled", { configurable: true, value: true });
      HTMLVideoElement.prototype.requestPictureInPicture = async function () {
        throw new Error("The video element does not support the Picture-in-Picture mode");
      };
    });
    await page.reload();
    await page.waitForSelector("header");
    await openSettings(page);
    await pip(page).click();
    await expect(page.locator("[data-pip-unavailable]")).toBeVisible();

    await page.reload();
    await page.waitForSelector("header");
    await openSettings(page);
    await expect(page.locator("[data-pip-unavailable]")).toBeVisible();
    await expect(pip(page)).toHaveCount(0);
  });

  test("それ以外の理由なら、理由をそのまま出す", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(document, "pictureInPictureEnabled", { configurable: true, value: true });
      HTMLVideoElement.prototype.requestPictureInPicture = async function () {
        throw new Error("Document not focused");
      };
    });
    await page.reload();
    await page.waitForSelector("header");
    await openSettings(page);

    await pip(page).click();
    await expect(page.getByText("出せませんでした：Document not focused")).toBeVisible();
    // こちらは直せる見込みがあるので、ボタンは残す
    await expect(pip(page)).toBeVisible();
  });

  test("小さな動画は、どちらの形でも置いてある", async ({ page }) => {
    for (const name of ["keep-awake.mp4", "keep-awake.webm"]) {
      const res = await page.request.get(`/${name}`);
      expect(res.status(), name).toBe(200);
      expect(Number(res.headers()["content-length"] || 1), name).toBeGreaterThan(500);
    }
  });
});

// iPad は Chrome でも中身が WebKit。標準の API を名乗っていても
// 作った映像は断られるので、昔からの webkit のやり方＋小さな動画を使う。
test.describe("iPad のような機械", () => {
  const asWebKit = () => {
    window.__calls = [];
    // 標準の API も名乗っているが、作った映像は断る（WebKit の挙動）
    Object.defineProperty(document, "pictureInPictureEnabled", { configurable: true, value: true });
    HTMLVideoElement.prototype.requestPictureInPicture = async function () {
      window.__calls.push("standard");
      throw new Error("The video element does not support the Picture-in-Picture mode");
    };
    HTMLVideoElement.prototype.webkitSupportsPresentationMode = function (m) { return m === "picture-in-picture"; };
    HTMLVideoElement.prototype.webkitSetPresentationMode = function (m) {
      window.__calls.push(`webkit:${m}:${this.src ? "clip" : "stream"}`);
      this.webkitPresentationMode = m;
    };
  };

  test("webkit のやり方で、小さな動画を小窓に出す", async ({ page }) => {
    await page.addInitScript(asWebKit);
    await page.reload();
    await page.waitForSelector("header");
    await openSettings(page);

    await pip(page).click();
    await expect(pip(page)).toContainText("ON");

    // 標準の API は使わず、はじめから webkit ＋ 動画ファイル
    expect(await page.evaluate(() => window.__calls)).toEqual(["webkit:picture-in-picture:clip"]);
  });

  test("閉じると OFF に戻る", async ({ page }) => {
    await page.addInitScript(asWebKit);
    await page.reload();
    await page.waitForSelector("header");
    await openSettings(page);
    await pip(page).click();
    await expect(pip(page)).toContainText("ON");

    await page.evaluate(() => {
      const v = [...document.querySelectorAll("video")].at(-1);
      v.webkitPresentationMode = "inline";
      v.dispatchEvent(new Event("webkitpresentationmodechanged"));
    });
    await expect(pip(page)).toContainText("OFF");
  });
});
