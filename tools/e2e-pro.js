// Phase 3 完了条件の自動確認（Pro 機能とライセンス）
// 実行: node tools/e2e-pro.js
//
// Polar の customer-portal ライセンス API を、OpenAPI 仕様どおりの形で返す
// モックサーバーを立てて、拡張の license.js をそこへ向ける（cwh_dev 上書き）。
// 併せて「ライセンス検証以外の通信が発生しない」ことをモック側の記録で確認する。
const puppeteer = require("puppeteer-core");
const path = require("path");
const fs = require("fs");
const os = require("os");
const http = require("http");
const crypto = require("crypto");

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const root = path.resolve(__dirname, "..");
const ext = path.join(root, "src");
const outDir = path.join(root, "tools", "shots");
fs.mkdirSync(outDir, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log((ok ? "PASS" : "FAIL") + "  " + name + (detail ? "  (" + detail + ")" : ""));
};

// ---------------------------------------------------------------- モック Polar
const ORG = "11111111-2222-4333-8444-555555555555";
const keys = {
  "VALID-KEY-0001": { status: "granted", limit: 2, activations: [] },
  "FULL-KEY-0002": { status: "granted", limit: 1, activations: [{ id: crypto.randomUUID(), label: "other pc" }] },
  "NOLIMIT-KEY-0003": { status: "granted", limit: null, activations: [] },
  "REVOKED-KEY-0004": { status: "revoked", limit: 2, activations: [] },
};
const requestLog = [];

function licenseBody(key, k, activation) {
  return {
    id: crypto.randomUUID(), created_at: new Date().toISOString(), modified_at: null,
    organization_id: ORG, customer_id: crypto.randomUUID(),
    customer: { id: crypto.randomUUID(), email: "test@example.com" },
    benefit_id: crypto.randomUUID(), key, display_key: "****" + key.slice(-4),
    status: k.status, limit_activations: k.limit, usage: 0, limit_usage: null,
    validations: 1, last_validated_at: new Date().toISOString(), expires_at: null,
    activation: activation || null,
  };
}

function startMock() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        let body = {};
        try { body = JSON.parse(raw || "{}"); } catch (e) { /* ignore */ }
        requestLog.push({ method: req.method, url: req.url, body });
        const json = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(obj === undefined ? "" : JSON.stringify(obj)); };

        if (req.url === "/__admin/revoke") { keys[body.key].status = "revoked"; return json(200, { ok: true }); }
        if (req.url === "/__admin/grant") { keys[body.key].status = "granted"; return json(200, { ok: true }); }

        const m = req.url.match(/^\/v1\/customer-portal\/license-keys\/(activate|validate|deactivate)$/);
        if (!m || req.method !== "POST") return json(404, { error: "ResourceNotFound", detail: "Not Found" });
        if (body.organization_id !== ORG) return json(404, { error: "ResourceNotFound", detail: "License key not found." });
        const k = keys[body.key];
        if (!k) return json(404, { error: "ResourceNotFound", detail: "License key not found." });

        if (m[1] === "activate") {
          if (k.limit === null || k.activations.length >= k.limit) {
            return json(403, { error: "NotPermitted", detail: "License key activation not supported or limit reached." });
          }
          const act = { id: crypto.randomUUID(), license_key_id: crypto.randomUUID(), label: body.label, meta: body.meta || {}, created_at: new Date().toISOString(), modified_at: null };
          k.activations.push(act);
          return json(200, { ...act, license_key: licenseBody(body.key, k, null) });
        }
        if (m[1] === "validate") {
          let act = null;
          if (body.activation_id) {
            act = k.activations.find((a) => a.id === body.activation_id);
            if (!act) return json(404, { error: "ResourceNotFound", detail: "License key activation not found." });
          }
          return json(200, licenseBody(body.key, k, act));
        }
        if (m[1] === "deactivate") {
          const i = k.activations.findIndex((a) => a.id === body.activation_id);
          if (i < 0) return json(404, { error: "ResourceNotFound", detail: "License key activation not found." });
          k.activations.splice(i, 1);
          return json(204);
        }
      });
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

