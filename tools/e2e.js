// Phase 1 完了条件の自動確認
// 実行: node tools/e2e.js [--lang=en]
// 実機の Chrome に src/ を読み込み、2タブ間ハイライト・ポップアップ・多言語を確認する。
const puppeteer = require("puppeteer-core");
const path = require("path");
const fs = require("fs");
const os = require("os");
const http = require("http");

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const root = path.resolve(__dirname, "..");
const ext = process.env.CWH_EXT_DIR || path.join(root, "src"); // package.sh --verify は展開した ZIP を指す
const outDir = path.join(root, "tools", "shots");
fs.mkdirSync(outDir, { recursive: true });

const lang = (process.argv.find((a) => a.startsWith("--lang=")) || "--lang=ja").slice(7);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log((ok ? "PASS" : "FAIL") + "  " + name + (detail ? "  (" + detail + ")" : ""));
};

const htmlA = `
<html lang="ja"><body style="font:16px sans-serif;padding:20px">
<h1>請求書一覧</h1>
<p id="src">請求番号 INV-2026-0042 / 株式会社サンプル / 金額 128,000円</p>
<p>これは選択元のページです。</p>
</body></html>`;

const htmlB = `
<html lang="ja"><body style="font:16px sans-serif;padding:20px">
<h1>伝票</h1>
<p>伝票 No. inv-2026-0042 を確認</p>
<p>ＩＮＶ－２０２６－００４２（全角）</p>
<input id="inp" value="INV-2026-0042">
<div id="ed" contenteditable="true" style="border:1px solid #999;padding:6px">INV-2026-0042 は編集欄</div>
</body></html>`;

// data: URL には content_scripts が入らないので、ローカル HTTP で配信する
function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(req.url.startsWith("/b") ? htmlB : htmlA);
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

