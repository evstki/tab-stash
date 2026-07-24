export const STORAGE_KEY = "tabStashLibrary";
export const LIBRARY_VERSION = 1;

const YOUTUBE_HOSTS = ["youtube.com", "youtu.be", "youtube-nocookie.com"];

export function createEmptyLibrary() {
  return {
    version: LIBRARY_VERSION,
    general: [],
    youtube: [],
  };
}

export function getTabUrl(tab) {
  return typeof tab?.pendingUrl === "string" && tab.pendingUrl
    ? tab.pendingUrl
    : typeof tab?.url === "string"
      ? tab.url
      : "";
}

export function isRestorableUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function isYouTubeUrl(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase().replace(/\.$/, "");
    return YOUTUBE_HOSTS.some(
      (host) => hostname === host || hostname.endsWith(`.${host}`),
    );
  } catch {
    return false;
  }
}

export function getSiteKey(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase().replace(/\.$/, "");
    return hostname.replace(/^www\./, "") || "Other";
  } catch {
    return "Other";
  }
}

export function makeId(prefix = "item") {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) {
    return `${prefix}-${uuid}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function makeSavedRecord(
  tab,
  {
    id = makeId("tab"),
    captureId = makeId("capture"),
    savedAt = new Date().toISOString(),
  } = {},
) {
  const url = getTabUrl(tab);
  const site = getSiteKey(url);

  return {
    id,
    captureId,
    url,
    title:
      typeof tab?.title === "string" && tab.title.trim()
        ? tab.title.trim()
        : site,
    site,
    savedAt,
    originalIndex: Number.isInteger(tab?.index) ? tab.index : 0,
    originalWindowId: Number.isInteger(tab?.windowId) ? tab.windowId : null,
    pinned: Boolean(tab?.pinned),
  };
}

export function partitionTabs(tabs) {
  return (Array.isArray(tabs) ? tabs : []).reduce(
    (result, tab) => {
      const url = getTabUrl(tab);

      if (!Number.isInteger(tab?.id) || !isRestorableUrl(url)) {
        result.skipped.push(tab);
      } else if (isYouTubeUrl(url)) {
        result.youtube.push(tab);
      } else {
        result.general.push(tab);
      }

      return result;
    },
    { general: [], youtube: [], skipped: [] },
  );
}

function normalizeRecord(record, expectedBucket) {
  if (!record || typeof record !== "object" || !isRestorableUrl(record.url)) {
    return null;
  }

  const bucket = isYouTubeUrl(record.url) ? "youtube" : "general";
  if (bucket !== expectedBucket) {
    return null;
  }

  return {
    id: typeof record.id === "string" && record.id ? record.id : makeId("tab"),
    captureId:
      typeof record.captureId === "string" && record.captureId
        ? record.captureId
        : makeId("capture"),
    url: record.url,
    title:
      typeof record.title === "string" && record.title.trim()
        ? record.title.trim()
        : getSiteKey(record.url),
    site: getSiteKey(record.url),
    savedAt:
      typeof record.savedAt === "string" && !Number.isNaN(Date.parse(record.savedAt))
        ? record.savedAt
        : new Date(0).toISOString(),
    originalIndex: Number.isInteger(record.originalIndex)
      ? record.originalIndex
      : 0,
    originalWindowId: Number.isInteger(record.originalWindowId)
      ? record.originalWindowId
      : null,
    pinned: Boolean(record.pinned),
  };
}

export function normalizeLibrary(value) {
  const empty = createEmptyLibrary();
  if (!value || typeof value !== "object") {
    return empty;
  }

  const candidates = {
    general: Array.isArray(value.general) ? value.general : [],
    youtube: Array.isArray(value.youtube) ? value.youtube : [],
  };

  for (const bucket of ["general", "youtube"]) {
    for (const record of candidates[bucket]) {
      const normalized = normalizeRecord(record, bucket);
      if (normalized) {
        empty[bucket].push(normalized);
      }
    }
  }

  return empty;
}

export function mergeRecords(library, records) {
  const next = normalizeLibrary(library);
  const existingIds = new Set([
    ...next.general.map((record) => record.id),
    ...next.youtube.map((record) => record.id),
  ]);

  for (const record of Array.isArray(records) ? records : []) {
    if (!record?.id || existingIds.has(record.id) || !isRestorableUrl(record.url)) {
      continue;
    }

    const bucket = isYouTubeUrl(record.url) ? "youtube" : "general";
    next[bucket].push({
      ...record,
      site: getSiteKey(record.url),
    });
    existingIds.add(record.id);
  }

  return next;
}

export function allRecords(library) {
  const normalized = normalizeLibrary(library);
  return [...normalized.general, ...normalized.youtube].sort(compareRecords);
}

export function compareRecords(left, right) {
  const timeDifference = Date.parse(right.savedAt) - Date.parse(left.savedAt);
  if (timeDifference !== 0) {
    return timeDifference;
  }

  return left.originalIndex - right.originalIndex;
}

export function groupRecordsBySite(records) {
  const groups = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    const site = getSiteKey(record.url);
    if (!groups.has(site)) {
      groups.set(site, []);
    }
    groups.get(site).push(record);
  }

  return [...groups.entries()]
    .map(([site, items]) => ({
      site,
      items: [...items].sort(compareRecords),
    }))
    .sort(
      (left, right) =>
        right.items.length - left.items.length ||
        left.site.localeCompare(right.site),
    );
}

export function matchesSearch(record, query) {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  return [record.title, record.site, record.url].some((value) =>
    String(value || "").toLowerCase().includes(normalizedQuery),
  );
}
