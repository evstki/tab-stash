import {
  STORAGE_KEY,
  allRecords,
  getSiteKey,
  getYouTubeThumbnailUrl,
  groupRecordsBySite,
  matchesSearch,
} from "./lib/tab-utils.js";
import { getLibrary } from "./lib/library-storage.js";

const elements = {
  content: document.querySelector("#library-content"),
  search: document.querySelector("#search"),
  tabsRoot: document.querySelector(".view-tabs"),
  tabs: [...document.querySelectorAll(".view-tab")],
  openVisible: document.querySelector("#open-visible"),
  deleteVisible: document.querySelector("#delete-visible"),
  totalSummary: document.querySelector("#total-summary"),
  countAll: document.querySelector("#count-all"),
  countYouTube: document.querySelector("#count-youtube"),
  countSites: document.querySelector("#count-sites"),
  resultSummary: document.querySelector("#result-summary"),
  toast: document.querySelector("#toast"),
  toastMessage: document.querySelector("#toast-message"),
  toastDismiss: document.querySelector("#toast-dismiss"),
  toastStatus: document.querySelector("#toast-status"),
  toastAlert: document.querySelector("#toast-alert"),
  deleteDialog: document.querySelector("#delete-dialog"),
  deleteDialogTitle: document.querySelector("#delete-dialog-title"),
  deleteDialogDescription: document.querySelector(
    "#delete-dialog-description",
  ),
  deleteDialogConfirm: document.querySelector("#delete-dialog-confirm"),
};

const state = {
  library: { general: [], youtube: [] },
  view: "all",
  query: "",
  opening: false,
};

let toastTimer;
let toastClearTimer;
let toastStartedAt = 0;
let toastRemaining = 5000;
let toastAutoDismiss = false;
let toastPointerInside = false;
let toastFocusInside = false;
let toastPreviousFocus;
let lastStableFocus;

const TOAST_TIMEOUT_MS = 5000;
const TOAST_CLEAR_DELAY_MS = 180;

function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function savedCopiesKept(count) {
  return count === 1
    ? "The saved copy was kept."
    : "The saved copies were kept.";
}

function openFailureMessage(count) {
  return `Unable to open ${pluralize(count, "tab")}. Try again. ${savedCopiesKept(count)}`;
}

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) {
    element.className = className;
  }
  if (text !== undefined) {
    element.textContent = text;
  }
  return element;
}

function createIcon(pathData) {
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  icon.setAttribute("viewBox", "0 0 20 20");
  icon.setAttribute("aria-hidden", "true");
  icon.setAttribute("focusable", "false");
  path.setAttribute("d", pathData);
  icon.append(path);
  return icon;
}

function faviconUrl(pageUrl) {
  const url = new URL(chrome.runtime.getURL("/_favicon/"));
  url.searchParams.set("pageUrl", pageUrl);
  url.searchParams.set("size", "32");
  return url.toString();
}

