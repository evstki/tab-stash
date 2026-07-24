import { allRecords, isRestorableUrl, isYouTubeUrl } from "./lib/tab-utils.js";
import { getLibrary } from "./lib/library-storage.js";

const elements = {
  saveYouTube: document.querySelector("#save-youtube"),
  saveAll: document.querySelector("#save-all"),
  openLibrary: document.querySelector("#open-library"),
  savedTotal: document.querySelector("#saved-total"),
  youtubeOpenCount: document.querySelector("#youtube-open-count"),
  allOpenCount: document.querySelector("#all-open-count"),
  status: document.querySelector("#status"),
  statusMessage: document.querySelector("#status-message"),
  statusDismiss: document.querySelector("#status-dismiss"),
  statusAnnouncer: document.querySelector("#status-announcer"),
  statusAlert: document.querySelector("#status-alert"),
};

let busy = false;
let youtubeOpen = 0;
let statusTimer;
let statusClearTimer;
let statusStartedAt = 0;
let statusRemaining = 5000;
let statusAutoDismiss = false;
let statusPointerInside = false;
let statusFocusInside = false;
let statusPreviousFocus;
let lastStableFocus;

const STATUS_TIMEOUT_MS = 5000;
const STATUS_CLEAR_DELAY_MS = 180;

function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function isStableFocusTarget(target) {
  return (
    target instanceof HTMLElement &&
    target.isConnected &&
    target !== document.body &&
    target !== document.documentElement &&
    !target.matches(":disabled, [aria-disabled='true']")
  );
}

function restoreStatusFocus(target) {
  const fallback = [
    target,
    lastStableFocus,
    elements.saveYouTube,
    elements.saveAll,
    elements.openLibrary,
  ].find(isStableFocusTarget);
  fallback?.focus({ preventScroll: true });
}

function clearStatusTimers() {
  clearTimeout(statusTimer);
  clearTimeout(statusClearTimer);
  statusTimer = undefined;
  statusClearTimer = undefined;
}

function hideStatus({ restoreFocus = true } = {}) {
  const focusedInside = elements.status.contains(document.activeElement);
  const previousFocus = statusPreviousFocus;
  clearStatusTimers();
  statusAutoDismiss = false;
  statusRemaining = 0;
  elements.status.classList.remove("is-visible");
  if (restoreFocus && focusedInside) {
    restoreStatusFocus(previousFocus);
  }
  statusPointerInside = false;
  statusFocusInside = false;
  statusClearTimer = setTimeout(() => {
    elements.statusMessage.textContent = "";
  }, STATUS_CLEAR_DELAY_MS);
}

function startStatusTimer() {
  clearTimeout(statusTimer);
  statusTimer = undefined;
  if (
    !statusAutoDismiss ||
    statusPointerInside ||
    statusFocusInside ||
    !elements.status.classList.contains("is-visible")
  ) {
    return;
  }
  if (statusRemaining <= 0) {
    hideStatus();
    return;
  }
  statusStartedAt = Date.now();
  statusTimer = setTimeout(() => {
    statusTimer = undefined;
    statusRemaining = 0;
    hideStatus();
  }, statusRemaining);
}

function pauseStatusTimer() {
  if (statusTimer === undefined) {
    return;
  }
  statusRemaining = Math.max(
    0,
    statusRemaining - (Date.now() - statusStartedAt),
  );
  clearTimeout(statusTimer);
  statusTimer = undefined;
}

function resumeStatusTimer() {
  if (!statusPointerInside && !statusFocusInside) {
    startStatusTimer();
  }
}

function setStatus(message, tone = "info", { persistent = false } = {}) {
  if (!message) {
    hideStatus();
    return;
  }

  const wasVisible = elements.status.classList.contains("is-visible");
  clearStatusTimers();
  const active = document.activeElement;
  if (!elements.status.contains(active) && isStableFocusTarget(active)) {
    statusPreviousFocus = active;
  } else if (!wasVisible) {
    statusPreviousFocus = lastStableFocus;
  }
  elements.statusMessage.textContent = message;
  elements.status.dataset.tone = tone;
  elements.status.classList.add("is-visible");

  elements.statusAnnouncer.textContent = "";
  elements.statusAlert.textContent = "";
  requestAnimationFrame(() => {
    if (tone === "error") {
      elements.statusAlert.textContent = message;
    } else {
      elements.statusAnnouncer.textContent = message;
    }
  });

  statusAutoDismiss = !persistent && tone !== "error";
  statusRemaining = STATUS_TIMEOUT_MS;
  statusPointerInside =
    statusPointerInside || elements.status.matches(":hover");
  statusFocusInside = elements.status.contains(document.activeElement);
  startStatusTimer();
}

