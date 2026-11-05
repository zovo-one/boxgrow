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
  var FREE_DRAFT_CAP = 25;
  var PRO_DRAFT_CAP = 200;
  function draftCapFor(tier) {
    return tier === "pro" ? PRO_DRAFT_CAP : FREE_DRAFT_CAP;
  }
  var DRAFT_TEXT_CAP = 100 * 1024;
  var DISABLED_ORIGINS_CAP = 200;
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
  function freshSiteMap() {
    return { disabledOrigins: [] };
  }
  async function readSiteMap() {
    const r = await storageGet("local", K.sites);
    if (isErr(r) || !isObject(r) || !Array.isArray(r.disabledOrigins)) return freshSiteMap();
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    for (const raw of r.disabledOrigins.slice(0, DISABLED_ORIGINS_CAP)) {
      if (typeof raw !== "string" || raw.length === 0 || raw.length > 256) continue;
      if (seen.has(raw)) continue;
      seen.add(raw);
      out.push(raw);
    }
    return { disabledOrigins: out };
  }
  function writeSiteMap(map) {
    const clean = {
      disabledOrigins: map.disabledOrigins.slice(0, DISABLED_ORIGINS_CAP)
    };
    return storageSet("local", K.sites, clean);
  }
  async function toggleSiteOrigin(origin) {
    const map = await readSiteMap();
    const list = map.disabledOrigins;
    const idx = list.indexOf(origin);
    if (idx >= 0) list.splice(idx, 1);
    else list.push(origin);
    while (list.length > DISABLED_ORIGINS_CAP) list.shift();
    await writeSiteMap({ disabledOrigins: list });
    return list;
  }
  var FIELDKEY_RE = /^[0-9a-f]{8}$/;
  async function readDraftIndex() {
    const r = await storageGet("local", K.draftIndex);
    if (isErr(r) || !isObject(r)) return {};
    const out = {};
    let n = 0;
    for (const [fk, t] of Object.entries(r)) {
      if (n >= PRO_DRAFT_CAP) break;
      if (!FIELDKEY_RE.test(fk)) continue;
      if (typeof t !== "number" || !Number.isFinite(t) || t <= 0) continue;
      out[fk] = t;
      n++;
    }
    return out;
  }

  // src/shared/license.ts
  var KEY_RE = /^ZOVO-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
  function keyIsValid(key) {
    if (typeof key !== "string") return false;
    if (key.length > 64) return false;
    return KEY_RE.test(key.trim().toUpperCase());
  }
  async function getTier() {
    const r = await storageGet("local", K.license);
    if (isErr(r) || r === null || typeof r !== "object") return "free";
    if (r.tier !== "pro") return "free";
    if (typeof r.key !== "string" || !keyIsValid(r.key)) return "free";
    return "pro";
  }

  // src/pages/popup/popup.ts
  function el(id) {
    return document.getElementById(id);
  }
  async function activeOrigin() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const url = tab?.url;
      if (!url) return null;
      const u = new URL(url);
      if (u.protocol !== "http:" && u.protocol !== "https:") return null;
      return u.origin;
    } catch {
      return null;
    }
  }
  async function init() {
    applyI18n();
    const autogrowEl = el("boxg-pop-autogrow");
    const siteRow = el("boxg-pop-site-row");
    const siteState = el("boxg-pop-site-state");
    const siteToggle = el("boxg-pop-site-toggle");
    const draftsEl = el("boxg-pop-drafts");
    const tierBadge = el("boxg-pop-tier");
    const upgradeBlock = el("boxg-pop-upgrade");
    let settings = await readSettings();
    if (autogrowEl) {
      autogrowEl.checked = settings.autoGrow;
      autogrowEl.addEventListener("change", () => {
        settings = { ...settings, autoGrow: autogrowEl.checked };
        void writeSettings(settings);
      });
    }
    const origin = await activeOrigin();
    if (!origin) {
      if (siteState) {
        siteState.textContent = msg("popSiteUnavailable");
        siteState.setAttribute("data-i18n", "popSiteUnavailable");
      }
      if (siteToggle) siteToggle.disabled = true;
    } else {
      const renderSite = (disabled) => {
        const paused = disabled.includes(origin);
        if (siteState) {
          const key = paused ? "popSitePaused" : "popSiteActive";
          siteState.textContent = msg(key);
          siteState.setAttribute("data-i18n", key);
        }
        if (siteToggle) {
          const key = paused ? "popSiteResume" : "popSitePause";
          siteToggle.textContent = msg(key);
          siteToggle.setAttribute("data-i18n", key);
        }
        siteRow?.classList.toggle("boxg-pop-paused", paused);
      };
      renderSite((await readSiteMap()).disabledOrigins);
      siteToggle?.addEventListener("click", () => {
        void toggleSiteOrigin(origin).then(renderSite);
      });
    }
    const [index, tier] = await Promise.all([readDraftIndex(), getTier()]);
    if (draftsEl) {
      draftsEl.textContent = msg("popDraftsKept", [
        String(Object.keys(index).length),
        String(draftCapFor(tier))
      ]);
    }
    if (tier === "pro") {
      if (tierBadge) tierBadge.hidden = false;
      if (upgradeBlock) upgradeBlock.hidden = true;
    }
  }
  document.addEventListener("DOMContentLoaded", () => {
    void init().catch(() => {
    });
  });
})();
