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
function renderCurrent(text, hits) {
  const el = $("current");
  if (text) {
    el.textContent = text;
    el.classList.remove("empty");
  } else {
    el.textContent = msg("popupCurrentEmpty");
    el.classList.add("empty");
  }
  renderHits(text ? hits : null);
}

// ---- 一致の内訳と、判定できなかったタブ ----
const REASON_KEYS = {
  blocked: "reasonBlocked",
  excluded: "reasonExcluded",
  injectFailed: "reasonInjectFailed",
  timeout: "reasonTimeout",
  discarded: "reasonDiscarded",
  deferred: "reasonDeferred",
};

function renderHits(hits) {
  const line = $("hits");
  const warn = $("hits-warn");
  const box = $("unknown");
  line.hidden = warn.hidden = box.hidden = true;
  warn.classList.remove("bad");
  if (!hits) return;

  const unknownCount = hits.unknown?.length || 0;

  if (hits.scanned > 0) {
    line.hidden = false;
    line.textContent = "";
    line.append(msg("popupHitsExact", [String(hits.exact)]));
    const sep = document.createTextNode(" / ");
    line.append(sep);
    const n = document.createElement("span");
    n.className = "norm";
    n.textContent = msg("popupHitsNorm", [String(hits.norm)]);
    line.append(n);
  }

  if (hits.scanned === 0 && unknownCount > 0) {
    warn.hidden = false;
    warn.textContent = msg("popupNoScannable");
  } else if (hits.scanned > 0 && hits.total === 0) {
    warn.hidden = false;
    warn.classList.add("bad");
    warn.textContent = msg("popupNoMatch") + (unknownCount ? " " + msg("popupPartialUnknown", [String(unknownCount)]) : "");
  } else if (unknownCount > 0) {
    warn.hidden = false;
    warn.textContent = msg("popupPartialUnknown", [String(unknownCount)]);
  }

  if (unknownCount > 0) {
    box.hidden = false;
    $("unknown-summary").textContent = msg("popupUnknownSummary", [String(unknownCount)]);
    const ul = $("unknown-list");
    ul.textContent = "";
    for (const t of hits.unknown) {
      const li = document.createElement("li");
      li.textContent = (t.title || msg("popupUntitled")) + " ";
      const r = document.createElement("span");
      r.className = "reason";
      r.textContent = "（" + msg(REASON_KEYS[t.reason] || "reasonInjectFailed") + "）";
      li.append(r);
      ul.append(li);
    }
  }
}

async function refreshState() {
  try {
    const state = await chrome.runtime.sendMessage({ type: "GET_STATE" });
    if (!state) return;
    const on = state.enabled !== false;
    renderEnabled(on);
    renderCurrent(on ? state.text : "", state.hits);
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
    if ($("toggle").checked) renderCurrent(state?.text || "", state?.hits || null);
  }
});

// ============================================================================
//  Pro: ライセンスと設定
//  - 設定の読み書きは settings.js（chrome.storage.sync "cwh_settings"）
//  - ライセンスの検証は background.js に依頼する（ここから外部通信はしない）
// ============================================================================

const SETTING_IDS = ["markColor", "inputColor", "normColor", "minLen", "hitBadge", "multiKeyword", "iframes", "strictMatch", "excludedDomains"];
let licenseInfo = { valid: false, configured: false };

function licenseMessage(info) {
  if (!info) return "";
  if (info.valid) {
    return info.error === "network" ? msg("popupLicenseOffline") : "";
  }
  switch (info.error) {
    case "invalid": return msg("popupLicenseErrInvalid");
    case "limit": return msg("popupLicenseErrLimit");
    case "network": return msg("popupLicenseErrNetwork");
    case "config": return msg("popupLicenseErrConfig");
    default: break;
  }
  if (info.status === "revoked" || info.status === "disabled") return msg("popupLicenseErrRevoked");
  if (info.expiresAt && Date.parse(info.expiresAt) < Date.now()) return msg("popupLicenseErrExpired");
  return "";
}

