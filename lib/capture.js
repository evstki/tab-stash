import {
  getTabUrl,
  isRestorableUrl,
  isYouTubeUrl,
  makeId,
  makeSavedRecord,
} from "./tab-utils.js";

export async function captureAndClose({
  mode,
  windowId,
  scope = "current-window",
  operationId = makeId("operation"),
  tabsApi = chrome.tabs,
  persistRecords,
  now = () => new Date().toISOString(),
  createId = () => makeId("tab"),
}) {
  if (mode !== "all" && mode !== "youtube") {
    throw new Error("Unknown capture mode.");
  }

  if (scope !== "all-windows" && !Number.isInteger(windowId)) {
    throw new Error("No browser window was selected.");
  }

  const tabs = await tabsApi.query(
    scope === "all-windows" ? { windowType: "normal" } : { windowId },
  );
  const restorableTabs = tabs.filter((tab) => {
    const url = getTabUrl(tab);
    return Number.isInteger(tab?.id) && isRestorableUrl(url);
  });
  const selectedTabs =
    mode === "youtube"
      ? restorableTabs.filter((tab) => isYouTubeUrl(getTabUrl(tab)))
      : restorableTabs;

  if (selectedTabs.length === 0) {
    return {
      operationId,
      stored: 0,
      closed: 0,
      failedToClose: 0,
      skipped: mode === "all" ? tabs.length : 0,
    };
  }

  const savedAt = now();
  const records = selectedTabs.map((tab) =>
    makeSavedRecord(tab, {
      id: createId(tab),
      captureId: operationId,
      savedAt,
    }),
  );

  // Data safety invariant: the entire capture is persisted before a single
  // browser tab is asked to close.
  await persistRecords(records);

  const closeResults = await Promise.allSettled(
    selectedTabs.map((tab) => tabsApi.remove(tab.id)),
  );
  const closed = closeResults.filter(
    (result) => result.status === "fulfilled",
  ).length;

  return {
    operationId,
    stored: records.length,
    closed,
    failedToClose: records.length - closed,
    skipped: mode === "all" ? tabs.length - selectedTabs.length : 0,
  };
}
