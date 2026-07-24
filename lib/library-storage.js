import {
  STORAGE_KEY,
  createEmptyLibrary,
  mergeRecords,
  normalizeLibrary,
} from "./tab-utils.js";

export async function getLibrary(storageArea = chrome.storage.local) {
  const result = await storageArea.get(STORAGE_KEY);
  return normalizeLibrary(result[STORAGE_KEY] || createEmptyLibrary());
}

export async function setLibrary(
  library,
  storageArea = chrome.storage.local,
) {
  const normalized = normalizeLibrary(library);
  await storageArea.set({ [STORAGE_KEY]: normalized });
  return normalized;
}

export async function appendRecords(
  records,
  storageArea = chrome.storage.local,
) {
  const current = await getLibrary(storageArea);
  const next = mergeRecords(current, records);
  await storageArea.set({ [STORAGE_KEY]: next });
  return next;
}

export async function removeRecords(
  ids,
  storageArea = chrome.storage.local,
) {
  const idSet = new Set(ids);
  const current = await getLibrary(storageArea);
  const next = {
    ...current,
    general: current.general.filter((record) => !idSet.has(record.id)),
    youtube: current.youtube.filter((record) => !idSet.has(record.id)),
  };

  await storageArea.set({ [STORAGE_KEY]: next });
  return next;
}