function renderLicense(info, flashMsg) {
  licenseInfo = info || { valid: false };
  const valid = licenseInfo.valid === true;

  $("pro").classList.toggle("locked", !valid);
  const badge = $("pro-badge");
  badge.textContent = msg(valid ? "popupProActive" : licenseInfo.configured ? "popupProLocked" : "popupProComingSoon");
  badge.classList.toggle("ok", valid);

  $("license-form").hidden = valid;
  $("license-info").hidden = !valid;
  $("settings").disabled = !valid;

  const buy = $("purchase");
  buy.hidden = !licenseInfo.purchaseUrl;
  buy.href = licenseInfo.purchaseUrl || "#";

  if (valid) $("license-tail").textContent = licenseInfo.keyTail ? `…${licenseInfo.keyTail}` : "";

  const text = flashMsg ?? licenseMessage(licenseInfo);
  for (const id of ["license-msg", "license-msg2"]) {
    const el = $(id);
    el.textContent = text;
    el.classList.toggle("err", !!text && !(valid && text === msg("popupLicenseOk")));
    el.classList.toggle("ok", !!text && valid && text === msg("popupLicenseOk"));
  }
}

async function refreshLicense(revalidate = false) {
  try {
    const info = await chrome.runtime.sendMessage({ type: "LICENSE_INFO", revalidate });
    renderLicense(info);
  } catch (e) {
    renderLicense({ valid: false, error: "network" });
  }
}

$("license-activate").addEventListener("click", async () => {
  const key = $("license-key").value.trim();
  if (!key) return;
  const btn = $("license-activate");
  btn.disabled = true;
  $("license-msg").textContent = msg("popupLicenseChecking");
  $("license-msg").className = "hint license-msg";
  try {
    const info = await chrome.runtime.sendMessage({ type: "LICENSE_ACTIVATE", key });
    renderLicense(info, info?.valid ? msg("popupLicenseOk") : undefined);
    if (info?.valid) {
      $("license-key").value = "";
      await loadSettingsIntoForm();
    }
  } catch (e) {
    renderLicense({ ...licenseInfo, valid: false, error: "network" });
  } finally {
    btn.disabled = false;
  }
});

$("license-key").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("license-activate").click();
});

$("license-recheck").addEventListener("click", (e) => {
  e.preventDefault();
  $("license-msg2").textContent = msg("popupLicenseChecking");
  refreshLicense(true);
});

$("license-deactivate").addEventListener("click", async (e) => {
  e.preventDefault();
  try {
    const info = await chrome.runtime.sendMessage({ type: "LICENSE_DEACTIVATE" });
    renderLicense(info);
  } catch (err) {
    refreshLicense();
  }
});

$("purchase").addEventListener("click", (e) => {
  if (!licenseInfo.purchaseUrl) return;
  e.preventDefault();
  chrome.tabs.create({ url: licenseInfo.purchaseUrl });
});

// ---- 設定フォーム ----
function formToSettings() {
  return {
    markColor: $("s-markColor").value,
    inputColor: $("s-inputColor").value,
    normColor: $("s-normColor").value,
    minLen: Number($("s-minLen").value),
    strictMatch: $("s-strictMatch").checked,
    hitBadge: $("s-hitBadge").checked,
    multiKeyword: $("s-multiKeyword").checked,
    iframes: $("s-iframes").checked,
    excludedDomains: $("s-excludedDomains").value.split(/\r?\n/),
  };
}

function settingsToForm(s) {
  $("s-markColor").value = s.markColor;
  $("s-inputColor").value = s.inputColor;
  $("s-normColor").value = s.normColor;
  $("s-minLen").value = s.minLen;
  $("s-strictMatch").checked = s.strictMatch;
  $("s-hitBadge").checked = s.hitBadge;
  $("s-multiKeyword").checked = s.multiKeyword;
  $("s-iframes").checked = s.iframes;
  $("s-excludedDomains").value = s.excludedDomains.join("\n");
}

async function loadSettingsIntoForm() {
  settingsToForm(await cwhLoadSettings());
}

let saveTimer = null;
function scheduleSave() {
  if (!licenseInfo.valid) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const clean = await cwhSaveSettings(formToSettings());
    settingsToForm(clean);
  }, 250);
}

for (const id of SETTING_IDS) {
  const el = $(`s-${id}`);
  el.addEventListener("change", scheduleSave);
}

$("s-reset").addEventListener("click", async () => {
  if (!licenseInfo.valid) return;
  settingsToForm(await cwhSaveSettings({}));
});

refreshState();
renderShortcut();
loadSettingsIntoForm();
refreshLicense();
