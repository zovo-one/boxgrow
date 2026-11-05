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

  // src/shared/types.ts
  var BG_EV = {
    /** overlay → CS: injected and DOM-ready; requests the attach handshake. */
    overlayReady: "boxgrow:overlay-ready",
    /** CS → overlay: hands over the field + tier caps. detail = AttachDetail. */
    attach: "boxgrow:attach",
    /** overlay → CS: editor closed. detail = CloseDetail. (brief §6, verbatim) */
    close: "boxgrow:close"
  };
  var DRAFT_TEXT_CAP = 100 * 1024;

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

  // src/overlay/overlay.ts
  function syncBack(el, text) {
    if (!el.isConnected) return false;
    if (el instanceof HTMLTextAreaElement) {
      const desc = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
      if (desc && desc.set) desc.set.call(el, text);
      else el.value = text;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      el.innerText = text;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    return true;
  }
  var OVERLAY_CSS = `
:host { all: initial; }
.boxg-panel {
  position: fixed; top: 5vh; left: 50%; transform: translateX(-50%);
  width: min(920px, 94vw); height: 86vh;
  display: flex; flex-direction: column;
  background: #ffffff; color: #1b202c; border-radius: 14px;
  box-shadow: 0 18px 60px rgba(8, 10, 16, 0.45);
  font: 400 14px/1.5 system-ui, -apple-system, sans-serif;
  overflow: hidden;
}
.boxg-head {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 16px; border-bottom: 1px solid #e6e8ef;
}
.boxg-title { font-size: 15px; font-weight: 700; margin: 0; flex: 1; }
.boxg-counter, .boxg-counts { color: #4a5164; font-size: 12.5px; font-variant-numeric: tabular-nums; }
.boxg-editor {
  flex: 1; resize: none; border: 0; outline: none; padding: 16px;
  font: 400 14px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #1b202c; background: #fbfcfe;
}
.boxg-warn {
  margin: 0; padding: 8px 16px; font-size: 12.5px; font-weight: 600;
  color: #7a4d00; background: #fdf3d7; border-top: 1px solid #f0dfae;
}
.boxg-foot {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 16px; border-top: 1px solid #e6e8ef;
}
.boxg-capnote { color: #4a5164; font-size: 12.5px; flex: 1; }
.boxg-capnote[hidden] { display: none !important; }
.boxg-lock-note { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.boxg-lock-badge {
  font-size: 10px; font-weight: 700; letter-spacing: 0.4px;
  color: #475ed1; border: 1px solid #475ed1; border-radius: 4px;
  padding: 1px 5px; text-transform: uppercase;
}
.boxg-upgrade-link { color: #475ed1; font-weight: 600; text-decoration: none; }
.boxg-upgrade-link:hover, .boxg-upgrade-link:focus-visible { text-decoration: underline; }
.boxg-btn {
  border: 0; border-radius: 8px; padding: 8px 16px; cursor: pointer;
  font: 600 13px/1 system-ui, -apple-system, sans-serif;
}
.boxg-save { background: #475ed1; color: #ffffff; }
.boxg-close { background: #eef0f6; color: #1b202c; }
.boxg-btn:focus-visible, .boxg-editor:focus-visible {
  outline: 2px solid #475ed1; outline-offset: 1px;
}
`;
  var session = null;
  function openOverlay(detail) {
    if (session && session.host.isConnected) {
      session.editor.focus();
      return;
    }
    const host = document.createElement("boxgrow-overlay");
    const root = host.attachShadow({ mode: "open" });
    let sheetOk = false;
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(OVERLAY_CSS);
      root.adoptedStyleSheets = [sheet];
      sheetOk = true;
    } catch {
      sheetOk = false;
    }
    if (!sheetOk) {
      const style = document.createElement("style");
      style.textContent = OVERLAY_CSS;
      root.append(style);
    }
    const panel = document.createElement("div");
    panel.className = "boxg-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", msg("ovTitle"));
    const head = document.createElement("div");
    head.className = "boxg-head";
    const title = document.createElement("h2");
    title.className = "boxg-title";
    title.textContent = msg("ovTitle");
    const counter = document.createElement("span");
    counter.className = "boxg-counter";
    const counts = document.createElement("span");
    counts.className = "boxg-counts";
    head.append(title, counts, counter);
    const editor = document.createElement("textarea");
    editor.className = "boxg-editor";
    editor.spellcheck = true;
    const seed = detail.kind === "textarea" ? detail.el.value : detail.el.innerText;
    editor.value = seed;
    const warn = document.createElement("p");
    warn.className = "boxg-warn";
    warn.textContent = msg("ovFieldGone");
    warn.hidden = true;
    const foot = document.createElement("div");
    foot.className = "boxg-foot";
    const capNote = lockNoteEl("ovUndoCapFree", "overlay");
    capNote.classList.add("boxg-capnote");
    capNote.hidden = true;
    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "boxg-btn boxg-save";
    saveBtn.textContent = msg("ovSaveClose");
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "boxg-btn boxg-close";
    closeBtn.textContent = msg("ovClose");
    foot.append(capNote, saveBtn, closeBtn);
    panel.append(head, editor, warn, foot);
    root.append(panel);
    document.documentElement.append(host);
    session = { host, editor, detail };
    const undoStack = [];
    let prev = seed;
    let lastPush = 0;
    let capNoted = false;
    function updateCounter() {
      counter.textContent = msg("ovUndoCounter", [
        String(undoStack.length),
        String(detail.snapshotCap)
      ]);
    }
    function updateCounts() {
      const text = editor.value;
      const trimmed = text.trim();
      const words = trimmed === "" ? 0 : trimmed.split(/\s+/).length;
      counts.textContent = msg("ovCounts", [String(words), String(text.length)]);
    }
    function push(text) {
      if (undoStack[undoStack.length - 1] === text) return;
      undoStack.push(text);
      if (undoStack.length > detail.snapshotCap) {
        undoStack.shift();
        if (!capNoted && detail.tier === "free") {
          openPaywallNote(capNote, "undo-cap");
          capNoted = true;
        }
      }
      updateCounter();
    }
    function undo() {
      const v = undoStack.pop();
      if (v === void 0) return;
      editor.value = v;
      prev = v;
      lastPush = Date.now();
      updateCounter();
      editor.focus();
    }
    editor.addEventListener("input", () => {
      updateCounts();
      const now = Date.now();
      if (now - lastPush > 800) {
        push(prev);
        lastPush = now;
      }
      prev = editor.value;
    });
    function dispatchClose(saved, finalText) {
      const closeDetail = { fieldKey: detail.fieldKey, saved, finalText };
      window.dispatchEvent(new CustomEvent(BG_EV.close, { detail: closeDetail }));
    }
    function teardown() {
      host.remove();
      session = null;
    }
    function close(saved) {
      const text = editor.value;
      if (saved && !syncBack(detail.el, text)) {
        warn.hidden = false;
        dispatchClose(true, text);
        return;
      }
      teardown();
      dispatchClose(saved, text);
    }
    saveBtn.addEventListener("click", () => close(true));
    closeBtn.addEventListener("click", () => close(false));
    editor.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close(false);
        return;
      }
      if (e.altKey && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
      }
    });
    updateCounter();
    updateCounts();
    editor.focus();
    editor.setSelectionRange(editor.value.length, editor.value.length);
  }
  function onAttach(e) {
    const detail = e.detail;
    if (!detail) return;
    openOverlay(detail);
  }
  window.addEventListener(BG_EV.attach, onAttach);
  window.dispatchEvent(new CustomEvent(BG_EV.overlayReady));
})();
