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
};

let busy = false;
let youtubeOpen = 0;
let statusTimer;
let statusExitTimer;

function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function setStatus(message, tone = "info", { persistent = false } = {}) {
  clearTimeout(statusTimer);
  clearTimeout(statusExitTimer);
  elements.status.classList.remove("is-leaving");
  elements.status.textContent = message;
  elements.status.dataset.tone = tone;
  elements.status.classList.toggle("is-visible", Boolean(message));
  if (message && !persistent) {
    statusTimer = setTimeout(() => {
      elements.status.classList.remove("is-visible");
      elements.status.classList.add("is-leaving");
      statusExitTimer = setTimeout(() => {
        elements.status.classList.remove("is-leaving");
        elements.status.textContent = "";
      }, 120);
    }, tone === "error" ? 4000 : 2400);
  }
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
  elements.openLibrary.disabled = nextBusy;
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
    mode === "youtube" ? "Saving YouTube tabs…" : "Saving all windows…",
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
      throw new Error(response?.error || "The tabs could not be saved.");
    }

    if (response.stored === 0) {
      setStatus(
        mode === "youtube"
          ? "No YouTube tabs to store."
          : "No restorable web tabs to store.",
      );
    } else {
      const partial = response.failedToClose
        ? ` ${pluralize(response.failedToClose, "tab")} stayed open.`
        : "";
      const skipped = response.skipped
        ? ` ${pluralize(response.skipped, "protected tab")} skipped.`
        : "";
      setStatus(
        `${pluralize(response.stored, "tab")} saved.${partial}${skipped}`,
      );
    }
  } catch (error) {
    setStatus(
      error instanceof Error ? error.message : "The tabs could not be saved.",
      "error",
    );
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
elements.openLibrary.addEventListener("click", () => {
  openLibrary().catch((error) =>
    setStatus(
      error instanceof Error ? error.message : "Storage could not be opened.",
      "error",
    ),
  );
});

refresh().catch(() => {
  setStatus("Tab counts are unavailable. Reload the extension.", "error");
});
