// ============================================================================
//  background.js  v3.0.0（Service Worker）
//
//  主な改善点
//   - 選択通知に revision（世代番号）を付け、古い HIGHLIGHT / CLEAR を無効化
//   - 空選択は「現在の選択元タブ」から届いた場合だけ CLEAR
//   - 一時的な空選択は少し待ってから CLEAR（誤解除を軽減）
//   - 現在の検索語を storage.session に保持し、再読込したタブへ復元
//   - content.js は、メッセージ送信失敗時だけ再注入
//   - v3.0.0: ポップアップ追加（ON/OFF はポップアップ内スイッチ）、休止タブを除外
//   - v3.0.0 Pro: 設定（settings.js）とライセンス（license.js）。除外ドメイン・
//     ヒット件数バッジ・iframe 注入は、ライセンス有効時の設定値でのみ切り替わる
//   - v3.0.0 補足: ヒットを「完全一致 / 正規化一致」で分けて集計。各タブを
//     「走査できた / 判定不能（注入不可・タイムアウト・除外など）」で区別し、
//     0件警告は走査できたタブで一致がなかったときだけ出す
// ============================================================================

importScripts("settings.js", "license.js");

const LOG = (...a) => console.log("[CWH]", ...a);
const WARN = (...a) => console.warn("[CWH]", ...a);

const CLEAR_DELAY = 300;
const SESSION_KEY = "highlightState";

let clearTimer = null;
let revisionCounter = 0;

// Pro 設定（ライセンス無効ならデフォルト値）。storage の変化で更新する。
let proSettings = { ...CWH_DEFAULT_SETTINGS };
async function refreshProSettings() {
  const [settings, license] = await Promise.all([cwhLoadSettings(), cwhLoadLicense()]);
  proSettings = cwhEffectiveSettings(settings, license);
  return proSettings;
}
const proReady = refreshProSettings();

chrome.storage.onChanged.addListener((changes, area) => {
  if ((area === "sync" && changes[CWH_SETTINGS_KEY]) || (area === "local" && changes[CWH_LICENSE_KEY])) {
    refreshProSettings().then(() => {
      if (!proSettings.hitBadge) getEnabled().then(updateBadge);
    });
  }
});
let currentState = {
  text: "",
  sourceTabId: null,
  revision: 0,
  hits: null, // { exact, norm, total, scanned, unknown: [{ title, reason }] }
};

const RESPONSE_TIMEOUT = 4000;
const TIMEOUT = Symbol("timeout");

// null = 対象、"blocked" = 拡張が動作しないページ、"excluded" = 除外ドメイン（Pro）
function blockReason(url) {
  if (!url) return "blocked";
  if (/^(edge|chrome|about|devtools|view-source|extension|chrome-extension):/i.test(url)
    || /microsoftedge\.microsoft\.com|chromewebstore\.google\.com|chrome\.google\.com\/webstore/i.test(url)) {
    return "blocked";
  }
  try {
    if (cwhIsExcludedHost(new URL(url).hostname, proSettings.excludedDomains)) return "excluded";
  } catch (e) { /* URL でなければ通す */ }
  return null;
}

function isBlocked(url) {
  return blockReason(url) !== null;
}

// 本文を持たないタブ（空タブ・新しいタブ・この拡張自身のページ）。
// 走査対象でも「判定不能」でもなく、集計から外す。
function isNoContentTab(url) {
  if (!url) return true;
  if (url === "about:blank" || /^chrome:\/\/(newtab|new-tab-page)/i.test(url)) return true;
  return url.startsWith(`chrome-extension://${chrome.runtime.id}/`);
}

// 判定不能タブ一覧に出すタイトル。<title> が無いと Chrome は URL をタイトルにするので、
// URL と同じ内容のときは空にして「（無題）」扱いにする（URL は出さない）。
function safeTitle(tab) {
  const t = (tab.title || "").trim();
  if (!t) return "";
  const u = (tab.url || "").replace(/^[a-z-]+:\/\//i, "");
  if (u.startsWith(t) || (tab.url || "").startsWith(t)) return "";
  return t;
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((r) => setTimeout(() => r(TIMEOUT), ms))]);
}

// Pro: ヒット件数バッジ（ON 中だけ。OFF 時は "OFF" のまま）
//   走査できたタブがない → "?"（灰）、走査できて 0 件 → "0"（赤）、
//   それ以外 → 件数（正規化一致があれば「完全+表記違い」）
function updateHitBadge(hits) {
  if (!proSettings.hitBadge) return;
  if (!hits) {
    updateBadge(true);
    return;
  }
  let text;
  let color;
  if (hits.scanned === 0) {
    text = "?";
    color = "#888780";
  } else if (hits.total === 0) {
    text = "0";
    color = "#c62828";
  } else {
    text = hits.norm > 0 ? `${hits.exact}+${hits.norm}` : String(hits.total);
    if (text.length > 4) text = hits.total > 9999 ? "9999" : String(hits.total);
    color = "#d98c00";
  }
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}

