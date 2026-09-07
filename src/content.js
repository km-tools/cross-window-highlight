// ============================================================================
//  content.js  v3.0.0（各ページで動く本体）
//
//  v3.0.0: トースト文言を多言語化（_locales）
//  v3.0.0 Pro: settings.js の設定値（色・最小文字数・除外ドメイン・複数語・iframe）を
//    ライセンス有効時のみ適用。無効時はデフォルト値で従来どおり動く。
//    既存関数は変えず、入口（選択送信・HIGHLIGHT 受信・スタイル注入）で分岐する。
//
//  v2.3 での修正（非アクティブ画面のハイライト遅延対応）
//   - 非アクティブなタブ／ウィンドウで、以前フォーカスしていた編集欄を
//     「編集中」と誤判定し続けないよう document.hasFocus() を確認
//   - これにより、対象ウィンドウを一度クリックしなくても即時反映
//
//  v2.2 での修正（ペースト不能バグ対応）
//   - contenteditable（リッチテキストエディタ）内はハイライト対象外に
//     → エディタの DOM を書き換えるとキャレットが消え、貼り付けできなくなるため
//   - 入力中（input / textarea / contenteditable にフォーカス中）は
//     MutationObserver による再ハイライトを保留し、編集終了後に適用
//   - 保留中の再適用は focusout 後に実行
// ============================================================================

