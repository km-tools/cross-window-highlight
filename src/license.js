// ============================================================================
//  license.js  v3.0.0（background.js から importScripts で読み込む）
//
//  ライセンスキーの検証。外部通信はこのファイルの中だけで行う。
//  送るのはキー文字列（と activation_id）のみ。選択文字列・URL は送らない。
//
//  プロバイダは差し替え可能。現在は Polar.sh（customer-portal 系、認証不要）。
//  仕様の出典: https://polar.sh/docs/openapi.json（2026-04）
//    POST {base}/v1/customer-portal/license-keys/activate
//         body { key, organization_id, label, meta? }
//         200 LicenseKeyActivationRead { id, license_key: { status, expires_at, ... } }
//         403 NotPermitted（上限到達、またはアクティベーション未設定のキー）
//         404 ResourceNotFound
//    POST {base}/v1/customer-portal/license-keys/validate
//         body { key, organization_id, activation_id? }
//         200 ValidatedLicenseKey { status: granted|revoked|disabled, expires_at, limit_activations, ... }
//         404 ResourceNotFound
//    POST {base}/v1/customer-portal/license-keys/deactivate
//         body { key, organization_id, activation_id }
//         204
//
//  保存（chrome.storage.local "cwh_license"）:
//    { valid, checkedAt, keyHash, key, activationId, status, expiresAt, error }
//    ※ 7日ごとの再検証に生のキーが必要なので key も端末内に保存する
// ============================================================================

const CWH_LICENSE_CONFIG = Object.freeze({
  provider: "polar",
  // Polar の organization_id（Settings > General）。本番用と sandbox 用は別。
  organizationId: "",
  apiBase: "https://api.polar.sh",
  sandboxApiBase: "https://sandbox-api.polar.sh",
  purchaseUrl: "",                 // 購入ページ（Polar のチェックアウトリンク）
  revalidateMs: 7 * 24 * 60 * 60 * 1000,
  timeoutMs: 10000,
});

// 開発用の上書き（chrome.storage.local "cwh_dev" = { apiBase, organizationId }）
// sandbox で試すときや、テストでモックサーバーに向けるときに使う。
async function cwhLicenseRuntimeConfig() {
  let dev = null;
  try {
    dev = (await chrome.storage.local.get("cwh_dev")).cwh_dev || null;
  } catch (e) { /* ignore */ }
  return {
    ...CWH_LICENSE_CONFIG,
    apiBase: dev?.apiBase || CWH_LICENSE_CONFIG.apiBase,
    organizationId: dev?.organizationId || CWH_LICENSE_CONFIG.organizationId,
  };
}