// ---------------------------------------------------------------- テストページ
const htmlA = `<html lang="ja"><body style="font:16px sans-serif;padding:20px">
<h1>請求書一覧</h1>
<p id="src">請求番号 INV-2026-0042 / 株式会社サンプル / 金額 128,000円</p>
<p id="multi">INV-2026-0042, サンプル</p>
<p id="one">票</p>
</body></html>`;
const htmlB = `<html lang="ja"><head><title>伝票 No.42</title></head><body style="font:16px sans-serif;padding:20px">
<h1>伝票</h1>
<p>伝票 No. inv-2026-0042 を確認</p>
<p>株式会社サンプル の伝票</p>
<p id="exact">完全一致 INV-2026-0042</p>
<input id="inp" value="INV-2026-0042">
<iframe id="fr" src="/c" style="width:400px;height:80px"></iframe>
</body></html>`;
const htmlC = `<html lang="ja"><body style="font:14px sans-serif">iframe の中: INV-2026-0042</body></html>`;
const htmlD = `<html lang="ja"><body style="font:14px sans-serif"><h1>何も一致しないページ</h1><p>ここには請求番号がありません。</p></body></html>`;

function servePages() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(req.url.startsWith("/b") ? htmlB : req.url.startsWith("/c") ? htmlC : req.url.startsWith("/d") ? htmlD : htmlA);
    });
    // A は localhost、B は 127.0.0.1 で配信して、除外ドメインの判定を片側だけに効かせられるようにする
    server.listen(0, () => resolve(server));
  });
}