(() => {
  if (window.__cwhLoaded) return;
  window.__cwhLoaded = true;

  const MARK_CLASS = "cwh-mark";
  const INPUT_CLASS = "cwh-input";
  const STYLE_ID = "cwh-style";
  const TOAST_ID = "cwh-toast";

  const DEBOUNCE = 200;
  const SAME_TEXT_RESEND_MS = 700;
  const MUTATION_DEBOUNCE = 120;
  const REAPPLY_AFTER_EDIT_MS = 100;

  // 無視する区切り文字（各種ハイフン・半角/全角スペース）
  // ※ 長音符「ー」(U+30FC) は語の一部なので対象外
  const SEP = /[\s\u3000\u2010-\u2015\u2212\uFF0D-]/;

  let enabled = true;
  let lastSent = null;
  let lastSentAt = 0;
  let timer = null;

  let currentText = "";
  let latestRevision = 0;

  // ================= Pro 設定 =================
  let pro = { ...CWH_DEFAULT_SETTINGS };
  let excluded = false;
  const isSubFrame = window !== window.top;
  const MIN_LEN = () => pro.minLen;

  // このフレームで動いてよいか（除外ドメイン / iframe 設定）
  function isActiveHere() {
    if (excluded) return false;
    if (isSubFrame && !pro.iframes) return false;
    return true;
  }

  async function loadProSettings() {
    const [settings, license] = await Promise.all([cwhLoadSettings(), cwhLoadLicense()]);
    pro = cwhEffectiveSettings(settings, license);
    excluded = cwhIsExcludedHost(location.hostname, pro.excludedDomains);
  }
  const proReady = loadProSettings();
  let mutationTimer = null;
  let observer = null;
  let pendingReapply = false;

  // ================= 編集状態の判定 =================
  function isEditingContext() {
    // 非アクティブなタブ／ウィンドウでは activeElement が以前の入力欄のまま
    // 残ることがある。実際に画面へフォーカスがある場合だけ「編集中」と扱う。
    if (!document.hasFocus()) return false;

    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return true;
    return !!el.isContentEditable;
  }

  // ================= 正規化 =================
  function toCompareChar(ch) {
    const code = ch.charCodeAt(0);
    if (code >= 0xff01 && code <= 0xff5e) {
      ch = String.fromCharCode(code - 0xfee0);
    }
    return ch.toLowerCase();
  }

  function buildNormalized(orig) {
    let norm = "";
    const map = [];

    for (let i = 0; i < orig.length; i++) {
      const ch = orig[i];
      if (SEP.test(ch)) continue;

      const conv = toCompareChar(ch);
      for (const c of conv) {
        norm += c;
        map.push(i);
      }
    }
    return { norm, map };
  }

  const normalize = (s) => buildNormalized(s).norm;

  // ================= 見た目 =================
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const st = document.createElement("style");
    st.id = STYLE_ID;
    const multi = CWH_MULTI_COLORS.map(
      (c, i) => `mark.${MARK_CLASS}.${MARK_CLASS}-${i + 1}{background:${c} !important;}`,
    ).join("\n");
    st.textContent = `
      mark.${MARK_CLASS}{
        background:${pro.markColor} !important;
        color:inherit !important;
        padding:0;
        border-radius:2px;
      }
      ${multi}
      .${INPUT_CLASS}{
        outline:3px solid ${pro.inputColor} !important;
        outline-offset:1px;
        background-color:color-mix(in srgb, ${pro.inputColor} 22%, white) !important;
      }
      #${TOAST_ID}{
        position:fixed;
        right:16px;
        bottom:16px;
        z-index:2147483647;
        background:rgba(30,30,30,.92);
        color:#fff;
        font:13px/1.5 system-ui,sans-serif;
        padding:8px 14px;
        border-radius:6px;
        pointer-events:none;
        transition:opacity .3s;
      }
    `;
    (document.head || document.documentElement).appendChild(st);
  }

  function toast(text) {
    injectStyle();
    let el = document.getElementById(TOAST_ID);

    if (!el) {
      el = document.createElement("div");
      el.id = TOAST_ID;
      document.documentElement.appendChild(el);
    }

    el.textContent = text;
    el.style.opacity = "1";
    clearTimeout(el._timer);
    el._timer = setTimeout(() => {
      el.style.opacity = "0";
    }, 1500);
  }

  // ================= 選択取得 =================
  function getSelectionText() {
    const ae = document.activeElement;

    if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA")) {
      const start = ae.selectionStart;
      const end = ae.selectionEnd;
      if (start != null && end != null && end > start) {
        return ae.value.substring(start, end);
      }
    }

    return (window.getSelection && window.getSelection().toString()) || "";
  }

  // ================= ハイライト =================
  function clearHighlights() {
    document.querySelectorAll(`mark.${MARK_CLASS}`).forEach((mark) => {
      const parent = mark.parentNode;
      if (!parent) return;

      while (mark.firstChild) {
        parent.insertBefore(mark.firstChild, mark);
      }
      parent.removeChild(mark);
      parent.normalize();
    });

    document.querySelectorAll(`.${INPUT_CLASS}`).forEach((el) => {
      el.classList.remove(INPUT_CLASS);
    });
  }

  function highlightNode(node, term) {
    const orig = node.nodeValue;
    const { norm, map } = buildNormalized(orig);

    const ranges = [];
    let from = 0;
    let idx;

    while ((idx = norm.indexOf(term, from)) !== -1) {
      ranges.push([map[idx], map[idx + term.length - 1] + 1]);
      from = idx + term.length;
    }

    if (!ranges.length) return 0;

    const frag = document.createDocumentFragment();
    let cursor = 0;

    for (const [start, end] of ranges) {
      if (start > cursor) {
        frag.appendChild(document.createTextNode(orig.slice(cursor, start)));
      }

      const mark = document.createElement("mark");
      mark.className = MARK_CLASS;
      mark.textContent = orig.slice(start, end);
      frag.appendChild(mark);
      cursor = end;
    }

    if (cursor < orig.length) {
      frag.appendChild(document.createTextNode(orig.slice(cursor)));
    }

    node.parentNode.replaceChild(frag, node);
    return ranges.length;
  }

  // ★ Pro: 複数語（改行・読点・カンマ区切り）。2語以上のときだけこちらを通る。
  function highlightMulti(terms) {
    injectStyle();
    let count = 0;

    document.querySelectorAll("input, textarea").forEach((el) => {
      const value = normalize(el.value || "");
      if (value && terms.some((t) => value.includes(t))) {
        el.classList.add(INPUT_CLASS);
        count++;
      }
    });

    if (!document.body) return count;

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        const tag = parent.tagName;
        if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "TEXTAREA") {
          return NodeFilter.FILTER_REJECT;
        }
        if (parent.isContentEditable || parent.closest("[contenteditable]")) return NodeFilter.FILTER_REJECT;
        if (parent.closest(`mark.${MARK_CLASS}`)) return NodeFilter.FILTER_REJECT;
        const n = normalize(node.nodeValue);
        return terms.some((t) => n.includes(t)) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });

    const targets = [];
    let node;
    while ((node = walker.nextNode())) targets.push(node);

    for (const target of targets) {
      const orig = target.nodeValue;
      const { norm, map } = buildNormalized(orig);
      const ranges = [];
      terms.forEach((term, ti) => {
        let from = 0;
        let idx;
        while ((idx = norm.indexOf(term, from)) !== -1) {
          ranges.push([map[idx], map[idx + term.length - 1] + 1, ti]);
          from = idx + term.length;
        }
      });
      if (!ranges.length) continue;
      ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);

      const frag = document.createDocumentFragment();
      let cursor = 0;
      for (const [start, end, ti] of ranges) {
        if (start < cursor) continue; // 重なりは先勝ち
        if (start > cursor) frag.appendChild(document.createTextNode(orig.slice(cursor, start)));
        const mark = document.createElement("mark");
        mark.className = ti === 0 ? MARK_CLASS : `${MARK_CLASS} ${MARK_CLASS}-${((ti - 1) % CWH_MULTI_COLORS.length) + 1}`;
        mark.textContent = orig.slice(start, end);
        frag.appendChild(mark);
        cursor = end;
        count++;
      }
      if (cursor < orig.length) frag.appendChild(document.createTextNode(orig.slice(cursor)));
      target.parentNode.replaceChild(frag, target);
    }
    return count;
  }

  function highlight(searchText) {
    clearHighlights();

    // ★ Pro: 複数語モード。1語のときは従来の経路と同じ処理になる。
    if (pro.multiKeyword) {
      const terms = [...new Set(cwhSplitKeywords(searchText).map(normalize).filter((t) => t.length >= MIN_LEN()))];
      if (terms.length === 0) return 0;
      if (terms.length > 1) return highlightMulti(terms);
      searchText = terms[0];
    }

    const term = normalize(searchText);
    if (term.length < MIN_LEN()) return 0;

    injectStyle();
    let count = 0;

    // input / textarea は枠で示す
    document.querySelectorAll("input, textarea").forEach((el) => {
      const value = el.value || "";
      if (value && normalize(value).includes(term)) {
        el.classList.add(INPUT_CLASS);
        count++;
      }
    });

    // 通常のテキストノード
    if (document.body) {
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode(node) {
            if (!node.nodeValue || !node.nodeValue.trim()) {
              return NodeFilter.FILTER_REJECT;
            }

            const parent = node.parentElement;
            if (!parent) return NodeFilter.FILTER_REJECT;

            const tag = parent.tagName;
            if (
              tag === "SCRIPT"
              || tag === "STYLE"
              || tag === "NOSCRIPT"
              || tag === "TEXTAREA"
            ) {
              return NodeFilter.FILTER_REJECT;
            }

            // ★ v2.2: リッチテキストエディタ（contenteditable）内は書き換えない。
            //   エディタの DOM を外部から書き換えると内部状態が壊れ、
            //   キャレット消失・貼り付け不能の原因になる。
            if (parent.isContentEditable || parent.closest("[contenteditable]")) {
              return NodeFilter.FILTER_REJECT;
            }

            if (parent.closest(`mark.${MARK_CLASS}`)) {
              return NodeFilter.FILTER_REJECT;
            }

            if (!normalize(node.nodeValue).includes(term)) {
              return NodeFilter.FILTER_REJECT;
            }

            return NodeFilter.FILTER_ACCEPT;
          },
        },
      );

      const targets = [];
      let node;
      while ((node = walker.nextNode())) targets.push(node);

      targets.forEach((target) => {
        count += highlightNode(target, term);
      });
    }

    return count;
  }

  function startObserver() {
    if (!document.body) return;

    if (!observer) {
      observer = new MutationObserver(() => {
        if (!enabled || !currentText) return;

        clearTimeout(mutationTimer);
        mutationTimer = setTimeout(() => {
          // ★ v2.2: 入力・貼り付けの最中に DOM を書き換えると
          //   キャレットが消えて操作を妨げるので、編集終了まで保留する。
          if (isEditingContext()) {
            pendingReapply = true;
            return;
          }
          applyCurrentHighlight();
        }, MUTATION_DEBOUNCE);
      });
    }

    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  }

  // ★ v2.2: 編集を抜けたタイミングで、保留していた再ハイライトを適用する。
  document.addEventListener(
    "focusout",
    () => {
      if (!pendingReapply) return;
      setTimeout(() => {
        if (!pendingReapply || isEditingContext()) return;
        pendingReapply = false;
        if (enabled && currentText) {
          applyCurrentHighlight();
        }
      }, REAPPLY_AFTER_EDIT_MS);
    },
    true,
  );

  function applyCurrentHighlight() {
    if (!enabled || !currentText) return 0;

    // 自分自身が行う DOM 変更を MutationObserver に再検知させない。
    observer?.disconnect();
    const count = highlight(currentText);
    startObserver();
    return count;
  }

  function setRemoteHighlight(text, revision) {
    if (revision < latestRevision) {
      return { count: 0, ignored: true };
    }

    latestRevision = revision;
    currentText = text;

    // ★ Pro: 除外ドメイン、または iframe 設定 OFF のサブフレームでは付けない
    if (!isActiveHere()) {
      return { count: 0, excluded: true };
    }

    // ★ v2.3: 実際にこのページへフォーカスがあり、
    //   リッチテキストエディタを編集中の場合だけ保留する。
    //   非アクティブ画面では activeElement が残っていても即時反映する。
    if (document.hasFocus() && document.activeElement?.isContentEditable) {
      pendingReapply = true;
      return { count: 0, deferred: true };
    }

    const count = applyCurrentHighlight();
    return { count };
  }

  function clearRemoteHighlight(revision) {
    if (revision < latestRevision) {
      return { ok: true, ignored: true };
    }

    latestRevision = revision;
    currentText = "";
    pendingReapply = false;
    clearTimeout(mutationTimer);
    observer?.disconnect();
    clearHighlights();
    startObserver();
    return { ok: true };
  }

  // ================= 選択監視 =================
  function sendSelection(text) {
    chrome.runtime
      .sendMessage({ type: "SELECTION_CHANGED", text })
      .catch(() => {
        // ページ破棄中などの一時的な送信失敗は無視する。
      });
  }

  function onSelectionMaybeChanged() {
    if (!enabled || !isActiveHere()) return;

    clearTimeout(timer);
    timer = setTimeout(() => {
      const raw = getSelectionText().trim();
      const text = normalize(raw).length >= MIN_LEN() ? raw : "";

      // タブ切替やウィンドウ切替による一時的な空選択は送らない。
      if (!text && !document.hasFocus()) return;

      const now = Date.now();
      if (text === lastSent && now - lastSentAt < SAME_TEXT_RESEND_MS) {
        return;
      }

      lastSent = text;
      lastSentAt = now;
      sendSelection(text);
    }, DEBOUNCE);
  }

  document.addEventListener("selectionchange", onSelectionMaybeChanged, true);
  document.addEventListener("mouseup", onSelectionMaybeChanged, true);
  document.addEventListener("keyup", onSelectionMaybeChanged, true);

  // ================= 状態同期 =================
  async function syncStateFromBackground() {
    try {
      const state = await chrome.runtime.sendMessage({ type: "GET_STATE" });
      if (!state) return;

      enabled = state.enabled !== false;
      const revision = Number.isFinite(state.revision) ? state.revision : 0;

      if (!enabled || !state.text) {
        clearRemoteHighlight(revision);
        return;
      }

      setRemoteHighlight(state.text, revision);
    } catch (e) {
      // 拡張機能の更新直後など、Service Worker が切り替わる瞬間は無視する。
    }
  }

  chrome.storage.local.get("enabled", (result) => {
    enabled = result.enabled !== false;
    proReady.then(syncStateFromBackground);
  });

  // ★ Pro: 設定やライセンスが変わったら、色・除外・分割を反映し直す
  chrome.storage.onChanged.addListener((changes, area) => {
    const hit = (area === "sync" && changes[CWH_SETTINGS_KEY]) || (area === "local" && changes[CWH_LICENSE_KEY]);
    if (!hit) return;
    loadProSettings().then(() => {
      document.getElementById(STYLE_ID)?.remove();
      if (!isActiveHere()) {
        observer?.disconnect();
        clearHighlights();
        startObserver();
        return;
      }
      injectStyle();
      if (enabled && currentText) applyCurrentHighlight();
      else syncStateFromBackground();
    });
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.enabled) return;

    enabled = changes.enabled.newValue !== false;
    if (!enabled) {
      currentText = "";
      pendingReapply = false;
      clearHighlights();
      lastSent = null;
      lastSentAt = 0;
    } else {
      syncStateFromBackground();
    }

    if (document.hasFocus() && !isSubFrame) {
      toast(chrome.i18n.getMessage(enabled ? "toastOn" : "toastOff"));
    }
  });

  // ================= メッセージ受信 =================
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // ★ Pro: サブフレームは処理はするが応答は返さない。
    //   tabs.sendMessage は最初に返った応答だけを採用するため、
    //   iframe が先に応答すると親フレームのヒット件数が失われる。
    const reply = isSubFrame ? () => {} : sendResponse;

    if (msg?.type === "HIGHLIGHT") {
      const revision = Number.isFinite(msg.revision) ? msg.revision : 0;
      reply(setRemoteHighlight(msg.text || "", revision));
      return;
    }

    if (msg?.type === "CLEAR") {
      const revision = Number.isFinite(msg.revision) ? msg.revision : 0;
      reply(clearRemoteHighlight(revision));
      return;
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      currentText = "";
      pendingReapply = false;
      clearHighlights();
    }
  });

  if (document.body) {
    startObserver();
  } else {
    document.addEventListener("DOMContentLoaded", startObserver, { once: true });
  }
})();