(async () => {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const pageA = `${base}/a`;
  const pageB = `${base}/b`;
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cwh-e2e-"));
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: false,
    userDataDir,
    pipe: true,
    enableExtensions: true, // Chrome 137+ は --load-extension 不可。CDP 経由で読み込む
    args: [
      `--lang=${lang}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--window-size=1100,800",
    ],
    defaultViewport: null,
  });

  try {
    // ---- 拡張を読み込み、Service Worker を待つ ----
    const installedId = await browser.installExtension(ext);
    console.log("installed", installedId);
    let worker = null;
    for (let i = 0; i < 30 && !worker; i++) {
      worker = browser.targets().find((t) => t.type() === "service_worker" && t.url().startsWith("chrome-extension://"));
      if (!worker) await sleep(200);
    }
    check("Service Worker が起動する", !!worker);
    const extId = new URL(worker.url()).host;
    const sw = await worker.worker();

    // ---- manifest / i18n ----
    const manifest = await sw.evaluate(() => chrome.runtime.getManifest());
    check("manifest 読み込み（エラーなし）", manifest.version === "3.0.0", "version=" + manifest.version);
    const name = await sw.evaluate(() => chrome.i18n.getMessage("extName"));
    const expectName = lang === "en" ? "Cross-Window Highlight" : "クロスウィンドウ・ハイライト";
    check(`名前が ${lang} で表示される`, name === expectName, name);
    check("manifest の name が __MSG__ から解決される", manifest.name === expectName, manifest.name);

    // ---- 2タブ ----
    const a = await browser.newPage();
    await a.goto(pageA);
    const b = await browser.newPage();
    await b.goto(pageB);
    await a.bringToFront();
    await sleep(500);

    // A で選択
    await a.evaluate(() => {
      const p = document.getElementById("src");
      const range = document.createRange();
      const node = p.firstChild;
      const s = node.nodeValue.indexOf("INV-2026-0042");
      range.setStart(node, s);
      range.setEnd(node, s + "INV-2026-0042".length);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });
    await sleep(900);

    const marks = await b.evaluate(() => [...document.querySelectorAll("mark.cwh-mark")].map((m) => m.textContent));
    check("別タブに mark が付く（半角・小文字）", marks.includes("inv-2026-0042"), JSON.stringify(marks));
    check("全角も一致する", marks.some((m) => m.includes("２０２６")), "");
    const inputMarked = await b.evaluate(() => document.getElementById("inp").classList.contains("cwh-input"));
    check("input は枠で示される", inputMarked);
    const edMarks = await b.evaluate(() => document.querySelectorAll("#ed mark").length);
    check("contenteditable 内は書き換えない", edMarks === 0, "marks in editor=" + edMarks);
    const srcMarks = await a.evaluate(() => document.querySelectorAll("mark.cwh-mark").length);
    check("選択元タブ自身にはハイライトしない", srcMarks === 0);

    await b.screenshot({ path: path.join(outDir, `tabB-highlight-${lang}.png`) });

    // contenteditable での貼り付け（キャレット維持）
    await b.bringToFront();
    await b.click("#ed");
    await b.keyboard.press("End");
    await b.keyboard.type(" 追記");
    await sleep(400);
    const edText = await b.evaluate(() => document.getElementById("ed").textContent);
    check("contenteditable に入力できる", edText.endsWith("追記"), edText);

    // Escape でローカル解除
    await b.keyboard.press("Escape");
    await sleep(200);
    const afterEsc = await b.evaluate(() => document.querySelectorAll("mark.cwh-mark").length);
    check("Escape でそのページのハイライトが消える", afterEsc === 0, "remaining=" + afterEsc);

    // ---- ポップアップ ----
    const popup = await browser.newPage();
    await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
    await sleep(600);
    const popupTitle = await popup.$eval("h1", (h) => h.textContent);
    check("ポップアップのタイトルが多言語化されている", popupTitle === expectName, popupTitle);
    const toggleOn = await popup.$eval("#toggle", (el) => el.checked);
    check("ポップアップのスイッチが ON を示す", toggleOn === true);
    const current = await popup.$eval("#current", (el) => el.textContent);
    check("現在のハイライト文字列が表示される", current === "INV-2026-0042", current);
    const shortcut = await popup.$eval("#shortcut", (el) => el.textContent);
    check("ショートカットが表示される", /Ctrl\+Shift\+H|⌘/.test(shortcut), shortcut);
    await popup.setViewport({ width: 340, height: 560 });
    await popup.screenshot({ path: path.join(outDir, `popup-on-${lang}.png`) });

    // ポップアップで OFF
    await popup.click(".switch");
    await sleep(500);
    const enabled1 = await sw.evaluate(async () => (await chrome.storage.local.get("enabled")).enabled);
    check("ポップアップで OFF にできる", enabled1 === false);
    const badge1 = await sw.evaluate(() => chrome.action.getBadgeText({}));
    check("OFF 時のバッジ", badge1 === "OFF", badge1);
    const statusText = await popup.$eval("#status", (el) => el.textContent);
    check("ポップアップの表示が OFF になる", statusText === "OFF", statusText);
    await popup.screenshot({ path: path.join(outDir, `popup-off-${lang}.png`) });

    // ショートカット相当（commands の onCommand を直接発火できないので setEnabled 相当の経路を確認）
    // background 側で ON に戻し、ポップアップが追従するか
    await sw.evaluate(async () => { await chrome.storage.local.set({ enabled: true }); });
    await sleep(400);
    const toggleAfter = await popup.$eval("#toggle", (el) => el.checked);
    check("外部（ショートカット等）で ON に戻るとポップアップも追従", toggleAfter === true);

    // トースト文言（content 側 i18n）: ON→OFF 変化でトーストが出る
    await a.bringToFront();
    await sw.evaluate(async () => { await chrome.storage.local.set({ enabled: false }); });
    await sleep(300);
    const toastText = await a.evaluate(() => document.getElementById("cwh-toast")?.textContent || "");
    const expectToast = lang === "en" ? "Highlight OFF" : "ハイライト OFF";
    check("トースト文言が多言語化されている", toastText === expectToast, toastText);
    await sw.evaluate(async () => { await chrome.storage.local.set({ enabled: true }); });

    // 休止タブ除外: 実際の discard は environment 依存なので、コードの存在のみ確認
    const bgSrc = fs.readFileSync(path.join(ext, "background.js"), "utf8");
    check("休止タブ（discarded）を除外している", (bgSrc.match(/tab\.discarded/g) || []).length === 2);
    check("action.onClicked が削除されている", !bgSrc.includes("chrome.action.onClicked"));
  } catch (e) {
    console.error("ERROR", e);
    results.push({ name: "例外", ok: false, detail: String(e) });
  } finally {
    await browser.close().catch(() => {});
    server.close();
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  }

  const fail = results.filter((r) => !r.ok);
  console.log(`\n${results.length - fail.length}/${results.length} passed`);
  process.exit(fail.length ? 1 : 0);
})();
