// ストア用スクリーンショット（1280×800）を、実際に拡張を動かして撮る
// 実行: node tools/shoot-store.js
//   出力: store/screenshots/01-*.png 〜 03-*.png
//   併せて、行数の多い一覧で走査時間を計り、4秒タイムアウトの余裕を表示する
const puppeteer = require("puppeteer-core");
const sharp = require("sharp");
const path = require("path");
const fs = require("fs");
const os = require("os");
const http = require("http");

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const root = path.resolve(__dirname, "..");
const ext = process.env.CWH_EXT_DIR || path.join(root, "src");
const pagesDir = path.join(root, "store", "screenshots", "pages");
const outDir = path.join(root, "store", "screenshots");

const W = 1280, H = 800, HALF = 640;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function servePages() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const name = req.url.split("?")[0].replace(/^\//, "") || "memo.html";
      const file = path.join(pagesDir, name);
      if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(fs.readFileSync(file));
    });
    server.listen(0, () => resolve(server));
  });
}

async function compose(leftPng, rightPng, out, popupPng) {
  const layers = [
    { input: leftPng, left: 0, top: 0 },
    { input: rightPng, left: HALF, top: 0 },
    { input: await sharp({ create: { width: 2, height: H, channels: 4, background: "#c9ced4" } }).png().toBuffer(), left: HALF - 1, top: 0 },
  ];
  if (popupPng) {
    const framed = await sharp(popupPng).extend({ top: 1, bottom: 1, left: 1, right: 1, background: "#b8bec6" }).png().toBuffer();
    const meta = await sharp(framed).metadata();
    // 右下に置く（右ページ上部の一致箇所を隠さないため）
    const left = W - meta.width - 24;
    const top = H - meta.height - 24;
    const shadow = await sharp({ create: { width: meta.width + 24, height: meta.height + 24, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.10 } } }).blur(10).png().toBuffer();
    layers.push({ input: shadow, left: left - 8, top: top - 4 });
    layers.push({ input: framed, left, top });
  }
  await sharp({ create: { width: W, height: H, channels: 4, background: "#ffffff" } }).composite(layers).png().toFile(out);
  console.log("wrote", path.relative(root, out));
}

(async () => {
  const server = await servePages();
  const base = `http://localhost:${server.address().port}`;
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cwh-shoot-"));
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: false, userDataDir, pipe: true, enableExtensions: true,
    args: ["--lang=ja", "--no-first-run", "--no-default-browser-check", "--window-size=1100,900", "--hide-scrollbars"],
    defaultViewport: null,
  });

  try {
    await browser.installExtension(ext);
    let worker = null;
    for (let i = 0; i < 30 && !worker; i++) {
      worker = browser.targets().find((t) => t.type() === "service_worker" && t.url().startsWith("chrome-extension://"));
      if (!worker) await sleep(200);
    }
    const extId = new URL(worker.url()).host;
    const sw = await worker.worker();

    const memo = await browser.newPage();
    await memo.setViewport({ width: HALF, height: H, deviceScaleFactor: 1 });
    await memo.goto(`${base}/memo.html`);

    const right = await browser.newPage();
    await right.setViewport({ width: HALF, height: H, deviceScaleFactor: 1 });

    const popup = await browser.newPage();
    await popup.setViewport({ width: 340, height: 400, deviceScaleFactor: 1 });
    await popup.goto(`chrome-extension://${extId}/popup/popup.html`);

    const select = async (id) => {
      await memo.bringToFront();
      await memo.evaluate((id) => {
        const el = document.getElementById(id);
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
      }, id);
    };
    const clearSel = async () => {
      await memo.bringToFront();
      await memo.evaluate(() => getSelection().removeAllRanges());
      await sleep(700);
    };
    // 選択 → 右ページに mark が出るまでの時間を計る
    const waitMarks = async (page, timeoutMs = 10000) => {
      const t0 = Date.now();
      try {
        await page.waitForFunction(() => document.querySelector("mark.cwh-mark, .cwh-input"), { polling: 50, timeout: timeoutMs });
        return Date.now() - t0;
      } catch (e) {
        return -1;
      }
    };
    const shotPopup = async (height) => {
      await popup.bringToFront();
      await sleep(300);
      return popup.screenshot({ clip: { x: 0, y: 0, width: 340, height } });
    };
    const hits = () => sw.evaluate(async () => (await chrome.storage.session.get("highlightState")).highlightState?.hits || null);

    // ---- 1: 注文メモ → 注文入力フォーム（氏名を選択、完全一致）----
    await right.goto(`${base}/order-form.html`);
    await sleep(500);
    await select("name");
    let ms = await waitMarks(right);
    console.log(`[1] 氏名 → 注文入力: ${ms} ms`);
    await sleep(400);
    const l1 = await memo.screenshot();
    const r1 = await right.screenshot();
    await compose(l1, r1, path.join(outDir, "01-memo-to-order-form.png"));
    await clearSel();

    // ---- 2: 電話番号 → 顧客一覧 200 行（ハイフンあり=完全、なし=表記違い）+ ポップアップ内訳 ----
    await right.goto(`${base}/customers.html?rows=200`);
    await sleep(500);
    await select("phone");
    ms = await waitMarks(right);
    console.log(`[2] 電話 → 顧客一覧 200 行: ${ms} ms`, JSON.stringify(await hits()));
    await sleep(400);
    const l2 = await memo.screenshot();
    const r2 = await right.screenshot();
    const p2 = await shotPopup(270);
    await compose(l2, r2, path.join(outDir, "02-normalized-match-and-breakdown.png"), p2);
    await clearSel();

    // ---- 3: 商品コード（転記ミス）→ 注文入力フォームで 0 件（赤の警告）----
    await right.goto(`${base}/order-form.html`);
    await sleep(500);
    await select("sku");
    await sleep(1500);
    console.log("[3] 商品コード → 0 件:", JSON.stringify(await hits()));
    const l3 = await memo.screenshot();
    const r3 = await right.screenshot();
    const p3 = await shotPopup(300);
    await compose(l3, r3, path.join(outDir, "03-no-match-warning.png"), p3);
    await clearSel();

    // ---- 4秒タイムアウトの余裕: 行数を増やして走査時間を計る ----
    console.log("\n走査時間（選択 → 右ページに mark が出るまで。4秒で判定不能になる）");
    for (const rows of [200, 2000, 5000, 10000]) {
      await right.goto(`${base}/customers.html?rows=${rows}`);
      await sleep(600);
      await select("phone");
      const t = await waitMarks(right, 12000);
      await sleep(300);
      const h = await hits();
      const unknown = h?.unknown?.map((u) => u.reason).join(",") || "-";
      console.log(`  ${String(rows).padStart(6)} 行: ${t < 0 ? "timeout(>12s)" : t + " ms"}  scanned=${h?.scanned} total=${h?.total} unknown=[${unknown}]`);
      await clearSel();
    }
  } catch (e) {
    console.error("ERROR", e);
    process.exitCode = 1;
  } finally {
    await browser.close().catch(() => {});
    server.close();
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  }
})();