function updateBadge(on) {
  chrome.action.setBadgeText({ text: on ? "ON" : "OFF" });
  chrome.action.setBadgeBackgroundColor({ color: on ? "#1d9e75" : "#888780" });
}

async function getEnabled() {
  const { enabled } = await chrome.storage.local.get("enabled");
  return enabled !== false;
}

function nextRevision() {
  // Date.now() を基準にすることで、Service Worker 再起動後も新しい値になりやすくする。
  revisionCounter = (revisionCounter + 1) % 1000;
  const candidate = Date.now() * 1000 + revisionCounter;
  return Math.max(candidate, currentState.revision + 1);
}

async function loadSessionState() {
  try {
    const stored = await chrome.storage.session.get(SESSION_KEY);
    const state = stored[SESSION_KEY];
    if (state && typeof state === "object") {
      currentState = {
        text: typeof state.text === "string" ? state.text : "",
        sourceTabId: Number.isInteger(state.sourceTabId) ? state.sourceTabId : null,
        revision: Number.isFinite(state.revision) ? state.revision : 0,
        hits: state.hits && typeof state.hits === "object" ? state.hits : null,
      };
    }
  } catch (e) {
    WARN("セッション状態を読み込めませんでした", e);
  }
}

async function saveSessionState() {
  try {
    await chrome.storage.session.set({ [SESSION_KEY]: currentState });
  } catch (e) {
    WARN("セッション状態を保存できませんでした", e);
  }
}

const stateReady = loadSessionState();

async function ensureInjected(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: proSettings.iframes === true },
      files: ["content.js"],
    });
    return true;
  } catch (e) {
    WARN("content.js の注入に失敗", tabId, e?.message || e);
    return false;
  }
}

async function send(tabId, msg) {
  try {
    return await chrome.tabs.sendMessage(tabId, msg);
  } catch (e) {
    return null;
  }
}

async function sendWithInjection(tabId, msg) {
  let response = await send(tabId, msg);
  if (response !== null) return response;

  if (!(await ensureInjected(tabId))) return null;
  response = await send(tabId, msg);
  return response;
}

async function broadcastHighlight(text, sourceTabId, revision) {
  const tabs = await chrome.tabs.query({});
  const hits = { exact: 0, norm: 0, total: 0, scanned: 0, unknown: [] };
  const unknown = (tab, reason) => hits.unknown.push({ title: safeTitle(tab), reason });

  const jobs = tabs.map(async (tab) => {
    if (!tab.id || tab.id === sourceTabId || isNoContentTab(tab.url)) return;
    if (tab.discarded) return unknown(tab, "discarded");
    const blocked = blockReason(tab.url);
    if (blocked) return unknown(tab, blocked);

    const response = await withTimeout(
      sendWithInjection(tab.id, { type: "HIGHLIGHT", text, revision }),
      RESPONSE_TIMEOUT,
    );

    if (response === TIMEOUT) return unknown(tab, "timeout");
    if (response === null || typeof response !== "object") return unknown(tab, "injectFailed");
    if (response.ignored) return; // 古い revision。次の選択で上書きされる
    if (response.excluded) return unknown(tab, "excluded");
    if (response.deferred) return unknown(tab, "deferred");

    hits.scanned++;
    hits.total += response.count || 0;
    hits.exact += response.exact || 0;
    hits.norm += response.norm || 0;
  });

  await Promise.allSettled(jobs);

  // 処理中に新しい選択が来ていなければ結果を確定する。
  if (currentState.revision === revision) {
    currentState.hits = hits;
    await saveSessionState();
    LOG("選択:", JSON.stringify(text), "→ 完全", hits.exact, "表記違い", hits.norm,
      "走査", hits.scanned, "判定不能", hits.unknown.length, "revision", revision);
    updateHitBadge(hits);
  }
}

async function broadcastClear(revision) {
  const tabs = await chrome.tabs.query({});
  const jobs = tabs.map(async (tab) => {
    if (!tab.id || tab.discarded || isBlocked(tab.url)) return;
    await sendWithInjection(tab.id, { type: "CLEAR", revision });
  });
  await Promise.allSettled(jobs);
}

async function clearCurrent(reason) {
  clearTimeout(clearTimer);
  clearTimer = null;

  const revision = nextRevision();
  currentState = {
    text: "",
    sourceTabId: null,
    revision,
    hits: null,
  };
  await saveSessionState();
  await broadcastClear(revision);
  if (proSettings.hitBadge && (await getEnabled())) updateBadge(true);
  LOG("ハイライト解除:", reason, "revision", revision);
}

async function setEnabled(on) {
  await chrome.storage.local.set({ enabled: on });
  updateBadge(on);
  LOG(on ? "ON にしました" : "OFF にしました");

  if (!on) {
    await clearCurrent("機能OFF");
  }
}

