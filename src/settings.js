// ============================================================================
//  settings.js  v3.0.0
//  Pro 設定のデフォルト値と読み書き。background / content / popup で共通。
//  - 保存先: chrome.storage.sync の "cwh_settings"（1オブジェクト）
//  - ライセンスが無効なときは、どの画面でもデフォルト値が使われる
// ============================================================================

const CWH_SETTINGS_KEY = "cwh_settings";
const CWH_LICENSE_KEY = "cwh_license";

const CWH_DEFAULT_SETTINGS = Object.freeze({
  markColor: "#ffe58a",     // mark の背景色
  inputColor: "#ffb300",    // input / textarea の枠色
  minLen: 2,                // 最小文字数 1〜10
  excludedDomains: [],      // 除外ドメイン（例: "example.com"）
  hitBadge: false,          // ヒット件数をバッジに表示
  multiKeyword: false,      // 改行・読点・カンマで分割して複数語をハイライト
  iframes: false,           // iframe 内もハイライト
});

// 複数語ハイライトの色（1語目は markColor、2語目以降はここから）
const CWH_MULTI_COLORS = Object.freeze([
  "#b5f0c8", "#c7d8ff", "#ffc9de", "#ffd9a8", "#e2ccff", "#c8f2f7", "#e6e6a8",
]);

function cwhSanitizeSettings(raw) {
  const s = { ...CWH_DEFAULT_SETTINGS };
  if (!raw || typeof raw !== "object") return s;

  const isColor = (v) => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
  if (isColor(raw.markColor)) s.markColor = raw.markColor.toLowerCase();
  if (isColor(raw.inputColor)) s.inputColor = raw.inputColor.toLowerCase();

  const n = Number(raw.minLen);
  if (Number.isInteger(n) && n >= 1 && n <= 10) s.minLen = n;

  if (Array.isArray(raw.excludedDomains)) {
    s.excludedDomains = raw.excludedDomains
      .map((d) => String(d).trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
      .filter((d) => d && /^[a-z0-9.-]+$/.test(d))
      .slice(0, 200);
  }

  for (const k of ["hitBadge", "multiKeyword", "iframes"]) {
    if (typeof raw[k] === "boolean") s[k] = raw[k];
  }
  return s;
}

async function cwhLoadSettings() {
  try {
    const stored = await chrome.storage.sync.get(CWH_SETTINGS_KEY);
    return cwhSanitizeSettings(stored[CWH_SETTINGS_KEY]);
  } catch (e) {
    return { ...CWH_DEFAULT_SETTINGS };
  }
}

async function cwhSaveSettings(settings) {
  const clean = cwhSanitizeSettings(settings);
  await chrome.storage.sync.set({ [CWH_SETTINGS_KEY]: clean });
  return clean;
}

async function cwhLoadLicense() {
  try {
    const stored = await chrome.storage.local.get(CWH_LICENSE_KEY);
    const lic = stored[CWH_LICENSE_KEY];
    return lic && typeof lic === "object" ? lic : null;
  } catch (e) {
    return null;
  }
}

// ライセンスが有効なときだけ Pro 設定を返す。無効ならデフォルト。
function cwhEffectiveSettings(settings, license) {
  return license?.valid === true ? cwhSanitizeSettings(settings) : { ...CWH_DEFAULT_SETTINGS };
}

// 除外ドメイン判定（完全一致 or サブドメイン）
function cwhIsExcludedHost(hostname, excludedDomains) {
  if (!hostname || !excludedDomains?.length) return false;
  const h = hostname.toLowerCase();
  return excludedDomains.some((d) => h === d || h.endsWith("." + d));
}

// 複数語に分割（改行・読点・カンマ）。normalize 前の生文字列を返す。
function cwhSplitKeywords(text) {
  return String(text)
    .split(/[\n\r、，,]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}