async function cwhSha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---- Polar プロバイダ ----
// すべて { ok, status, data, error } を返す。error は "invalid" | "limit" | "network" | "config"
const cwhPolarProvider = {
  async request(cfg, path, body) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
    try {
      const res = await fetch(`${cfg.apiBase}/v1/customer-portal/license-keys/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      let data = null;
      try { data = await res.json(); } catch (e) { /* 204 など */ }
      return { status: res.status, data };
    } finally {
      clearTimeout(t);
    }
  },

  async activate(cfg, key, label) {
    const r = await this.request(cfg, "activate", {
      key,
      organization_id: cfg.organizationId,
      label,
      meta: { client: "chrome-extension" },
    });
    if (r.status === 200 && r.data?.id) {
      return {
        ok: true,
        activationId: r.data.id,
        status: r.data.license_key?.status || "granted",
        expiresAt: r.data.license_key?.expires_at || null,
      };
    }
    if (r.status === 403) return { ok: false, error: "limit", detail: r.data?.detail || "" };
    if (r.status === 404) return { ok: false, error: "invalid", detail: r.data?.detail || "" };
    return { ok: false, error: "network", detail: `HTTP ${r.status}` };
  },

  async validate(cfg, key, activationId) {
    const body = { key, organization_id: cfg.organizationId };
    if (activationId) body.activation_id = activationId;
    const r = await this.request(cfg, "validate", body);
    if (r.status === 200 && r.data?.status) {
      return {
        ok: true,
        status: r.data.status,
        expiresAt: r.data.expires_at || null,
        limitActivations: r.data.limit_activations ?? null,
        activationId: r.data.activation?.id || activationId || null,
      };
    }
    if (r.status === 404) return { ok: false, error: "invalid", detail: r.data?.detail || "" };
    return { ok: false, error: "network", detail: `HTTP ${r.status}` };
  },

  async deactivate(cfg, key, activationId) {
    const r = await this.request(cfg, "deactivate", {
      key,
      organization_id: cfg.organizationId,
      activation_id: activationId,
    });
    return { ok: r.status === 204, status: r.status };
  },
};

const CWH_LICENSE_PROVIDERS = { polar: cwhPolarProvider };

// ---- 公開 API（background.js から呼ぶ）----
const CWHLicense = {
  async load() {
    const stored = await chrome.storage.local.get("cwh_license");
    return stored.cwh_license || null;
  },

  async save(lic) {
    await chrome.storage.local.set({ cwh_license: lic });
    return lic;
  },

  async clear() {
    await chrome.storage.local.remove("cwh_license");
  },

  isGranted(status, expiresAt) {
    if (status !== "granted") return false;
    if (expiresAt && Date.parse(expiresAt) < Date.now()) return false;
    return true;
  },

  // キー入力 → activate。activate が 403 のときは validate に回す
  // （アクティベーション上限が設定されていないキーは validate だけで通す）。
  async activate(rawKey) {
    const key = String(rawKey || "").trim();
    if (!key) return { valid: false, error: "invalid" };

    const cfg = await cwhLicenseRuntimeConfig();
    const provider = CWH_LICENSE_PROVIDERS[cfg.provider];
    if (!provider || !cfg.organizationId) {
      return { valid: false, error: "config" };
    }

    const keyHash = await cwhSha256(key);
    const label = `Chrome ${new Date().toISOString().slice(0, 10)} ${keyHash.slice(0, 6)}`;

    let result;
    try {
      const a = await provider.activate(cfg, key, label);
      if (a.ok) {
        result = { valid: this.isGranted(a.status, a.expiresAt), activationId: a.activationId, status: a.status, expiresAt: a.expiresAt, error: null };
      } else if (a.error === "limit") {
        // 上限到達 or アクティベーション未設定 → validate で見分ける
        const v = await provider.validate(cfg, key, null);
        if (v.ok && v.limitActivations === null) {
          result = { valid: this.isGranted(v.status, v.expiresAt), activationId: null, status: v.status, expiresAt: v.expiresAt, error: null };
        } else if (v.ok) {
          result = { valid: false, activationId: null, status: v.status, expiresAt: v.expiresAt, error: "limit" };
        } else {
          result = { valid: false, error: v.error };
        }
      } else {
        result = { valid: false, error: a.error };
      }
    } catch (e) {
      result = { valid: false, error: "network" };
    }

    const lic = { ...result, key, keyHash, checkedAt: Date.now() };
    if (!lic.valid && lic.error !== "network") {
      // 無効なキーは保存しない（前の有効なキーがあれば残す）
      return lic;
    }
    await this.save(lic);
    return lic;
  },

  // 7日ごとの再検証。オフライン時は前回結果を採用。
  async revalidate(force = false) {
    const lic = await this.load();
    if (!lic?.key) return lic;
    if (!force && Date.now() - (lic.checkedAt || 0) < CWH_LICENSE_CONFIG.revalidateMs) return lic;

    const cfg = await cwhLicenseRuntimeConfig();
    const provider = CWH_LICENSE_PROVIDERS[cfg.provider];
    if (!provider || !cfg.organizationId) return lic;

    try {
      const v = await provider.validate(cfg, lic.key, lic.activationId || null);
      let next;
      if (v.ok) {
        next = { ...lic, valid: this.isGranted(v.status, v.expiresAt), status: v.status, expiresAt: v.expiresAt, error: null, checkedAt: Date.now() };
      } else if (v.error === "invalid") {
        next = { ...lic, valid: false, status: "revoked", error: "invalid", checkedAt: Date.now() };
      } else {
        next = { ...lic, error: "network" }; // 前回結果を維持、checkedAt は更新しない
      }
      return this.save(next);
    } catch (e) {
      return this.save({ ...lic, error: "network" });
    }
  },

  async deactivate() {
    const lic = await this.load();
    if (lic?.key && lic.activationId) {
      const cfg = await cwhLicenseRuntimeConfig();
      const provider = CWH_LICENSE_PROVIDERS[cfg.provider];
      try { await provider?.deactivate(cfg, lic.key, lic.activationId); } catch (e) { /* 端末側は解除する */ }
    }
    await this.clear();
    return null;
  },

  // ポップアップ表示用（キー本体は返さない）
  publicInfo(lic, cfg) {
    return {
      valid: lic?.valid === true,
      status: lic?.status || null,
      error: lic?.error || null,
      expiresAt: lic?.expiresAt || null,
      checkedAt: lic?.checkedAt || null,
      keyTail: lic?.key ? lic.key.slice(-4) : null,
      hasActivation: !!lic?.activationId,
      purchaseUrl: cfg?.purchaseUrl || "",
      configured: !!cfg?.organizationId,
    };
  },
};
