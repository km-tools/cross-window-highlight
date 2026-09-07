// ============================================================================
//  popup.js  v3.0.0
//  ON/OFF スイッチ・現在のハイライト文字列・ショートカット案内を表示する。
//  ロジックは background.js に集約し、ここからはメッセージで依頼するだけ。
// ============================================================================

const msg = (key, subs) => chrome.i18n.getMessage(key, subs) || key;
const $ = (id) => document.getElementById(id);

const SESSION_KEY = "highlightState";

// ---- 文言の差し込み ----
document.querySelectorAll("[data-i18n]").forEach((el) => {
  el.textContent = msg(el.dataset.i18n);
});
document.title = msg("extName");
$("version").textContent = msg("popupVersion", [chrome.runtime.getManifest().version]);

// ---- ON/OFF 表示 ----
function renderEnabled(on) {
  $("toggle").checked = on;
  const status = $("status");
  status.textContent = msg(on ? "popupStatusOn" : "popupStatusOff");
  status.classList.toggle("on", on);
  $("hint").textContent = msg(on ? "popupHintOn" : "popupHintOff");
}

// ---- 現在のハイライト文字列 ----
function renderCurrent(text) {
  const el = $("current");
  if (text) {
    el.textContent = text;
    el.classList.remove("empty");
  } else {
    el.textContent = msg("popupCurrentEmpty");
    el.classList.add("empty");
  }
}

async function refreshState() {
  try {
    const state = await chrome.runtime.sendMessage({ type: "GET_STATE" });
    if (!state) return;
    const on = state.enabled !== false;
    renderEnabled(on);
    renderCurrent(on ? state.text : "");
  } catch (e) {
    // Service Worker 起動直後などは無視
  }
}

// ---- ショートカット表示 ----
async function renderShortcut() {
  try {
    const commands = await chrome.commands.getAll();
    const cmd = commands.find((c) => c.name === "toggle-highlight");
    $("shortcut").textContent = cmd?.shortcut || msg("popupShortcutUnset");
  } catch (e) {
    $("shortcut").textContent = msg("popupShortcutUnset");
  }
}

// ---- 操作 ----
$("toggle").addEventListener("change", (e) => {
  const on = e.target.checked;
  renderEnabled(on);
  chrome.runtime.sendMessage({ type: "SET_ENABLED", enabled: on }).catch(() => {});
});

$("open-shortcuts").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
});

// ---- ショートカットや他タブでの変化を反映 ----
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.enabled) {
    const on = changes.enabled.newValue !== false;
    renderEnabled(on);
    if (on) refreshState();
    else renderCurrent("");
  }
  if (area === "session" && changes[SESSION_KEY]) {
    const state = changes[SESSION_KEY].newValue;
    if ($("toggle").checked) renderCurrent(state?.text || "");
  }
});

refreshState();
renderShortcut();
