import {
  STORAGE_KEY,
  allRecords,
  getSiteKey,
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
  clearVisible: document.querySelector("#clear-visible"),
  totalSummary: document.querySelector("#total-summary"),
  countAll: document.querySelector("#count-all"),
  countYouTube: document.querySelector("#count-youtube"),
  countSites: document.querySelector("#count-sites"),
  toast: document.querySelector("#toast"),
};

const state = {
  library: { general: [], youtube: [] },
  view: "all",
  query: "",
  opening: false,
};

let toastTimer;

function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
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

function showToast(message, tone = "info") {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.dataset.tone = tone;
  elements.toast.classList.add("is-visible");
  toastTimer = setTimeout(() => {
    elements.toast.classList.remove("is-visible");
  }, 2800);
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
  const row = createElement("article", "tab-row");
  row.dataset.recordId = record.id;

  const meta = createElement("div", "tab-meta");
  const title = createElement("h3", "tab-title", record.title);
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

  const actions = createElement("div", "tab-actions");
  const openButton = createElement("button", "row-action", "↗");
  openButton.type = "button";
  openButton.title = "Open";
  openButton.dataset.action = "open-record";
  openButton.dataset.recordId = record.id;
  openButton.setAttribute("aria-label", `Open ${record.title}`);

  const deleteButton = createElement(
    "button",
    "row-action row-action--delete",
    "×",
  );
  deleteButton.type = "button";
  deleteButton.dataset.action = "delete-record";
  deleteButton.dataset.recordId = record.id;
  deleteButton.setAttribute("aria-label", `Delete ${record.title}`);
  actions.append(openButton, deleteButton);

  row.append(createFavicon(record), meta, actions);
  return row;
}

function createList(records) {
  const list = createElement("div", "tab-list");
  for (const record of records) {
    list.append(createTabRow(record));
  }
  return list;
}

function createSiteGroups(records) {
  const container = createElement("div", "site-groups");

  for (const group of groupRecordsBySite(records)) {
    const card = createElement("section", "site-card");
    const header = createElement("header", "site-header");
    const heading = createElement("div", "site-heading");
    const text = createElement("div");
    const title = createElement("h3", "", group.site);
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
      `Open all ${group.items.length} tabs from ${group.site}`,
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
  const pathOne = document.createElementNS("http://www.w3.org/2000/svg", "path");
  pathOne.setAttribute("d", "M4 7h16v12H4z");
  const pathTwo = document.createElementNS("http://www.w3.org/2000/svg", "path");
  pathTwo.setAttribute("d", "M8 4h8M8 11h8");
  icon.append(pathOne, pathTwo);
  art.append(icon);

  let heading = "No saved tabs";
  if (state.query) {
    heading = "No results";
  } else if (state.view === "youtube") {
    heading = "No YouTube tabs";
  } else if (state.view === "sites") {
    heading = "No saved sites";
  }

  content.append(art, createElement("h3", "", heading));
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
    elements.openVisible.textContent = "Open results";
    elements.clearVisible.textContent = "Clear results";
  } else if (state.view === "youtube") {
    elements.openVisible.textContent = "Open YouTube";
    elements.clearVisible.textContent = "Clear YouTube";
  } else {
    elements.openVisible.textContent = "Open all";
    elements.clearVisible.textContent = "Clear";
  }

  elements.openVisible.disabled = visible.length === 0 || state.opening;
  elements.clearVisible.disabled = visible.length === 0 || state.opening;

  elements.content.replaceChildren(
    visible.length === 0
      ? createEmptyState()
      : state.view === "sites"
        ? createSiteGroups(visible)
        : createList(visible),
  );

  for (const button of elements.content.querySelectorAll(
    '[data-action="open-record"], [data-action="open-site"], [data-action="delete-record"]',
  )) {
    button.disabled = state.opening;
  }
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

async function openRecords(records, { activateFirst = false } = {}) {
  if (state.opening || records.length === 0) {
    return;
  }

  state.opening = true;
  render();
  let opened = 0;
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
      showToast("Chrome could not open these tabs.", "error");
    } else if (failed > 0) {
      showToast(
        `${pluralize(opened, "tab")} opened; ${pluralize(failed, "tab")} could not open.`,
        "error",
      );
    } else {
      showToast(`${pluralize(opened, "tab")} opened. Saved copies were kept.`);
    }
  } finally {
    state.opening = false;
    render();
  }
}

async function deleteSavedRecords(ids) {
  const response = await chrome.runtime.sendMessage({
    type: "DELETE_RECORDS",
    ids,
  });
  if (!response?.ok) {
    throw new Error(response?.error || "The saved tabs could not be removed.");
  }
  return response.library;
}

async function deleteRecord(record) {
  const confirmed = window.confirm(`Remove “${record.title}” from Tab Stash?`);
  if (!confirmed) {
    return;
  }

  state.library = await deleteSavedRecords([record.id]);
  render();
  elements.content.focus();
  showToast("Saved tab removed.");
}

async function clearVisible() {
  const visible = getVisibleRecords();
  if (visible.length === 0) {
    return;
  }

  const confirmed = window.confirm(
    `Remove ${pluralize(visible.length, "saved tab")} from Tab Stash?`,
  );
  if (!confirmed) {
    return;
  }

  state.library = await deleteSavedRecords(visible.map((record) => record.id));
  render();
  elements.content.focus();
  showToast(`${pluralize(visible.length, "saved tab")} removed.`);
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
      const offset = event.key === "ArrowRight" ? 1 : -1;
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

elements.content.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) {
    return;
  }

  if (button.dataset.action === "open-record") {
    const record = findRecord(button.dataset.recordId);
    if (record) {
      openRecords([record], { activateFirst: true });
    }
  }

  if (button.dataset.action === "delete-record") {
    const record = findRecord(button.dataset.recordId);
    if (record) {
      deleteRecord(record).catch(() =>
        showToast("The saved tab could not be removed.", "error"),
      );
    }
  }

  if (button.dataset.action === "open-site") {
    const records = getVisibleRecords().filter(
      (record) => getSiteKey(record.url) === button.dataset.site,
    );
    openRecords(records);
  }
});

elements.openVisible.addEventListener("click", () => {
  openRecords(getVisibleRecords());
});

elements.clearVisible.addEventListener("click", () => {
  clearVisible().catch(() =>
    showToast("The saved tabs could not be removed.", "error"),
  );
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
    showToast("Storage could not be loaded. Reload this page.", "error");
    render();
  });