async function handleSelectionChanged(msg, sender) {
  await stateReady;
  await proReady;
  if (!(await getEnabled())) return;
  // Pro: 除外ドメインからの選択は受け付けない
  if (isBlocked(sender.tab?.url)) return;

  const sourceTabId = sender.tab?.id;
  if (!Number.isInteger(sourceTabId)) return;

  const text = typeof msg.text === "string" ? msg.text : "";

  if (text) {
    clearTimeout(clearTimer);
    clearTimer = null;

    const revision = nextRevision();
    currentState = { text, sourceTabId, revision, hits: null };
    await saveSessionState();
    await broadcastHighlight(text, sourceTabId, revision);
    return;
  }

  // 関係のないタブから届いた空選択で、現在のハイライトを消さない。
  if (currentState.sourceTabId !== sourceTabId) return;

  // selectionchange と mouseup が一時的に空を返すケースを吸収する。
  clearTimeout(clearTimer);
  const expectedRevision = currentState.revision;
  clearTimer = setTimeout(async () => {
    await stateReady;
    if (
      currentState.sourceTabId !== sourceTabId
      || currentState.revision !== expectedRevision
    ) {
      return;
    }
    await clearCurrent("選択解除");
  }, CLEAR_DELAY);
}

// ---- 初期化 ----
chrome.runtime.onInstalled.addListener(async () => {
  await stateReady;
  const on = await getEnabled();
  updateBadge(on);
  LOG("インストール完了 v3.0.0 / 現在:", on ? "ON" : "OFF");
});

chrome.runtime.onStartup.addListener(async () => {
  await stateReady;
  updateBadge(await getEnabled());
});

// Service Worker が途中で再起動した場合にもバッジを同期する。
stateReady.then(async () => updateBadge(await getEnabled()));

// ライセンスの定期再検証（7日ごと。オフラインなら前回結果を維持）
proReady.then(() => CWHLicense.revalidate().catch((e) => WARN("ライセンス再検証に失敗", e)));

// ---- ショートカット: ON/OFF トグル ----
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-highlight") return;
  await setEnabled(!(await getEnabled()));
});

// ---- content.js との通信 ----
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "SELECTION_CHANGED") {
    handleSelectionChanged(msg, sender).catch((e) => {
      WARN("選択通知の処理に失敗", e);
    });
    return false;
  }

  // ポップアップのスイッチから ON/OFF を切り替える
  if (msg?.type === "SET_ENABLED") {
    (async () => {
      await stateReady;
      await setEnabled(msg.enabled !== false);
      sendResponse({ ok: true });
    })().catch((e) => {
      WARN("ON/OFF の切り替えに失敗", e);
      sendResponse({ ok: false });
    });
    return true;
  }

  // ---- Pro: ライセンス ----
  if (msg?.type === "LICENSE_ACTIVATE") {
    (async () => {
      const lic = await CWHLicense.activate(msg.key);
      await refreshProSettings();
      sendResponse(CWHLicense.publicInfo(lic, await cwhLicenseRuntimeConfig()));
    })().catch((e) => {
      WARN("ライセンス認証に失敗", e);
      sendResponse({ valid: false, error: "network" });
    });
    return true;
  }

  if (msg?.type === "LICENSE_DEACTIVATE") {
    (async () => {
      await CWHLicense.deactivate();
      await refreshProSettings();
      sendResponse(CWHLicense.publicInfo(null, await cwhLicenseRuntimeConfig()));
    })().catch((e) => {
      WARN("ライセンス解除に失敗", e);
      sendResponse({ valid: false, error: "network" });
    });
    return true;
  }

  if (msg?.type === "LICENSE_INFO") {
    (async () => {
      const lic = msg.revalidate ? await CWHLicense.revalidate(true) : await CWHLicense.load();
      if (msg.revalidate) await refreshProSettings();
      sendResponse(CWHLicense.publicInfo(lic, await cwhLicenseRuntimeConfig()));
    })().catch((e) => {
      WARN("ライセンス情報の取得に失敗", e);
      sendResponse({ valid: false, error: "network" });
    });
    return true;
  }

  if (msg?.type === "GET_STATE") {
    (async () => {
      await stateReady;
      const enabled = await getEnabled();
      const requesterTabId = sender.tab?.id;
      const isSource = requesterTabId === currentState.sourceTabId;

      sendResponse({
        enabled,
        text: enabled && !isSource ? currentState.text : "",
        hits: enabled && !isSource ? currentState.hits : null,
        revision: currentState.revision,
      });
    })().catch((e) => {
      WARN("状態取得に失敗", e);
      sendResponse({ enabled: true, text: "", revision: 0 });
    });
    return true;
  }

  return false;
});

// 選択元タブが閉じた／遷移した場合は、古い選択状態を残さない。
chrome.tabs.onRemoved.addListener((tabId) => {
  stateReady.then(() => {
    if (currentState.sourceTabId === tabId) {
      clearCurrent("選択元タブが閉じられた").catch(WARN);
    }
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== "loading") return;
  stateReady.then(() => {
    if (currentState.sourceTabId === tabId) {
      clearCurrent("選択元タブが移動した").catch(WARN);
    }
  });
});
