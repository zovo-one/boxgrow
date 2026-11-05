"use strict";
(() => {
  // src/shared/i18n.ts
  function msg(name, substitutions) {
    try {
      return chrome.i18n.getMessage(name, substitutions) || name;
    } catch {
      return name;
    }
  }
  function getMessage(key, substitutions) {
    try {
      return chrome.i18n.getMessage(key, substitutions) || "";
    } catch {
      return "";
    }
  }
  function applyText(root) {
    const nodes = root.querySelectorAll("[data-i18n]");
    for (const el2 of Array.from(nodes)) {
      const key = el2.getAttribute("data-i18n");
      if (!key) continue;
      const text = getMessage(key);
      if (text) el2.textContent = text;
    }
  }
  function applyAttrs(root) {
    const nodes = root.querySelectorAll("[data-i18n-attr]");
    for (const el2 of Array.from(nodes)) {
      const spec = el2.getAttribute("data-i18n-attr");
      if (!spec) continue;
      for (const pair of spec.split(";")) {
        const [attr, key] = pair.split(":").map((s) => s.trim());
        if (!attr || !key) continue;
        const text = getMessage(key);
        if (text) el2.setAttribute(attr, text);
      }
    }
  }
  function applyI18n(root = document) {
    try {
      applyText(root);
      applyAttrs(root);
    } catch {
    }
  }

  // src/shared/types.ts
  var K = {
    settings: "boxg:settings",
    // chrome.storage.local — Settings (Addendum B.2: zero-collection posture)
    sites: "boxg:sites",
    // chrome.storage.local — SiteMap (Addendum B.2: zero-collection posture)
    draftIndex: "boxg:draftIndex",
    // chrome.storage.local — Record<fieldKey, updatedAt> LRU book-keeping
    license: "zovo_license"
    // chrome.storage.local — canonical, verbatim, never renamed
  };
  function isErr(r) {
    return typeof r === "object" && r !== null && "error" in r;
  }
  var DRAFT_TEXT_CAP = 100 * 1024;
  var DEFAULT_HOTKEY = "Alt+Enter";

  // src/shared/storage.ts
  function area(name) {
    return name === "sync" ? chrome.storage.sync : chrome.storage.local;
  }
  function errRes(e) {
    const msg2 = e instanceof Error ? e.message : String(e);
    return { error: msg2.includes("QUOTA") ? "quota-exceeded" : "storage-failure" };
  }
  async function storageGet(areaName, key) {
    try {
      const out = await area(areaName).get(key);
      return out[key] ?? null;
    } catch (e) {
      return errRes(e);
    }
  }
  async function storageSet(areaName, key, value) {
    try {
      await area(areaName).set({ [key]: value });
      return { ok: true };
    } catch (e) {
      return errRes(e);
    }
  }
  function isObject(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
  }
  function freshSettings() {
    return { autoGrow: true, popoutHotkey: DEFAULT_HOTKEY, draftSave: true };
  }
  function sanitizeHotkey(v) {
    return typeof v === "string" && v.length > 0 && v.length <= 64 ? v : DEFAULT_HOTKEY;
  }
  async function readSettings() {
    const r = await storageGet("local", K.settings);
    if (isErr(r) || !isObject(r)) return freshSettings();
    return {
      autoGrow: typeof r.autoGrow === "boolean" ? r.autoGrow : true,
      popoutHotkey: sanitizeHotkey(r.popoutHotkey),
      draftSave: typeof r.draftSave === "boolean" ? r.draftSave : true
    };
  }
  function writeSettings(s) {
    const clean = {
      autoGrow: s.autoGrow === true,
      popoutHotkey: sanitizeHotkey(s.popoutHotkey),
      draftSave: s.draftSave === true
    };
    return storageSet("local", K.settings, clean);
  }

  // src/shared/license.ts
  var KEY_RE = /^ZOVO-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
  var VERIFY_URL = "https://zgubxqomnbmxgbdhvwja.supabase.co/functions/v1/verify-extension-license";
  var ANON_KEY = "sb_publishable_RG4IVO9Qm23_xPzdQjdFPQ_QHBwbOLv";
  var EXTENSION_KEY = "boxgrow";
  var VERIFY_TIMEOUT_MS = 8e3;
  function keyIsValid(key) {
    if (typeof key !== "string") return false;
    if (key.length > 64) return false;
    return KEY_RE.test(key.trim().toUpperCase());
  }
  function isVerdict(o) {
    return typeof o === "object" && o !== null && typeof o.valid === "boolean";
  }
  async function activateKey(rawKey) {
    if (typeof rawKey !== "string") return { error: "invalid-key" };
    const key = rawKey.trim().toUpperCase();
    if (!keyIsValid(key)) return { error: "invalid-key" };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), VERIFY_TIMEOUT_MS);
    try {
      const res = await fetch(VERIFY_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          apikey: ANON_KEY,
          authorization: `Bearer ${ANON_KEY}`
        },
        body: JSON.stringify({ license_key: key, extension: EXTENSION_KEY }),
        signal: ctrl.signal
      });
      if (!res.ok) return { error: "invalid-key" };
      let body;
      try {
        body = await res.json();
      } catch {
        return { error: "invalid-key" };
      }
      if (!isVerdict(body) || body.valid !== true) return { error: "invalid-key" };
      const record = {
        key,
        tier: "pro",
        checksum: typeof body.tier === "string" ? body.tier : "pro",
        activatedAt: Date.now()
      };
      const ok = await storageSet("local", K.license, record);
      if (isErr(ok)) return { error: "storage-failure" };
      return { tier: "pro" };
    } catch {
      return { error: "invalid-key" };
    } finally {
      clearTimeout(timer);
    }
  }
  async function deactivate() {
    await storageSet("local", K.license, { tier: "free", deactivatedAt: Date.now() });
  }
  async function getTier() {
    const r = await storageGet("local", K.license);
    if (isErr(r) || r === null || typeof r !== "object") return "free";
    if (r.tier !== "pro") return "free";
    if (typeof r.key !== "string" || !keyIsValid(r.key)) return "free";
    return "pro";
  }

  // src/shared/urls.ts
  var CHECKOUT_BASE = "https://zovo.one/pricing?utm_source=boxgrow&utm_medium=extension&utm_campaign=upgrade&utm_content=";
  function checkoutUrl(surface) {
    return CHECKOUT_BASE + surface;
  }

  // src/shared/ui/license-ui.ts
  var KEY_MAXLEN = 28;
  function textEl(tag, className, i18nKey) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = msg(i18nKey);
    node.setAttribute("data-i18n", i18nKey);
    return node;
  }
  function buttonEl(className, i18nKey) {
    const btn = textEl("button", className, i18nKey);
    btn.type = "button";
    return btn;
  }
  function upgradeLinkEl(surface, labelKey = "upgradeCta") {
    const a = document.createElement("a");
    a.className = "boxg-upgrade-link";
    a.href = checkoutUrl(surface);
    a.target = "_blank";
    a.rel = "noreferrer noopener";
    a.textContent = msg(labelKey);
    a.setAttribute("data-i18n", labelKey);
    return a;
  }
  function lockNoteEl(textKey, surface) {
    const note = document.createElement("span");
    note.className = "boxg-lock-note";
    const badge = document.createElement("span");
    badge.className = "boxg-lock-badge";
    badge.textContent = "Pro";
    badge.setAttribute("aria-hidden", "true");
    note.append(badge, textEl("span", "boxg-lock-text", textKey), upgradeLinkEl(surface));
    return note;
  }
  function buildFreeView(status) {
    const view = document.createElement("div");
    view.className = "boxg-license-free";
    const form = document.createElement("div");
    form.className = "boxg-license-form";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "boxg-license-input";
    input.maxLength = KEY_MAXLEN;
    input.autocomplete = "off";
    input.spellcheck = false;
    input.autocapitalize = "characters";
    input.placeholder = msg("licensePlaceholder");
    input.setAttribute("data-i18n-attr", "placeholder:licensePlaceholder;aria-label:licenseKeyLabel");
    input.setAttribute("aria-label", msg("licenseKeyLabel"));
    const activateBtn = buttonEl("boxg-license-activate", "licenseActivate");
    activateBtn.setAttribute("data-i18n-attr", "aria-label:licenseActivate");
    activateBtn.setAttribute("aria-label", msg("licenseActivate"));
    form.append(input, activateBtn);
    view.append(form, status, upgradeLinkEl("options"));
    return { view, input, activateBtn };
  }
  function buildProView() {
    const view = document.createElement("div");
    view.className = "boxg-license-pro";
    const deactivateBtn = buttonEl("boxg-license-deactivate", "licenseDeactivate");
    view.append(deactivateBtn);
    return { view, deactivateBtn };
  }
  async function mountLicensePanel(container) {
    const aborter = new AbortController();
    const { signal } = aborter;
    container.replaceChildren();
    const title = textEl("h2", "boxg-license-title", "licenseTitle");
    const freeLine = textEl("p", "boxg-license-state", "licenseFree");
    const proLine = textEl("p", "boxg-license-state", "licensePro");
    const status = document.createElement("p");
    status.className = "boxg-license-status";
    status.setAttribute("aria-live", "polite");
    const free = buildFreeView(status);
    const pro = buildProView();
    container.append(title, freeLine, proLine, free.view, pro.view);
    applyI18n(container);
    function render(tier) {
      const isPro = tier === "pro";
      freeLine.hidden = isPro;
      proLine.hidden = !isPro;
      free.view.hidden = isPro;
      pro.view.hidden = !isPro;
    }
    async function refresh() {
      try {
        render(await getTier());
      } catch {
        render("free");
      }
    }
    function showStatus(i18nKey) {
      status.textContent = msg(i18nKey);
      status.setAttribute("data-i18n", i18nKey);
    }
    function clearStatus() {
      status.textContent = "";
      status.removeAttribute("data-i18n");
    }
    free.activateBtn.addEventListener(
      "click",
      () => {
        void (async () => {
          free.activateBtn.disabled = true;
          try {
            const res = await activateKey(free.input.value);
            if (isErr(res)) {
              showStatus("licenseInvalid");
              return;
            }
            free.input.value = "";
            showStatus("licenseActivated");
            await refresh();
          } finally {
            free.activateBtn.disabled = false;
          }
        })();
      },
      { signal }
    );
    free.input.addEventListener(
      "keydown",
      (ev) => {
        if (ev.key === "Enter") free.activateBtn.click();
      },
      { signal }
    );
    pro.deactivateBtn.addEventListener(
      "click",
      () => {
        void (async () => {
          pro.deactivateBtn.disabled = true;
          try {
            await deactivate();
            clearStatus();
            await refresh();
          } finally {
            pro.deactivateBtn.disabled = false;
          }
        })();
      },
      { signal }
    );
    function onStorageChanged(changes, area2) {
      if (area2 === "local" && K.license in changes) void refresh();
    }
    try {
      chrome.storage.onChanged.addListener(onStorageChanged);
    } catch {
    }
    function destroy() {
      aborter.abort();
      try {
        chrome.storage.onChanged.removeListener(onStorageChanged);
      } catch {
      }
      container.replaceChildren();
    }
    await refresh();
    return { refresh, destroy };
  }

  // src/shared/hotkey.ts
  var MODIFIER_KEYS = /* @__PURE__ */ new Set(["Control", "Alt", "Shift", "Meta"]);
  function comboFromEvent(e) {
    if (MODIFIER_KEYS.has(e.key)) return null;
    if (!e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) return null;
    const parts = [];
    if (e.ctrlKey) parts.push("Ctrl");
    if (e.altKey) parts.push("Alt");
    if (e.shiftKey) parts.push("Shift");
    if (e.metaKey) parts.push("Meta");
    parts.push(e.key === " " ? "Space" : e.key.length === 1 ? e.key.toUpperCase() : e.key);
    return parts.join("+");
  }

  // src/pages/options/options.ts
  function el(id) {
    const node = document.getElementById(id);
    if (!node) throw new Error(`options: missing #${id}`);
    return node;
  }
  async function init() {
    applyI18n();
    const autogrowEl = el("boxg-autogrow");
    const draftsEl = el("boxg-drafts");
    const hotkeyRow = el("boxg-hotkey-row");
    const recorderBtn = el("boxg-hotkey-recorder");
    const recordingHint = el("boxg-hotkey-recording");
    const errorEl = el("boxg-hotkey-error");
    let settings = await readSettings();
    autogrowEl.checked = settings.autoGrow;
    draftsEl.checked = settings.draftSave;
    recorderBtn.textContent = settings.popoutHotkey;
    autogrowEl.addEventListener("change", () => {
      settings = { ...settings, autoGrow: autogrowEl.checked };
      void writeSettings(settings);
    });
    draftsEl.addEventListener("change", () => {
      settings = { ...settings, draftSave: draftsEl.checked };
      void writeSettings(settings);
    });
    let recording = false;
    function stopRecording() {
      if (!recording) return;
      recording = false;
      window.removeEventListener("keydown", onRecordKeydown, true);
      recorderBtn.classList.remove("boxg-recording");
      recordingHint.hidden = true;
      recorderBtn.textContent = settings.popoutHotkey;
    }
    function onRecordKeydown(e) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        stopRecording();
        return;
      }
      if (MODIFIER_KEYS.has(e.key)) return;
      const combo = comboFromEvent(e);
      if (!combo) {
        errorEl.hidden = false;
        stopRecording();
        return;
      }
      settings = { ...settings, popoutHotkey: combo };
      void writeSettings(settings);
      errorEl.hidden = true;
      stopRecording();
    }
    recorderBtn.addEventListener("click", () => {
      if (recording) {
        stopRecording();
        return;
      }
      recording = true;
      errorEl.hidden = true;
      recorderBtn.classList.add("boxg-recording");
      recordingHint.hidden = false;
      window.addEventListener("keydown", onRecordKeydown, true);
    });
    window.addEventListener("pagehide", stopRecording);
    let lockNote = null;
    function gateRecorder(tier) {
      const isPro = tier === "pro";
      recorderBtn.disabled = !isPro;
      if (!isPro) stopRecording();
      if (isPro) {
        lockNote?.remove();
        lockNote = null;
      } else if (!lockNote) {
        lockNote = lockNoteEl("optHotkeyLocked", "options");
        hotkeyRow.append(lockNote);
      }
    }
    chrome.storage.onChanged.addListener((changes, area2) => {
      if (area2 === "local" && K.license in changes) {
        void getTier().then(gateRecorder).catch(() => gateRecorder("free"));
      }
    });
    try {
      gateRecorder(await getTier());
      await mountLicensePanel(el("license-panel"));
    } catch {
      gateRecorder("free");
    }
  }
  document.addEventListener("DOMContentLoaded", () => {
    void init().catch(() => {
    });
  });
})();