function formatSavedAt(savedAt) {
  const date = new Date(savedAt);
  if (Number.isNaN(date.getTime())) {
    return "Earlier";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
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

function restoreToastFocus(target) {
  const fallback = [
    target,
    lastStableFocus,
    elements.search,
    elements.openVisible,
  ].find(isStableFocusTarget);
  fallback?.focus({ preventScroll: true });
}

function clearToastTimers() {
  clearTimeout(toastTimer);
  clearTimeout(toastClearTimer);
  toastTimer = undefined;
  toastClearTimer = undefined;
}

function hideToast({ restoreFocus = true } = {}) {
  const focusedInside = elements.toast.contains(document.activeElement);
  const previousFocus = toastPreviousFocus;
  clearToastTimers();
  toastAutoDismiss = false;
  toastRemaining = 0;
  elements.toast.classList.remove("is-visible");
  elements.toast.setAttribute("aria-hidden", "true");
  elements.toastDismiss.tabIndex = -1;
  if (restoreFocus && focusedInside) {
    restoreToastFocus(previousFocus);
  }
  toastPointerInside = false;
  toastFocusInside = false;
  toastClearTimer = setTimeout(() => {
    elements.toastMessage.textContent = "";
  }, TOAST_CLEAR_DELAY_MS);
}

function startToastTimer() {
  clearTimeout(toastTimer);
  toastTimer = undefined;
  if (
    !toastAutoDismiss ||
    toastPointerInside ||
    toastFocusInside ||
    !elements.toast.classList.contains("is-visible")
  ) {
    return;
  }
  if (toastRemaining <= 0) {
    hideToast();
    return;
  }
  toastStartedAt = Date.now();
  toastTimer = setTimeout(() => {
    toastTimer = undefined;
    toastRemaining = 0;
    hideToast();
  }, toastRemaining);
}

function pauseToastTimer() {
  if (toastTimer === undefined) {
    return;
  }
  toastRemaining = Math.max(
    0,
    toastRemaining - (Date.now() - toastStartedAt),
  );
  clearTimeout(toastTimer);
  toastTimer = undefined;
}

function resumeToastTimer() {
  if (!toastPointerInside && !toastFocusInside) {
    startToastTimer();
  }
}

function showToast(message, tone = "info") {
  const wasVisible = elements.toast.classList.contains("is-visible");
  clearToastTimers();
  const active = document.activeElement;
  if (!elements.toast.contains(active) && isStableFocusTarget(active)) {
    toastPreviousFocus = active;
  } else if (!wasVisible) {
    toastPreviousFocus = lastStableFocus;
  }
  elements.toastMessage.textContent = message;
  elements.toast.dataset.tone = tone;
  elements.toast.classList.add("is-visible");
  elements.toast.setAttribute("aria-hidden", "false");
  elements.toastDismiss.tabIndex = 0;

  elements.toastStatus.textContent = "";
  elements.toastAlert.textContent = "";
  requestAnimationFrame(() => {
    if (tone === "error") {
      elements.toastAlert.textContent = message;
    } else {
      elements.toastStatus.textContent = message;
    }
  });

  toastAutoDismiss = tone !== "error";
  toastRemaining = TOAST_TIMEOUT_MS;
  toastPointerInside = toastPointerInside || elements.toast.matches(":hover");
  toastFocusInside = elements.toast.contains(document.activeElement);
  startToastTimer();
}

function getBaseRecords() {
  if (state.view === "youtube") {
    return [...state.library.youtube];
  }
  return allRecords(state.library);
}

function getVisibleRecords() {
  return getBaseRecords().filter((record) =>
    matchesSearch(record, state.query),
  );
}

function createFavicon(record) {
  const shell = createElement("div", "favicon");
  const fallback = createElement(
    "span",
    "favicon__fallback",
    record.site.slice(0, 1).toUpperCase(),
  );
  const image = document.createElement("img");
  image.alt = "";
  image.src = faviconUrl(record.url);
  image.addEventListener("load", () => shell.classList.add("has-image"));
  image.addEventListener("error", () => image.remove());
  shell.append(fallback, image);
  return shell;
}

function createTabRow(record) {
  const row = createElement("li", "tab-row");
  row.dataset.recordId = record.id;

  const meta = createElement("div", "tab-meta");
  const title = createElement("span", "tab-title", record.title);
  title.title = record.title;

  const details = createElement("div", "tab-details");
  const site = createElement("span", "tab-site", record.site);
  site.title = record.url;
  const separator = createElement("span", "separator");
  separator.setAttribute("aria-hidden", "true");
  const savedAt = createElement("span", "", formatSavedAt(record.savedAt));
  const isYouTube = state.library.youtube.some(
    (item) => item.id === record.id,
  );
  details.append(site, separator, savedAt);
  if (isYouTube || record.pinned) {
    details.append(
      createElement(
        "span",
        `badge${isYouTube ? " badge--youtube" : ""}`,
        isYouTube ? "YouTube" : "Pinned",
      ),
    );
  }
  meta.append(title, details);

  const openLink = createElement("a", "tab-row__open");
  openLink.href = record.url;
  openLink.target = "_blank";
  openLink.rel = "noopener";
  openLink.dataset.action = "open-record";
  openLink.dataset.recordId = record.id;
  openLink.setAttribute("aria-label", `Open ${record.title}`);
  openLink.append(createFavicon(record), meta);

  const deleteButton = createElement("button", "row-action row-action--delete");
  deleteButton.type = "button";
  deleteButton.title = "Delete";
  deleteButton.dataset.action = "delete-record";
  deleteButton.dataset.recordId = record.id;
  deleteButton.setAttribute("aria-label", `Delete ${record.title}`);
  deleteButton.append(createIcon("m6 6 8 8M14 6l-8 8"));

  row.append(openLink, deleteButton);
  return row;
}

function createList(records) {
  const list = createElement("ul", "tab-list");
  list.setAttribute("role", "list");
  for (const record of records) {
    list.append(createTabRow(record));
  }
  return list;
}

function createYouTubeCard(record, thumbnailUrl) {
  const card = createElement("li", "youtube-card");
  card.dataset.recordId = record.id;

  const openLink = createElement("a", "youtube-card__open");
  openLink.href = record.url;
  openLink.target = "_blank";
  openLink.rel = "noopener";
  openLink.dataset.action = "open-record";
  openLink.dataset.recordId = record.id;
  openLink.setAttribute("aria-label", `Open ${record.title} on YouTube`);

  const media = createElement("span", "youtube-card__media");
  const fallback = createElement("span", "youtube-card__fallback");
  const fallbackMark = createElement("span", "youtube-card__fallback-mark");
  fallback.setAttribute("aria-hidden", "true");
  fallback.append(fallbackMark);
  media.append(fallback);

  if (thumbnailUrl) {
    const image = document.createElement("img");
    const play = createElement("span", "youtube-card__play");
    image.alt = "";
    image.loading = "lazy";
    image.decoding = "async";
    image.referrerPolicy = "no-referrer";
    image.addEventListener(
      "load",
      () => media.classList.add("has-thumbnail"),
      { once: true },
    );
    image.addEventListener("error", () => image.remove(), { once: true });
    image.src = thumbnailUrl;
    play.setAttribute("aria-hidden", "true");
    media.append(image, play);
  }

  const copy = createElement("span", "youtube-card__copy");
  const title = createElement("span", "youtube-card__title", record.title);
  title.title = record.title;
  const meta = createElement(
    "span",
    "youtube-card__meta",
    `${record.site} · ${formatSavedAt(record.savedAt)}`,
  );
  copy.append(title, meta);
  openLink.append(media, copy);

  const actions = createElement("div", "youtube-card__actions");
  const deleteButton = createElement(
    "button",
    "row-action row-action--delete youtube-card__delete-button",
  );
  deleteButton.type = "button";
  deleteButton.title = "Delete";
  deleteButton.dataset.action = "delete-record";
  deleteButton.dataset.recordId = record.id;
  deleteButton.setAttribute("aria-label", `Delete ${record.title}`);
  deleteButton.append(createIcon("m6 6 8 8M14 6l-8 8"));
  actions.append(deleteButton);

  card.append(openLink, actions);
  return card;
}

function createYouTubeView(records) {
  const container = createElement("div", "youtube-view");
  const grid = createElement("ul", "youtube-grid");
  grid.setAttribute("role", "list");

  for (const record of records) {
    grid.append(
      createYouTubeCard(record, getYouTubeThumbnailUrl(record.url)),
    );
  }

  container.append(grid);
  return container;
}

function createSiteGroups(records) {
  const container = createElement("div", "site-groups");

  for (const group of groupRecordsBySite(records)) {
    const card = createElement("section", "site-card");
    const header = createElement("header", "site-header");
    const heading = createElement("div", "site-heading");
    const text = createElement("div");
    const title = createElement("h3", "", group.site);
    title.title = group.site;
    const count = createElement(
      "span",
      "",
      `${pluralize(group.items.length, "saved tab")}`,
    );
    text.append(title, count);
    heading.append(createFavicon(group.items[0]), text);

    const open = createElement("button", "site-open", "Open all");
    open.type = "button";
    open.dataset.action = "open-site";
    open.dataset.site = group.site;
    open.setAttribute(
      "aria-label",
      `Open all ${pluralize(group.items.length, "tab")} from ${group.site}`,
    );
    header.append(heading, open);
    card.append(header, createList(group.items));
    container.append(card);
  }

  return container;
}

function createEmptyState() {
  const wrapper = createElement("div", "empty-state");
  const content = createElement("div");
  const art = createElement("div", "empty-state__art");
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("aria-hidden", "true");
  icon.setAttribute("focusable", "false");
  const pathOne = document.createElementNS("http://www.w3.org/2000/svg", "path");
  pathOne.setAttribute("d", "M4 7h16v12H4z");
  const pathTwo = document.createElementNS("http://www.w3.org/2000/svg", "path");
  pathTwo.setAttribute("d", "M8 4h8M8 11h8");
  icon.append(pathOne, pathTwo);
  art.append(icon);

  let heading = "No saved tabs yet";
  let description = "Select Tab Stash in the toolbar to save open tabs.";
  let action;
  if (state.query) {
    heading = `No results for “${state.query}”`;
    description = "Try another search.";
    action = createElement("button", "button empty-state__action", "Clear search");
    action.type = "button";
    action.dataset.action = "clear-search";
  } else if (state.view === "youtube") {
    heading = "No saved YouTube tabs yet";
    description =
      "Select Tab Stash in the toolbar to save open YouTube tabs.";
  } else if (state.view === "sites") {
    heading = "No saved sites yet";
    description = "Save tabs with Tab Stash to group them here by site.";
  }

  content.append(
    art,
    createElement("h3", "", heading),
    createElement("p", "", description),
  );
  if (action) {
    content.append(action);
  }
  wrapper.append(content);
  return wrapper;
}

function render() {
  const all = allRecords(state.library);
  const sites = new Set(all.map((record) => getSiteKey(record.url)));
  const visible = getVisibleRecords();

  elements.totalSummary.textContent = pluralize(all.length, "tab");
  elements.countAll.textContent = String(all.length);
  elements.countYouTube.textContent = String(state.library.youtube.length);
  elements.countSites.textContent = String(sites.size);

  if (state.query) {
    elements.openVisible.textContent = "Open matching tabs";
    elements.deleteVisible.textContent = "Delete matching tabs";
  } else if (state.view === "youtube") {
    elements.openVisible.textContent = "Open YouTube tabs";
    elements.deleteVisible.textContent = "Delete YouTube tabs";
  } else {
    elements.openVisible.textContent = "Open all tabs";
    elements.deleteVisible.textContent = "Delete all tabs";
  }

  elements.content.replaceChildren(
    visible.length === 0
      ? createEmptyState()
      : state.view === "youtube"
        ? createYouTubeView(visible)
        : state.view === "sites"
          ? createSiteGroups(visible)
          : createList(visible),
  );

  syncOpeningState(visible);

  const context = state.query
    ? ` for “${state.query}”`
    : ` in the ${state.view === "youtube" ? "YouTube" : state.view === "sites" ? "Sites" : "All"} view`;
  elements.resultSummary.textContent = `${pluralize(visible.length, "result")}${context}.`;
}

function setView(view, { focus = false, input = "programmatic" } = {}) {
  state.view = view;
  elements.tabsRoot.dataset.input = input;
  elements.tabsRoot.dataset.view = view;
  for (const tab of elements.tabs) {
    const selected = tab.dataset.view === view;
    tab.classList.toggle("is-active", selected);
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
    if (selected && focus) {
      tab.focus();
    }
  }
  elements.content.setAttribute("aria-labelledby", `view-${view}`);
  render();
}

function findRecord(id) {
  return allRecords(state.library).find((record) => record.id === id);
}

function syncOpeningState(visible = getVisibleRecords()) {
  elements.openVisible.disabled = visible.length === 0 || state.opening;
  elements.deleteVisible.disabled = visible.length === 0 || state.opening;
  elements.content.setAttribute("aria-busy", String(state.opening));

  for (const button of elements.content.querySelectorAll(
    'button[data-action="open-site"], button[data-action="delete-record"]',
  )) {
    button.disabled = state.opening;
  }
  for (const link of elements.content.querySelectorAll(
    'a[data-action="open-record"]',
  )) {
    if (state.opening) {
      link.setAttribute("aria-disabled", "true");
      link.tabIndex = -1;
    } else {
      link.removeAttribute("aria-disabled");
      link.removeAttribute("tabindex");
    }
  }
}

function captureFocusIdentity() {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) {
    return null;
  }
  if (active.id === "open-visible") {
    return { source: active, id: active.id };
  }

  const action = active.closest("[data-action]");
  if (!action || !elements.content.contains(action)) {
    return null;
  }
  return {
    source: action,
    action: action.dataset.action,
    recordId: action.dataset.recordId,
    site: action.dataset.site,
  };
}

function findFocusIdentity(identity) {
  if (!identity) {
    return null;
  }
  if (identity.id) {
    return document.getElementById(identity.id);
  }
  return [
    ...elements.content.querySelectorAll(
      `[data-action="${identity.action}"]`,
    ),
  ].find(
    (candidate) =>
      candidate.dataset.recordId === identity.recordId &&
      candidate.dataset.site === identity.site,
  );
}

function restoreFocusIdentity(identity, activeBeforeRender) {
  if (!identity) {
    return;
  }
  const shouldRestore =
    activeBeforeRender === identity.source ||
    activeBeforeRender === document.body ||
    activeBeforeRender === document.documentElement ||
    !activeBeforeRender?.isConnected;
  if (!shouldRestore) {
    return;
  }
  const target = findFocusIdentity(identity);
  if (isStableFocusTarget(target)) {
    target.focus({ preventScroll: true });
  } else {
    elements.content.focus({ preventScroll: true });
  }
}

async function openRecords(records, { activateFirst = false } = {}) {
  if (state.opening || records.length === 0) {
    return;
  }

  const focusIdentity = captureFocusIdentity();
  state.opening = true;
  syncOpeningState();
  let opened = 0;
  let notification;
  try {
    for (const record of records) {
      try {
        await chrome.tabs.create({
          url: record.url,
          active: activateFirst && opened === 0,
          pinned: record.pinned,
        });
        opened += 1;
      } catch {
        // A failed URL remains stored; successful tabs continue opening.
      }
    }

    const failed = records.length - opened;
    if (opened === 0) {
      notification = {
        message: openFailureMessage(records.length),
        tone: "error",
      };
    } else if (failed > 0) {
      notification = {
        message: `${pluralize(opened, "tab")} opened. Unable to open ${pluralize(failed, "tab")}. Try again. ${savedCopiesKept(records.length)}`,
        tone: "error",
      };
    } else {
      notification = {
        message: `${pluralize(opened, "tab")} opened. ${savedCopiesKept(records.length)}`,
        tone: "info",
      };
    }
  } finally {
    const activeBeforeRender = document.activeElement;
    state.opening = false;
    render();
    restoreFocusIdentity(focusIdentity, activeBeforeRender);
    if (notification) {
      showToast(notification.message, notification.tone);
    }
  }
}

async function deleteSavedRecords(ids) {
  const response = await chrome.runtime.sendMessage({
    type: "DELETE_RECORDS",
    ids,
  });
  if (!response?.ok) {
    throw new Error("Unable to delete saved tabs. Try again.");
  }
  return response.library;
}

function confirmDeletion({ title, description, confirmLabel }) {
  elements.deleteDialogTitle.textContent = title;
  elements.deleteDialogDescription.textContent = description;
  elements.deleteDialogConfirm.textContent = confirmLabel;
  elements.deleteDialog.returnValue = "";

  return new Promise((resolve) => {
    elements.deleteDialog.addEventListener(
      "close",
      () => resolve(elements.deleteDialog.returnValue === "confirm"),
      { once: true },
    );
    elements.deleteDialog.showModal();
  });
}

async function deleteRecord(record) {
  const confirmed = await confirmDeletion({
    title: "Delete saved tab?",
    description: `“${record.title}” will be deleted from Tab Stash. This can’t be undone.`,
    confirmLabel: "Delete tab",
  });
  if (!confirmed) {
    return;
  }

  state.library = await deleteSavedRecords([record.id]);
  render();
  elements.content.focus();
  showToast("Saved tab deleted.");
}

async function deleteVisible() {
  const visible = getVisibleRecords();
  if (visible.length === 0) {
    return;
  }

  const confirmed = await confirmDeletion({
    title: `Delete ${pluralize(visible.length, "saved tab")}?`,
    description:
      visible.length === 1
        ? "This saved tab will be deleted from Tab Stash. This can’t be undone."
        : "These saved tabs will be deleted from Tab Stash. This can’t be undone.",
    confirmLabel: `Delete ${pluralize(visible.length, "tab")}`,
  });
  if (!confirmed) {
    return;
  }

  state.library = await deleteSavedRecords(visible.map((record) => record.id));
  render();
  elements.content.focus();
  showToast(`${pluralize(visible.length, "saved tab")} deleted.`);
}

elements.tabs.forEach((tab, index) => {
  tab.addEventListener("click", (event) =>
    setView(tab.dataset.view, {
      input: event.detail === 0 ? "keyboard" : "pointer",
    }),
  );
  tab.addEventListener("keydown", (event) => {
    if (
      event.key !== "ArrowLeft" &&
      event.key !== "ArrowRight" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }
    event.preventDefault();
    let nextIndex;
    if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = elements.tabs.length - 1;
    } else {
      const isRtl = getComputedStyle(elements.tabsRoot).direction === "rtl";
      const offset =
        event.key === "ArrowRight" ? (isRtl ? -1 : 1) : isRtl ? 1 : -1;
      nextIndex = (index + offset + elements.tabs.length) % elements.tabs.length;
    }
    setView(elements.tabs[nextIndex].dataset.view, {
      focus: true,
      input: "keyboard",
    });
  });
});