// ---------------------------------------------------------------- 本体
(async () => {
  const mock = await startMock();
  const mockBase = `http://127.0.0.1:${mock.address().port}`;
  const pages = await servePages();
  const base = `http://127.0.0.1:${pages.address().port}`;
  const baseLocal = `http://localhost:${pages.address().port}`;

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cwh-e2e-pro-"));
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: false, userDataDir, pipe: true, enableExtensions: true,
    args: ["--lang=ja", "--no-first-run", "--no-default-browser-check", "--window-size=1100,800"],
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
    await sw.evaluate(async (apiBase, organizationId) => {
      await chrome.storage.local.set({ cwh_dev: { apiBase, organizationId } });
    }, mockBase, ORG);

    const a = await browser.newPage(); await a.goto(`${baseLocal}/a`);
    const b = await browser.newPage(); await b.goto(`${base}/b`);
    const popup = await browser.newPage();
    await popup.setViewport({ width: 340, height: 900 });
    await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
    await sleep(600);

    const selectIn = async (page, id, text) => {
      await page.bringToFront();
      await page.evaluate((id, text) => {
        const node = document.getElementById(id).firstChild;
        const s = node.nodeValue.indexOf(text);
        const range = document.createRange();
        range.setStart(node, s); range.setEnd(node, s + text.length);
        const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
      }, id, text);
      await sleep(900);
    };
    const clearSel = async (page) => {
      await page.bringToFront();
      await page.evaluate(() => getSelection().removeAllRanges());
      await sleep(700);
    };
    const marksIn = (page) => page.evaluate(() => [...document.querySelectorAll("mark.cwh-mark")].map((m) => m.className + ":" + m.textContent));
    const markBg = (page) => page.evaluate(() => { const m = document.querySelector("mark.cwh-mark:not(.cwh-norm)"); return m ? getComputedStyle(m).backgroundColor : null; });
    const setSettings = async (obj) => { await sw.evaluate(async (o) => { await cwhSaveSettings(o); }, obj); await sleep(500); };
    const license = () => sw.evaluate(async () => (await chrome.storage.local.get("cwh_license")).cwh_license || null);
    const badge = () => sw.evaluate(() => chrome.action.getBadgeText({}));

    // ---- 無効時: 設定を入れても効かない（Phase 1 と同じ挙動）----
    check("初期状態: ポップアップの Pro がロック", await popup.$eval("#settings", (f) => f.disabled) === true);
    await setSettings({ markColor: "#ff0000", minLen: 1, multiKeyword: true, hitBadge: true, iframes: true, excludedDomains: ["127.0.0.1"] });
    await selectIn(a, "src", "INV-2026-0042");
    let marks = await marksIn(b);
    check("無効時: 除外ドメイン設定が効かない（ハイライトされる）", marks.length === 2, JSON.stringify(marks));
    check("無効時: 色設定が効かない（デフォルト色）", (await markBg(b)) === "rgb(255, 229, 138)", await markBg(b));

    // ---- 完全一致 / 正規化一致（無料版でも色分けされる）----
    check("完全一致の mark には cwh-norm が付かない", marks.includes("cwh-mark:INV-2026-0042"), JSON.stringify(marks));
    check("正規化一致の mark に cwh-norm が付く", marks.includes("cwh-mark cwh-norm:inv-2026-0042"), JSON.stringify(marks));
    const normTitle = await b.evaluate(() => document.querySelector("mark.cwh-norm")?.title || "");
    check("正規化一致の mark に title で説明が付く", normTitle.includes("表記の違い"), normTitle);
    const normBg = await b.evaluate(() => getComputedStyle(document.querySelector("mark.cwh-norm")).backgroundColor);
    check("正規化一致は別色（デフォルト #ffd8a8）", normBg === "rgb(255, 216, 168)", normBg);
    const inpNorm = await b.evaluate(() => document.getElementById("inp").classList.contains("cwh-input-norm"));
    check("input の完全一致には破線が付かない", inpNorm === false);
    await popup.bringToFront(); await sleep(300);
    const hitsText = await popup.$eval("#hits", (el) => el.textContent);
    check("ポップアップに内訳（完全 2 / 表記違い 1）", hitsText.includes("完全 2") && hitsText.includes("表記違い 1"), hitsText);
    check("一致ありのときは警告を出さない", await popup.$eval("#hits-warn", (el) => el.hidden) === true);
    await popup.screenshot({ path: path.join(outDir, "popup-hits-breakdown.png") });
    check("無効時: バッジは ON のまま", (await badge()) === "ON", await badge());
    const frMarks0 = await b.evaluate(() => document.getElementById("fr").contentDocument.querySelectorAll("mark.cwh-mark").length);
    check("無効時: iframe 内はハイライトしない", frMarks0 === 0, "frame marks=" + frMarks0);
    await clearSel(a);
    await selectIn(a, "one", "票");
    check("無効時: 1文字は送られない（最小2文字）", (await marksIn(b)).length === 0);
    await clearSel(a);
    await selectIn(a, "multi", "INV-2026-0042, サンプル");
    marks = await marksIn(b);
    check("無効時: 複数語に分割されない（1語扱いで一致なし）", marks.length === 0, JSON.stringify(marks));
    await clearSel(a);
    await setSettings({});

    // ---- ライセンス: 無効キー ----
    const activate = async (key) => {
      await popup.bringToFront();
      await popup.$eval("#license-key", (el, k) => { el.value = k; }, key);
      await popup.click("#license-activate");
      await sleep(800);
      return popup.$eval("#license-msg", (el) => el.textContent);
    };
    let m1 = await activate("WRONG-KEY");
    check("無効なキー → エラー表示", m1.includes("無効"), m1);
    check("無効なキーは保存されない", (await license()) === null);

    m1 = await activate("FULL-KEY-0002");
    check("上限到達キー → 端末数上限の表示", m1.includes("上限"), m1);

    m1 = await activate("REVOKED-KEY-0004");
    check("失効キー → 無効化の表示", m1.includes("無効化") || m1.includes("無効"), m1);
    check("Pro はロックのまま", await popup.$eval("#settings", (f) => f.disabled) === true);

    // ---- ライセンス: 有効キー ----
    m1 = await activate("VALID-KEY-0001");
    check("有効なキー → 認証成功", m1.includes("認証しました"), m1);
    let lic = await license();
    check("activation_id が保存される", !!lic?.activationId && lic.valid === true);
    check("Pro 設定が有効化される", await popup.$eval("#settings", (f) => f.disabled) === false);
    check("キー本体はポップアップに出ない", (await popup.$eval("#license-tail", (el) => el.textContent)) === "…0001");
    await popup.screenshot({ path: path.join(outDir, "popup-pro-active.png") });

    // ---- Pro 1: 色 ----
    await setSettings({ markColor: "#ff0000", inputColor: "#0000ff" });
    await selectIn(a, "src", "INV-2026-0042");
    check("Pro: ハイライト色が変わる", (await markBg(b)) === "rgb(255, 0, 0)", await markBg(b));
    const inpOutline = await b.evaluate(() => getComputedStyle(document.getElementById("inp")).outlineColor);
    check("Pro: 入力欄の枠色が変わる", inpOutline === "rgb(0, 0, 255)", inpOutline);
    await clearSel(a);

    // ---- Pro 2: 最小文字数 ----
    await setSettings({ minLen: 1 });
    await selectIn(a, "one", "票");
    marks = await marksIn(b);
    check("Pro: 最小文字数 1 で1文字がハイライトされる", marks.some((m) => m.endsWith(":票")), JSON.stringify(marks));
    await clearSel(a);

    // ---- Pro 3: 除外ドメイン ----
    await setSettings({ excludedDomains: ["127.0.0.1"] });
    await selectIn(a, "src", "INV-2026-0042");
    check("Pro: 除外ドメインではハイライトされない", (await marksIn(b)).length === 0);
    await clearSel(a);
    await setSettings({});

    // ---- Pro 4: ヒット件数バッジ ----
    await setSettings({ hitBadge: true });
    await selectIn(a, "src", "INV-2026-0042");
    let bt = await badge();
    check("Pro: バッジにヒット件数（完全+表記違い）", bt === "2+1", bt);
    await clearSel(a);
    bt = await badge();
    check("Pro: 解除後はバッジが ON に戻る", bt === "ON", bt);
    await setSettings({});

    // ---- Pro 5: 複数キーワード ----
    await setSettings({ multiKeyword: true });
    await selectIn(a, "multi", "INV-2026-0042, サンプル");
    marks = await marksIn(b);
    check("Pro: 複数語がそれぞれハイライトされる", marks.some((m) => m.endsWith(":inv-2026-0042")) && marks.some((m) => m.endsWith(":サンプル")), JSON.stringify(marks));
    check("Pro: 2語目は別色クラス", marks.some((m) => m.startsWith("cwh-mark cwh-mark-1:")), JSON.stringify(marks));
    await clearSel(a);
    await selectIn(a, "src", "INV-2026-0042");
    marks = await marksIn(b);
    check("Pro: 複数語 ON でも1語なら従来どおり", marks.length === 2 && marks.includes("cwh-mark cwh-norm:inv-2026-0042") && marks.includes("cwh-mark:INV-2026-0042"), JSON.stringify(marks));
    await clearSel(a);
    await setSettings({});

    // ---- Pro 6: iframe ----
    await setSettings({ iframes: true });
    await selectIn(a, "src", "INV-2026-0042");
    const frMarks = await b.evaluate(() => document.getElementById("fr").contentDocument.querySelectorAll("mark.cwh-mark").length);
    check("Pro: iframe 内もハイライトされる", frMarks === 1, "frame marks=" + frMarks);
    await clearSel(a);
    await setSettings({});

    // ---- Pro: 厳密比較モード ----
    await setSettings({ strictMatch: true, hitBadge: true });
    await selectIn(a, "src", "INV-2026-0042");
    marks = await marksIn(b);
    check("Pro: 厳密比較では完全一致だけ", marks.length === 1 && marks[0] === "cwh-mark:INV-2026-0042", JSON.stringify(marks));
    bt = await badge();
    check("Pro: 厳密比較のバッジは完全一致の件数のみ", bt === "2", bt);
    await clearSel(a);
    await setSettings({ strictMatch: true, multiKeyword: true });
    await selectIn(a, "multi", "INV-2026-0042, サンプル");
    marks = await marksIn(b);
    check("Pro: 厳密比較 + 複数語でも完全一致だけ", marks.includes("cwh-mark:INV-2026-0042") && marks.includes("cwh-mark cwh-mark-1:サンプル") && !marks.some((m) => m.includes("cwh-norm")), JSON.stringify(marks));
    await clearSel(a);
    await setSettings({});

    // ---- Pro: 表記違い一致の色 ----
    await setSettings({ normColor: "#00ff00" });
    await selectIn(a, "src", "INV-2026-0042");
    const normBg2 = await b.evaluate(() => getComputedStyle(document.querySelector("mark.cwh-norm")).backgroundColor);
    check("Pro: 表記違い一致の色を変えられる", normBg2 === "rgb(0, 255, 0)", normBg2);
    const exactBg2 = await b.evaluate(() => getComputedStyle(document.querySelector("mark.cwh-mark:not(.cwh-norm)")).backgroundColor);
    check("Pro: 完全一致の色は変わらない", exactBg2 === "rgb(255, 229, 138)", exactBg2);
    await clearSel(a);
    await setSettings({});

    // ---- 判定不能のみ（除外ドメイン + chrome:// ページ）----
    const v = await browser.newPage(); await v.goto("chrome://version/");
    await setSettings({ hitBadge: true, excludedDomains: ["127.0.0.1"] });
    await selectIn(a, "src", "INV-2026-0042");
    bt = await badge();
    check("判定不能のみ: バッジは灰色の ?", bt === "?", bt);
    await popup.bringToFront(); await sleep(300);
    let warnText = await popup.$eval("#hits-warn", (el) => (el.hidden ? "" : el.textContent));
    check("判定不能のみ: 「確認できるタブがありません」", warnText.includes("確認できるタブがありません"), warnText);
    check("判定不能のみ: 赤（bad）にしない", await popup.$eval("#hits-warn", (el) => el.classList.contains("bad")) === false);
    let unknownItems = await popup.$$eval("#unknown-list li", (els) => els.map((e) => e.textContent));
    check("判定不能タブ一覧に理由が出る", unknownItems.some((t) => t.includes("除外ドメイン")) && unknownItems.some((t) => t.includes("拡張が動作しないページ")), JSON.stringify(unknownItems));
    check("判定不能タブ一覧に URL を出さない", !unknownItems.some((t) => t.includes("127.0.0.1") || t.includes("http") || t.includes("chrome://")), JSON.stringify(unknownItems));
    check("判定不能タブ一覧はタイトルを出す", unknownItems.some((t) => t.includes("伝票")), JSON.stringify(unknownItems));
    await clearSel(a);

    // ---- 判定不能と一致 0 の混在 ----
    const d = await browser.newPage(); await d.goto(`${baseLocal}/d`);
    await selectIn(a, "src", "INV-2026-0042");
    bt = await badge();
    check("混在: 走査できたタブで 0 件なら赤の 0", bt === "0", bt);
    await popup.bringToFront(); await sleep(300);
    warnText = await popup.$eval("#hits-warn", (el) => (el.hidden ? "" : el.textContent));
    check("混在: 「一致なし」と「一部確認できず（2件）」を併記", warnText.includes("一致はありません") && warnText.includes("2件"), warnText);
    check("混在: 赤（bad）で表示", await popup.$eval("#hits-warn", (el) => el.classList.contains("bad")) === true);
    await popup.$eval("#unknown", (el) => { el.open = true; });
    await popup.screenshot({ path: path.join(outDir, "popup-unknown-mixed.png") });
    await clearSel(a);
    bt = await badge();
    check("混在: 解除後はバッジが ON に戻る", bt === "ON", bt);
    await d.close(); await v.close();
    await setSettings({});

    // ---- 再検証: 失効 → 無効化、設定がデフォルトに戻る ----
    await setSettings({ markColor: "#ff0000" });
    await fetch(`${mockBase}/__admin/revoke`, { method: "POST", body: JSON.stringify({ key: "VALID-KEY-0001" }) });
    await sw.evaluate(async () => { await CWHLicense.revalidate(true); });
    await sleep(600);
    lic = await license();
    check("再検証: 失効したキーは valid=false", lic?.valid === false && lic.status === "revoked");
    await selectIn(a, "src", "INV-2026-0042");
    check("再検証後: 色設定が効かなくなる（デフォルト色）", (await markBg(b)) === "rgb(255, 229, 138)", await markBg(b));
    await clearSel(a);
    await fetch(`${mockBase}/__admin/grant`, { method: "POST", body: JSON.stringify({ key: "VALID-KEY-0001" }) });
    await sw.evaluate(async () => { await CWHLicense.revalidate(true); });
    await sleep(300);
    check("再検証: 復活したキーは valid=true", (await license())?.valid === true);

    // ---- オフライン: 前回結果を維持 ----
    await sw.evaluate(async (org) => { await chrome.storage.local.set({ cwh_dev: { apiBase: "http://127.0.0.1:1", organizationId: org } }); }, ORG);
    await sw.evaluate(async () => { await CWHLicense.revalidate(true); });
    lic = await license();
    check("オフライン: 前回の valid=true を維持し error=network", lic?.valid === true && lic.error === "network", JSON.stringify({ valid: lic?.valid, error: lic?.error }));
    await sw.evaluate(async (apiBase, org) => { await chrome.storage.local.set({ cwh_dev: { apiBase, organizationId: org } }); }, mockBase, ORG);

    // ---- 7日ルール: 期限内は通信しない ----
    const before = requestLog.length;
    await sw.evaluate(async () => { await CWHLicense.revalidate(false); });
    check("7日以内の revalidate は通信しない", requestLog.length === before);
    await sw.evaluate(async () => {
      const lic = (await chrome.storage.local.get("cwh_license")).cwh_license;
      lic.checkedAt = Date.now() - 8 * 24 * 60 * 60 * 1000;
      await chrome.storage.local.set({ cwh_license: lic });
      await CWHLicense.revalidate(false);
    });
    check("7日を過ぎた revalidate は通信する", requestLog.length === before + 1);

    // ---- 解除 ----
    await popup.bringToFront();
    await popup.reload(); await sleep(600);
    await popup.click("#license-deactivate");
    await sleep(600);
    check("解除: 端末のライセンスが消える", (await license()) === null);
    check("解除: サーバー側の activation も消える", keys["VALID-KEY-0001"].activations.length === 0);
    check("解除: Pro が再びロック", await popup.$eval("#settings", (f) => f.disabled) === true);

    // ---- 上限なしキー（activate 403 → validate で通す）----
    m1 = await activate("NOLIMIT-KEY-0003");
    check("上限なしキー: validate 経由で認証できる", m1.includes("認証しました") && (await license())?.activationId === null, m1);

    // ---- 通信の監査 ----
    const nonLicense = requestLog.filter((r) => !/^\/v1\/customer-portal\/license-keys\/(activate|validate|deactivate)$/.test(r.url) && !r.url.startsWith("/__admin"));
    check("通信はライセンス API の3本だけ", nonLicense.length === 0, JSON.stringify(nonLicense.map((r) => r.url)));
    const allowed = new Set(["key", "organization_id", "label", "meta", "activation_id"]);
    const leaky = requestLog.filter((r) => !r.url.startsWith("/__admin")).filter((r) => Object.keys(r.body).some((k) => !allowed.has(k)) || JSON.stringify(r.body).includes("INV-2026") || JSON.stringify(r.body).includes("127.0.0.1"));
    check("送信内容にキー以外（選択文字列・URL）が含まれない", leaky.length === 0, JSON.stringify(leaky));
  } catch (e) {
    console.error("ERROR", e);
    results.push({ name: "例外", ok: false, detail: String(e) });
  } finally {
    await browser.close().catch(() => {});
    mock.close(); pages.close();
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  }

  const fail = results.filter((r) => !r.ok);
  console.log(`\n${results.length - fail.length}/${results.length} passed`);
  process.exit(fail.length ? 1 : 0);
})();