function setBusy(nextBusy, activeMode = "") {
  busy = nextBusy;
  document.body.classList.toggle("is-busy", nextBusy);
  for (const [button, mode] of [
    [elements.saveYouTube, "youtube"],
    [elements.saveAll, "all"],
  ]) {
    if (nextBusy && activeMode === mode) {
      button.setAttribute("aria-busy", "true");
    } else {
      button.removeAttribute("aria-busy");
    }
  }
  elements.saveYouTube.disabled = nextBusy || youtubeOpen === 0;
  elements.saveAll.disabled = nextBusy;
  if (nextBusy) {
    elements.openLibrary.setAttribute("aria-disabled", "true");
    elements.openLibrary.tabIndex = -1;
  } else {
    elements.openLibrary.removeAttribute("aria-disabled");
    elements.openLibrary.removeAttribute("tabindex");
  }
}

async function refresh() {
  const [tabs, library] = await Promise.all([
    chrome.tabs.query({ windowType: "normal" }),
    getLibrary(),
  ]);
  const restorable = tabs.filter((tab) => isRestorableUrl(tab.pendingUrl || tab.url));
  youtubeOpen = restorable.filter((tab) =>
    isYouTubeUrl(tab.pendingUrl || tab.url),
  ).length;
  const saved = allRecords(library);

  elements.savedTotal.textContent = String(saved.length);
  elements.youtubeOpenCount.textContent =
    youtubeOpen === 0
      ? "None open"
      : pluralize(youtubeOpen, "tab");
  elements.allOpenCount.textContent =
    restorable.length === 0
      ? "None open"
      : pluralize(restorable.length, "tab");

  setBusy(busy);
}

async function runCapture(mode) {
  if (busy) {
    return;
  }

  setBusy(true, mode);
  setStatus(
    mode === "youtube" ? "Saving YouTube tabs…" : "Saving tabs…",
    "info",
    { persistent: true },
  );

  try {
    const operationId = `capture-${crypto.randomUUID()}`;
    const response = await chrome.runtime.sendMessage({
      type: "CAPTURE_AND_CLOSE",
      mode,
      scope: "all-windows",
      operationId,
    });

    if (!response?.ok) {
      throw new Error("Unable to save tabs. Try again.");
    }

    if (response.stored === 0) {
      setStatus(
        mode === "youtube"
          ? "No YouTube tabs to save."
          : "No web tabs to save.",
      );
    } else {
      const messages = [`${pluralize(response.stored, "tab")} saved.`];
      if (response.failedToClose) {
        messages.push(`${pluralize(response.failedToClose, "tab")} stayed open.`);
      }
      if (response.skipped) {
        messages.push(`${pluralize(response.skipped, "protected tab")} skipped.`);
      }
      setStatus(messages.join(" "));
    }
  } catch {
    setStatus("Unable to save tabs. Try again.", "error");
  } finally {
    setBusy(false);
    await refresh().catch(() => {});
  }
}

async function openLibrary() {
  if (busy) {
    return;
  }

  const libraryUrl = chrome.runtime.getURL("storage.html");
  const tabs = await chrome.tabs.query({});
  const existing = tabs.find((tab) => tab.url === libraryUrl);

  if (existing?.id) {
    await chrome.tabs.update(existing.id, { active: true });
    if (Number.isInteger(existing.windowId)) {
      await chrome.windows.update(existing.windowId, { focused: true });
    }
  } else {
    await chrome.tabs.create({ url: libraryUrl });
  }

  window.close();
}

elements.saveYouTube.addEventListener("click", () => runCapture("youtube"));
elements.saveAll.addEventListener("click", () => runCapture("all"));
elements.openLibrary.addEventListener("click", (event) => {
  if (busy || elements.openLibrary.getAttribute("aria-disabled") === "true") {
    event.preventDefault();
    return;
  }
  if (
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return;
  }
  event.preventDefault();
  openLibrary().catch(() =>
    setStatus("Unable to view saved tabs. Try again.", "error"),
  );
});
elements.statusDismiss.addEventListener("click", () => hideStatus());
elements.status.addEventListener("pointerenter", () => {
  statusPointerInside = true;
  pauseStatusTimer();
});
elements.status.addEventListener("pointerleave", () => {
  statusPointerInside = false;
  resumeStatusTimer();
});
elements.status.addEventListener("focusin", () => {
  statusFocusInside = true;
  pauseStatusTimer();
});
elements.status.addEventListener("focusout", (event) => {
  if (!elements.status.contains(event.relatedTarget)) {
    statusFocusInside = false;
    resumeStatusTimer();
  }
});
document.addEventListener("focusin", (event) => {
  if (
    !elements.status.contains(event.target) &&
    event.target instanceof HTMLElement
  ) {
    lastStableFocus = event.target;
  }
});

refresh().catch(() => {
  setStatus("Unable to load tab counts. Reload the extension.", "error");
});