elements.search.addEventListener("input", (event) => {
  state.query = event.target.value;
  render();
});

document.addEventListener("keydown", (event) => {
  if (
    event.key === "/" &&
    document.activeElement !== elements.search &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey
  ) {
    event.preventDefault();
    elements.search.focus();
  }
});

function isUnmodifiedPrimaryClick(event) {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

elements.content.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) {
    return;
  }
  const control = event.target.closest("[data-action]");
  if (!control || !elements.content.contains(control)) {
    return;
  }

  if (control.dataset.action === "open-record") {
    if (state.opening || control.getAttribute("aria-disabled") === "true") {
      event.preventDefault();
      return;
    }
    if (!isUnmodifiedPrimaryClick(event)) {
      return;
    }
    const record = findRecord(control.dataset.recordId);
    if (!record) {
      return;
    }
    event.preventDefault();
    openRecords([record], { activateFirst: true }).catch(() =>
      showToast(openFailureMessage(1), "error"),
    );
    return;
  }

  if (!(control instanceof HTMLButtonElement)) {
    return;
  }

  if (control.dataset.action === "clear-search") {
    state.query = "";
    elements.search.value = "";
    render();
    elements.search.focus();
    return;
  }

  if (control.dataset.action === "delete-record") {
    const record = findRecord(control.dataset.recordId);
    if (record) {
      deleteRecord(record).catch(() =>
        showToast("Unable to delete the saved tab. Try again.", "error"),
      );
    }
  }

  if (control.dataset.action === "open-site") {
    const records = getVisibleRecords().filter(
      (record) => getSiteKey(record.url) === control.dataset.site,
    );
    openRecords(records).catch(() =>
      showToast(openFailureMessage(records.length), "error"),
    );
  }
});

