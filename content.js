"use strict";
(() => {
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
  var DRAFT_KEY_PREFIX = "draft:";
  function isErr(r) {
    return typeof r === "object" && r !== null && "error" in r;
  }
  var BG_EV = {
    /** overlay → CS: injected and DOM-ready; requests the attach handshake. */
    overlayReady: "boxgrow:overlay-ready",
    /** CS → overlay: hands over the field + tier caps. detail = AttachDetail. */
    attach: "boxgrow:attach",
    /** overlay → CS: editor closed. detail = CloseDetail. (brief §6, verbatim) */
    close: "boxgrow:close"
  };
  var FREE_SNAPSHOT_CAP = 5;
  var PRO_SNAPSHOT_CAP = 50;
  var FREE_DRAFT_CAP = 25;
  var PRO_DRAFT_CAP = 200;
  function snapshotCapFor(tier) {
    return tier === "pro" ? PRO_SNAPSHOT_CAP : FREE_SNAPSHOT_CAP;
  }
  function draftCapFor(tier) {
    return tier === "pro" ? PRO_DRAFT_CAP : FREE_DRAFT_CAP;
  }
  var AUTOGROW_MAX_VH = 80;
  var TINY_FRAME_MIN_W = 400;
  var TINY_FRAME_MIN_H = 300;
  var DRAFT_DEBOUNCE_MS = 500;
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
  async function storageRemove(areaName, key) {
    try {
      await area(areaName).remove(key);
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
  function writeDraftIndex(index) {
    return storageSet("local", K.draftIndex, index);
  }
  function draftStorageKey(fieldKey) {
    return DRAFT_KEY_PREFIX + fieldKey;
  }
  function sanitizeText(v) {
    return typeof v === "string" ? v.slice(0, DRAFT_TEXT_CAP) : "";
  }
  async function readDraft(fieldKey) {
    if (!FIELDKEY_RE.test(fieldKey)) return null;
    const r = await storageGet("local", draftStorageKey(fieldKey));
    if (isErr(r) || !isObject(r)) return null;
    if (typeof r.updatedAt !== "number" || !Number.isFinite(r.updatedAt) || r.updatedAt <= 0) {
      return null;
    }
    const snapshots = [];
    if (Array.isArray(r.snapshots)) {
      for (const s of r.snapshots.slice(-PRO_SNAPSHOT_CAP)) {
        if (typeof s === "string") snapshots.push(s.slice(0, DRAFT_TEXT_CAP));
      }
    }
    return {
      text: sanitizeText(r.text),
      snapshots,
      updatedAt: r.updatedAt,
      origin: typeof r.origin === "string" ? r.origin.slice(0, 256) : ""
    };
  }
  async function writeDraft(fieldKey, rec) {
    if (!FIELDKEY_RE.test(fieldKey)) return { error: "storage-failure" };
    const clean = {
      text: sanitizeText(rec.text),
      snapshots: (Array.isArray(rec.snapshots) ? rec.snapshots : []).slice(-PRO_SNAPSHOT_CAP).map((s) => sanitizeText(s)),
      updatedAt: Number.isFinite(rec.updatedAt) && rec.updatedAt > 0 ? rec.updatedAt : Date.now(),
      origin: typeof rec.origin === "string" ? rec.origin.slice(0, 256) : ""
    };
    return storageSet("local", draftStorageKey(fieldKey), clean);
  }
  function removeDraft(fieldKey) {
    return storageRemove("local", draftStorageKey(fieldKey));
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
  function comboMatches(e, combo) {
    return comboFromEvent(e) === combo;
  }

  // src/content/autogrow.ts
  function attachAutoGrow(el) {
    const prevHeight = el.style.height;
    const floor = el.getBoundingClientRect().height;
    let detached = false;
    function refresh() {
      if (detached || !el.isConnected) return;
      el.style.height = "auto";
      let target = Math.max(el.scrollHeight, floor);
      target = clampToViewportCap(target);
      const cs = getComputedStyle(el);
      const minH = parseFloat(cs.minHeight);
      if (Number.isFinite(minH) && minH > 0) target = Math.max(target, minH);
      const maxH = parseFloat(cs.maxHeight);
      if (Number.isFinite(maxH) && maxH > 0) target = Math.min(target, maxH);
      el.style.height = `${Math.round(target)}px`;
    }
    const onInput = () => refresh();
    el.addEventListener("input", onInput);
    let ro = null;
    try {
      ro = new ResizeObserver(() => refresh());
      ro.observe(el);
    } catch {
      ro = null;
    }
    refresh();
    return {
      refresh,
      detach() {
        if (detached) return;
        detached = true;
        el.removeEventListener("input", onInput);
        if (ro) ro.disconnect();
        el.style.height = prevHeight;
      }
    };
  }
  function isConstrainedContentEditable(el) {
    const cs = getComputedStyle(el);
    if (cs.overflowY !== "auto" && cs.overflowY !== "scroll") return false;
    return el.scrollHeight > el.clientHeight;
  }
  function clampToViewportCap(px) {
    const cap = Math.max(0, window.innerHeight * (AUTOGROW_MAX_VH / 100));
    return Math.min(px, cap);
  }

  // src/shared/i18n.ts
  function msg(name, substitutions) {
    try {
      return chrome.i18n.getMessage(name, substitutions) || name;
    } catch {
      return name;
    }
  }

  // src/content/button.ts
  function frameTooSmall() {
    return window.innerWidth < TINY_FRAME_MIN_W || window.innerHeight < TINY_FRAME_MIN_H;
  }
  var BTN_CSS = `
:host { all: initial; }
.boxg-btn {
  display: flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; padding: 0; margin: 0;
  border: 1px solid rgba(27, 32, 44, 0.22); border-radius: 7px;
  background: #ffffff; color: #475ed1;
  font: 600 14px/1 system-ui, -apple-system, sans-serif;
  cursor: pointer; box-shadow: 0 1px 4px rgba(16, 20, 30, 0.18);
  opacity: 0.82; transition: opacity 120ms ease;
}
.boxg-btn:hover, .boxg-btn:focus-visible { opacity: 1; }
.boxg-btn:focus-visible { outline: 2px solid #475ed1; outline-offset: 1px; }
`;
  var BTN_SIZE = 26;
  var BTN_INSET = 6;
  function createCornerButton(onOpen) {
    const host = document.createElement("boxgrow-corner");
    host.setAttribute("hidden", "");
    const root = host.attachShadow({ mode: "open" });
    let sheetOk = false;
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(BTN_CSS);
      root.adoptedStyleSheets = [sheet];
      sheetOk = true;
    } catch {
      sheetOk = false;
    }
    if (!sheetOk) {
      const style = document.createElement("style");
      style.textContent = BTN_CSS;
      root.append(style);
    }
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "boxg-btn";
    btn.textContent = "\u2922";
    const label = msg("btnOpenEditor");
    btn.setAttribute("aria-label", label);
    btn.setAttribute("title", label);
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onOpen();
    });
    root.append(btn);
    document.documentElement.append(host);
    let current = null;
    let raf = 0;
    function position() {
      if (!current || !current.isConnected) {
        hide();
        return;
      }
      const r = current.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) {
        hide();
        return;
      }
      const left = Math.max(0, Math.round(r.right + window.scrollX - BTN_SIZE - BTN_INSET));
      const top = Math.max(0, Math.round(r.bottom + window.scrollY - BTN_SIZE - BTN_INSET));
      host.style.left = `${left}px`;
      host.style.top = `${top}px`;
    }
    function schedule() {
      if (raf !== 0) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        position();
      });
    }
    const onReposition = () => {
      if (current) schedule();
    };
    window.addEventListener("scroll", onReposition, { capture: true, passive: true });
    window.addEventListener("resize", onReposition, { passive: true });
    function showFor(el) {
      current = el;
      host.removeAttribute("hidden");
      position();
    }
    function hide() {
      current = null;
      host.setAttribute("hidden", "");
    }
    function destroy() {
      if (raf !== 0) cancelAnimationFrame(raf);
      raf = 0;
      window.removeEventListener("scroll", onReposition, { capture: true });
      window.removeEventListener("resize", onReposition);
      current = null;
      host.remove();
    }
    return { showFor, hide, destroy };
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

  // src/shared/urls.ts
  var CHECKOUT_BASE = "https://zovo.one/pricing?utm_source=boxgrow&utm_medium=extension&utm_campaign=upgrade&utm_content=";
  function checkoutUrl(surface) {
    return CHECKOUT_BASE + surface;
  }

  // src/shared/ui/license-ui.ts
  function textEl(tag, className, i18nKey) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = msg(i18nKey);
    node.setAttribute("data-i18n", i18nKey);
    return node;
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
  function openPaywallNote(note, reason) {
    note.setAttribute("data-cap-hit", reason);
    note.hidden = false;
  }

  // src/content/drafts.ts
  function fieldText(el) {
    return el instanceof HTMLTextAreaElement ? el.value : el.innerText;
  }
  function writeField(el, text) {
    if (el instanceof HTMLTextAreaElement) {
      const desc = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
      if (desc && desc.set) desc.set.call(el, text);
      else el.value = text;
    } else {
      el.innerText = text;
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
  var CHIP_CSS = `
:host { all: initial; }
.boxg-chip {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 10px; border-radius: 9px;
  background: #ffffff; color: #1b202c;
  border: 1px solid rgba(27, 32, 44, 0.18);
  box-shadow: 0 2px 10px rgba(16, 20, 30, 0.22);
  font: 500 12.5px/1.35 system-ui, -apple-system, sans-serif;
}
.boxg-chip button {
  border: 0; border-radius: 6px; padding: 4px 9px; cursor: pointer;
  font: 600 12px/1 system-ui, -apple-system, sans-serif;
}
.boxg-chip-restore { background: #475ed1; color: #ffffff; }
.boxg-chip-dismiss { background: transparent; color: #4a5164; }
.boxg-chip button:focus-visible { outline: 2px solid #475ed1; outline-offset: 1px; }
.boxg-lock-note { color: #4a5164; display: inline-flex; align-items: center; gap: 6px; }
.boxg-lock-badge {
  background: #d0da62; color: #1b202c; border-radius: 4px;
  padding: 1px 5px; font: 700 10.5px/1.4 system-ui, sans-serif;
  text-transform: uppercase; letter-spacing: 0.04em;
}
.boxg-upgrade-link { color: #475ed1; font-weight: 600; text-decoration: none; }
`;
  function showChip(anchor, opts) {
    try {
      if (!anchor.isConnected) return null;
      const host = document.createElement("boxgrow-chip");
      const root = host.attachShadow({ mode: "open" });
      let sheetOk = false;
      try {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(CHIP_CSS);
        root.adoptedStyleSheets = [sheet];
        sheetOk = true;
      } catch {
        sheetOk = false;
      }
      if (!sheetOk) {
        const style = document.createElement("style");
        style.textContent = CHIP_CSS;
        root.append(style);
      }
      const chip = document.createElement("div");
      chip.className = "boxg-chip";
      if (opts.kind === "restore") {
        const restoreBtn = document.createElement("button");
        restoreBtn.type = "button";
        restoreBtn.className = "boxg-chip-restore";
        restoreBtn.textContent = msg("chipRestore");
        restoreBtn.addEventListener("mousedown", (e) => e.preventDefault());
        restoreBtn.addEventListener("click", () => opts.onRestore());
        const dismissBtn = document.createElement("button");
        dismissBtn.type = "button";
        dismissBtn.className = "boxg-chip-dismiss";
        dismissBtn.textContent = msg("chipDismiss");
        dismissBtn.addEventListener("mousedown", (e) => e.preventDefault());
        dismissBtn.addEventListener("click", () => opts.onDismiss());
        chip.append(restoreBtn, dismissBtn);
      } else {
        const note = lockNoteEl(opts.noteKey, "chip");
        openPaywallNote(note, "draft-full");
        chip.append(note);
      }
      root.append(chip);
      document.documentElement.append(host);
      const r = anchor.getBoundingClientRect();
      host.style.left = `${Math.max(0, Math.round(r.left + window.scrollX))}px`;
      host.style.top = `${Math.max(0, Math.round(r.bottom + window.scrollY + 6))}px`;
      let removed = false;
      return {
        remove() {
          if (removed) return;
          removed = true;
          host.remove();
        }
      };
    } catch {
      return null;
    }
  }
  function createDraftManager(getSettings, getTier2) {
    let destroyed = false;
    let chip = null;
    let fullNoteShown = false;
    let lastInputEl = null;
    const dismissed = /* @__PURE__ */ new Set();
    const pending = /* @__PURE__ */ new Map();
    function dropChip() {
      chip?.remove();
      chip = null;
    }
    async function evictOldest(count, keep, index) {
      const idx = index ?? await readDraftIndex();
      const oldest = Object.keys(idx).filter((k) => k !== keep).sort((a, b) => (idx[a] ?? 0) - (idx[b] ?? 0)).slice(0, count);
      for (const k of oldest) {
        delete idx[k];
        void removeDraft(k);
      }
      return idx;
    }
    async function save(fieldKey, text) {
      if (destroyed) return;
      const tier = await getTier2();
      if (destroyed) return;
      const cap = draftCapFor(tier);
      const existing = await readDraft(fieldKey);
      const rec = {
        text,
        snapshots: existing?.snapshots ?? [],
        updatedAt: Date.now(),
        origin: location.origin
      };
      let res = await writeDraft(fieldKey, rec);
      if (isErr(res) && res.error === "quota-exceeded") {
        const idx = await evictOldest(Math.max(1, Math.ceil(cap * 0.1)), fieldKey);
        await writeDraftIndex(idx);
        res = await writeDraft(fieldKey, rec);
      }
      if (isErr(res) || destroyed) return;
      let index = await readDraftIndex();
      index[fieldKey] = rec.updatedAt;
      if (Object.keys(index).length > cap) {
        index = await evictOldest(Object.keys(index).length - cap, fieldKey, index);
        if (tier === "free" && !fullNoteShown) {
          fullNoteShown = true;
          if (lastInputEl && lastInputEl.isConnected) {
            dropChip();
            chip = showChip(lastInputEl, { kind: "note", noteKey: "chipDraftFull" });
          }
        }
      }
      await writeDraftIndex(index);
    }
    function onInput(el, fieldKey, text) {
      if (destroyed || !getSettings().draftSave) return;
      lastInputEl = el;
      const prev = pending.get(fieldKey);
      if (prev) clearTimeout(prev.timer);
      pending.set(fieldKey, {
        text,
        timer: setTimeout(() => {
          pending.delete(fieldKey);
          void save(fieldKey, text);
        }, DRAFT_DEBOUNCE_MS)
      });
    }
    function flushPending() {
      for (const [fk, p] of pending) {
        clearTimeout(p.timer);
        void save(fk, p.text);
      }
      pending.clear();
    }
    async function onFocus(el, fieldKey) {
      if (destroyed || !getSettings().draftSave) return;
      const draft = await readDraft(fieldKey);
      if (destroyed || !draft || draft.text.length === 0) return;
      const current = fieldText(el);
      if (draft.text === current) return;
      const tier = await getTier2();
      if (destroyed) return;
      if (tier === "pro") {
        if (current.length === 0 && draft.origin === location.origin) {
          writeField(el, draft.text);
        }
        return;
      }
      if (dismissed.has(fieldKey)) return;
      dropChip();
      chip = showChip(el, {
        kind: "restore",
        onRestore: () => {
          writeField(el, draft.text);
          el.focus();
          dropChip();
        },
        onDismiss: () => {
          dismissed.add(fieldKey);
          dropChip();
        }
      });
    }
    async function onFieldSynced(fieldKey, finalText) {
      if (destroyed || !getSettings().draftSave) return;
      const p = pending.get(fieldKey);
      if (p) {
        clearTimeout(p.timer);
        pending.delete(fieldKey);
      }
      await save(fieldKey, finalText);
    }
    const onPageHide = () => flushPending();
    window.addEventListener("pagehide", onPageHide);
    function destroy() {
      destroyed = true;
      window.removeEventListener("pagehide", onPageHide);
      flushPending();
      dropChip();
      dismissed.clear();
    }
    return { onInput, onFocus, onFieldSynced, destroy };
  }

  // src/shared/fnv.ts
  function fnv1a32(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }
  if (fnv1a32("") !== 2166136261) {
    throw new Error("fnv1a32 self-test failed");
  }

  // src/content/fieldid.ts
  function fieldKeyHex(origin, identifier) {
    return fnv1a32(`${origin}:${identifier}`).toString(16).padStart(8, "0");
  }
  function resolveIdentifier(el) {
    const id = el.getAttribute("id");
    if (id) return `id:${id}`;
    const name = el.getAttribute("name");
    if (name) return `name:${name}`;
    const aria = el.getAttribute("aria-label");
    if (aria) return `aria:${aria}`;
    return `path:${domPath(el)}`;
  }
  function domPath(el) {
    const parts = [];
    let node = el;
    const root = el.ownerDocument.documentElement;
    while (node && node !== root) {
      const parent = node.parentElement;
      if (!parent) break;
      const tag = node.tagName.toLowerCase();
      let idx = 0;
      for (let i = 0; i < parent.children.length; i++) {
        if (parent.children[i] === node) {
          idx = i;
          break;
        }
      }
      parts.unshift(`${tag}[${idx}]`);
      node = parent;
    }
    return parts.join(">");
  }
  function computeFieldKey(el, origin) {
    const identifier = resolveIdentifier(el);
    return { fieldKey: fieldKeyHex(origin, identifier), identifier };
  }
  function isBoxGrowField(el) {
    if (!el || !(el instanceof HTMLElement)) return false;
    if (el instanceof HTMLTextAreaElement) return true;
    if (el.isContentEditable) {
      if (el.getAttribute("role") === "textbox" && el.getAttribute("aria-multiline") === "false") {
        return false;
      }
      return true;
    }
    return false;
  }

  // src/content/content.ts
  var settings = null;
  var sites = null;
  var focused = null;
  var growth = null;
  function currentSettings() {
    return settings;
  }
  function originPaused() {
    return sites !== null && sites.disabledOrigins.includes(location.origin);
  }
  var button = createCornerButton(() => {
    if (focused) requestOverlay(focused.fieldKey);
  });
  var drafts = createDraftManager(
    () => settings ?? freshSettings(),
    () => getTier()
  );
  function requestOverlay(fieldKey) {
    const msg2 = { action: "boxgrow:open-overlay", fieldKey };
    void Promise.resolve(chrome.runtime.sendMessage(msg2)).then((_reply) => {
    }).catch(() => {
    });
  }
  function fieldText2(el) {
    return el instanceof HTMLTextAreaElement ? el.value : el.innerText;
  }
  function onFieldInput(e) {
    if (!focused || e.target !== focused.el) return;
    drafts.onInput(focused.el, focused.fieldKey, fieldText2(focused.el));
  }
  function applyFocusState() {
    if (!focused || !settings) return;
    const paused = originPaused();
    const wantGrow = settings.autoGrow && !paused && (focused.kind === "textarea" || isConstrainedContentEditable(focused.el));
    if (wantGrow && !growth) growth = attachAutoGrow(focused.el);
    if (!wantGrow && growth) {
      growth.detach();
      growth = null;
    }
    if (!paused && !frameTooSmall()) button.showFor(focused.el);
    else button.hide();
  }
  function onFocusIn(e) {
    if (!settings || originPaused()) return;
    if (!isBoxGrowField(e.target)) return;
    const el = e.target;
    const { fieldKey } = computeFieldKey(el, location.origin);
    const kind = el instanceof HTMLTextAreaElement ? "textarea" : "contenteditable";
    focused = { el, kind, fieldKey };
    if (settings.autoGrow && (kind === "textarea" || isConstrainedContentEditable(el))) {
      growth?.detach();
      growth = attachAutoGrow(el);
    }
    if (!frameTooSmall()) button.showFor(el);
    el.addEventListener("input", onFieldInput);
    void drafts.onFocus(el, fieldKey);
  }
  function onFocusOut(e) {
    if (!focused || e.target !== focused.el) return;
    focused.el.removeEventListener("input", onFieldInput);
    growth?.detach();
    growth = null;
    button.hide();
    focused = null;
  }
  function onKeyDown(e) {
    if (!settings || !focused || originPaused()) return;
    if (!comboMatches(e, settings.popoutHotkey)) return;
    e.preventDefault();
    e.stopPropagation();
    requestOverlay(focused.fieldKey);
  }
  function onOverlayReady(_e) {
    if (!focused) return;
    const f = focused;
    void getTier().then((tier) => {
      if (!focused || focused.fieldKey !== f.fieldKey) return;
      const detail = {
        el: f.el,
        kind: f.kind,
        fieldKey: f.fieldKey,
        tier,
        snapshotCap: snapshotCapFor(tier)
      };
      window.dispatchEvent(new CustomEvent(BG_EV.attach, { detail }));
    });
  }
  function onOverlayClose(e) {
    const detail = e.detail;
    if (!detail) return;
    void drafts.onFieldSynced(detail.fieldKey, detail.finalText);
  }
  async function init() {
    settings = await readSettings();
    sites = await readSiteMap();
    window.addEventListener("focusin", onFocusIn, true);
    window.addEventListener("focusout", onFocusOut, true);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener(BG_EV.overlayReady, onOverlayReady);
    window.addEventListener(BG_EV.close, onOverlayClose);
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local") return;
      if (K.settings in changes) {
        void readSettings().then((s) => {
          settings = s;
          applyFocusState();
        });
      }
      if (K.sites in changes) {
        void readSiteMap().then((m) => {
          sites = m;
          applyFocusState();
        });
      }
    });
  }
  void init();
})();
