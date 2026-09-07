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
};

function isBlocked(url) {
  if (!url) return true;
  if (/^(edge|chrome|about|devtools|view-source|extension|chrome-extension):/i.test(url)
    || /microsoftedge\.microsoft\.com|chromewebstore\.google\.com|chrome\.google\.com\/webstore/i.test(url)) {
    return true;
  }
  // Pro: 除外ドメイン
  try {
    if (cwhIsExcludedHost(new URL(url).hostname, proSettings.excludedDomains)) return true;
  } catch (e) { /* URL でなければ通す */ }
  return false;
}

// Pro: ヒット件数バッジ（ON 中だけ。OFF 時は "OFF" のまま）
function updateHitBadge(hit) {
  if (!proSettings.hitBadge) return;
  chrome.action.setBadgeText({ text: hit > 0 ? String(hit > 999 ? "999+" : hit) : "ON" });
  chrome.action.setBadgeBackgroundColor({ color: hit > 0 ? "#d98c00" : "#1d9e75" });
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
  let hit = 0;

  const jobs = tabs.map(async (tab) => {
    if (!tab.id || tab.discarded || isBlocked(tab.url) || tab.id === sourceTabId) return;

    const response = await sendWithInjection(tab.id, {
      type: "HIGHLIGHT",
      text,
      revision,
    });

    if (response?.count) hit += response.count;
  });

  await Promise.allSettled(jobs);

  // 処理中に新しい選択が来ていなければログを出す。
  if (currentState.revision === revision) {
    LOG("選択:", JSON.stringify(text), "→ ヒット", hit, "revision", revision);
    updateHitBadge(hit);
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
    currentState = { text, sourceTabId, revision };
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