elements.openVisible.addEventListener("click", () => {
  const records = getVisibleRecords();
  openRecords(records).catch(() =>
    showToast(openFailureMessage(records.length), "error"),
  );
});

elements.deleteVisible.addEventListener("click", () => {
  deleteVisible().catch(() =>
    showToast("Unable to delete saved tabs. Try again.", "error"),
  );
});
elements.toastDismiss.addEventListener("click", hideToast);
elements.toast.addEventListener("pointerenter", () => {
  toastPointerInside = true;
  pauseToastTimer();
});
elements.toast.addEventListener("pointerleave", () => {
  toastPointerInside = false;
  resumeToastTimer();
});
elements.toast.addEventListener("focusin", () => {
  toastFocusInside = true;
  pauseToastTimer();
});
elements.toast.addEventListener("focusout", (event) => {
  if (!elements.toast.contains(event.relatedTarget)) {
    toastFocusInside = false;
    resumeToastTimer();
  }
});
document.addEventListener("focusin", (event) => {
  if (
    !elements.toast.contains(event.target) &&
    event.target instanceof HTMLElement
  ) {
    lastStableFocus = event.target;
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes[STORAGE_KEY]?.newValue) {
    getLibrary()
      .then((library) => {
        state.library = library;
        render();
      })
      .catch(() => {});
  }
});

getLibrary()
  .then((library) => {
    state.library = library;
    render();
  })
  .catch(() => {
    showToast("Unable to load saved tabs. Reload this page.", "error");
    render();
  });
