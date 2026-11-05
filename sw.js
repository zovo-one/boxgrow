"use strict";
(() => {
  // src/sw/sw.ts
  var ONBOARDING_PAGE = "src/pages/onboarding/onboarding.html";
  var OVERLAY_JS = "overlay/overlay.js";
  var OVERLAY_CSS = "overlay/overlay.css";
  async function handleOpenOverlay(_fieldKey, sender) {
    const tabId = sender.tab?.id;
    const frameId = sender.frameId;
    if (typeof tabId !== "number" || typeof frameId !== "number") {
      return { error: "injection-failed" };
    }
    try {
      await chrome.scripting.insertCSS({
        target: { tabId, frameIds: [frameId] },
        files: [OVERLAY_CSS]
      });
      await chrome.scripting.executeScript({
        target: { tabId, frameIds: [frameId] },
        files: [OVERLAY_JS]
      });
      return { ok: true };
    } catch {
      return { error: "injection-failed" };
    }
  }
  async function openPopoutForActiveTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || typeof tab.id !== "number") return;
      const target = { tabId: tab.id, allFrames: true };
      await chrome.scripting.insertCSS({ target, files: [OVERLAY_CSS] });
      await chrome.scripting.executeScript({ target, files: [OVERLAY_JS] });
    } catch {
    }
  }
  chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === "install") {
      void chrome.tabs.create({ url: chrome.runtime.getURL(ONBOARDING_PAGE) });
    }
  });
  chrome.runtime.onMessage.addListener(
    (msg, sender, sendResponse) => {
      if (msg && msg.action === "boxgrow:open-overlay") {
        void handleOpenOverlay(msg.fieldKey, sender).then(sendResponse);
        return true;
      }
      sendResponse({ error: "unknown-message" });
      return false;
    }
  );
  chrome.commands.onCommand.addListener((command) => {
    if (command === "open-popout") void openPopoutForActiveTab();
  });
})();
