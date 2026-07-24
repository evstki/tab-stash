import test from "node:test";
import assert from "node:assert/strict";

import { captureAndClose } from "../lib/capture.js";
import { createMutationQueue } from "../lib/mutation-queue.js";
import {
  allRecords,
  createEmptyLibrary,
  getSiteKey,
  isRestorableUrl,
  isYouTubeUrl,
  makeSavedRecord,
  mergeRecords,
  normalizeLibrary,
  partitionTabs,
} from "../lib/tab-utils.js";

test("YouTube classification honors hostname boundaries", () => {
  assert.equal(isYouTubeUrl("https://youtube.com/watch?v=1"), true);
  assert.equal(isYouTubeUrl("https://music.youtube.com/playlist"), true);
  assert.equal(isYouTubeUrl("https://youtu.be/abc"), true);
  assert.equal(isYouTubeUrl("https://youtube-nocookie.com/embed/abc"), true);
  assert.equal(isYouTubeUrl("https://notyoutube.com/watch"), false);
  assert.equal(isYouTubeUrl("https://youtube.com.evil.example/watch"), false);
  assert.equal(isYouTubeUrl("chrome://extensions"), false);
});

test("only HTTP and HTTPS pages are considered restorable", () => {
  assert.equal(isRestorableUrl("https://example.com"), true);
  assert.equal(isRestorableUrl("http://example.com"), true);
  assert.equal(isRestorableUrl("chrome://settings"), false);
  assert.equal(isRestorableUrl("file:///tmp/note.html"), false);
  assert.equal(isRestorableUrl("not a URL"), false);
});

test("site keys are stable and strip only www", () => {
  assert.equal(getSiteKey("https://www.example.com/path"), "example.com");
  assert.equal(getSiteKey("https://docs.example.com/path"), "docs.example.com");
  assert.equal(getSiteKey("bad url"), "Other");
});

test("tab partitioning is stable and skips protected pages", () => {
  const tabs = [
    { id: 1, url: "https://example.com" },
    { id: 2, url: "https://www.youtube.com/watch?v=1" },
    { id: 3, url: "chrome://extensions" },
  ];
  const result = partitionTabs(tabs);
  assert.deepEqual(result.general.map((tab) => tab.id), [1]);
  assert.deepEqual(result.youtube.map((tab) => tab.id), [2]);
  assert.deepEqual(result.skipped.map((tab) => tab.id), [3]);
});

test("saved records preserve restore metadata", () => {
  const record = makeSavedRecord(
    {
      id: 3,
      url: "https://example.com/a",
      title: " A useful page ",
      index: 7,
      windowId: 9,
      pinned: true,
    },
    {
      id: "tab-1",
      captureId: "capture-1",
      savedAt: "2026-07-24T12:00:00.000Z",
    },
  );

  assert.deepEqual(record, {
    id: "tab-1",
    captureId: "capture-1",
    url: "https://example.com/a",
    title: "A useful page",
    site: "example.com",
    savedAt: "2026-07-24T12:00:00.000Z",
    originalIndex: 7,
    originalWindowId: 9,
    pinned: true,
  });
});

test("library normalization drops malformed and misbucketed records", () => {
  const library = normalizeLibrary({
    general: [
      {
        id: "good",
        url: "https://example.com",
        savedAt: "2026-07-24T12:00:00.000Z",
      },
      { id: "wrong", url: "https://youtube.com/watch?v=1" },
      { id: "invalid", url: "chrome://settings" },
    ],
    youtube: [],
  });

  assert.deepEqual(library.general.map((record) => record.id), ["good"]);
  assert.equal(library.youtube.length, 0);
});

test("merging records keeps buckets separate and ignores duplicate IDs", () => {
  const base = createEmptyLibrary();
  const general = makeSavedRecord(
    { url: "https://example.com", title: "Example" },
    { id: "same", captureId: "capture", savedAt: "2026-07-24T12:00:00.000Z" },
  );
  const duplicate = { ...general, url: "https://another.example" };
  const youtube = makeSavedRecord(
    { url: "https://youtu.be/abc", title: "Video" },
    { id: "video", captureId: "capture", savedAt: "2026-07-24T12:00:00.000Z" },
  );
  const merged = mergeRecords(base, [general, duplicate, youtube]);

  assert.deepEqual(merged.general.map((record) => record.id), ["same"]);
  assert.deepEqual(merged.youtube.map((record) => record.id), ["video"]);
  assert.equal(allRecords(merged).length, 2);
});

test("capture persists the complete batch before closing tabs", async () => {
  const order = [];
  const removed = [];
  const result = await captureAndClose({
    mode: "all",
    windowId: 12,
    operationId: "operation-1",
    tabsApi: {
      async query() {
        return [
          { id: 1, url: "https://example.com", index: 0, windowId: 12 },
          { id: 2, url: "https://youtube.com/watch?v=1", index: 1, windowId: 12 },
          { id: 3, url: "chrome://settings", index: 2, windowId: 12 },
        ];
      },
      async remove(id) {
        order.push(`remove:${id}`);
        removed.push(id);
      },
    },
    async persistRecords(records) {
      order.push(`persist:${records.length}`);
    },
    now: () => "2026-07-24T12:00:00.000Z",
    createId: (tab) => `tab-${tab.id}`,
  });

  assert.deepEqual(order, ["persist:2", "remove:1", "remove:2"]);
  assert.deepEqual(removed, [1, 2]);
  assert.deepEqual(result, {
    operationId: "operation-1",
    stored: 2,
    closed: 2,
    failedToClose: 0,
    skipped: 1,
  });
});

test("capture closes nothing when persistence fails", async () => {
  let removeCalls = 0;
  await assert.rejects(
    captureAndClose({
      mode: "all",
      windowId: 12,
      tabsApi: {
        async query() {
          return [{ id: 1, url: "https://example.com" }];
        },
        async remove() {
          removeCalls += 1;
        },
      },
      async persistRecords() {
        throw new Error("quota exceeded");
      },
    }),
    /quota exceeded/,
  );
  assert.equal(removeCalls, 0);
});

test("YouTube capture leaves regular tabs untouched", async () => {
  const removed = [];
  let persisted = [];
  let queryProperties;
  const result = await captureAndClose({
    mode: "youtube",
    scope: "all-windows",
    operationId: "operation-youtube",
    tabsApi: {
      async query(properties) {
        queryProperties = properties;
        return [
          { id: 1, url: "https://example.com" },
          { id: 2, url: "https://music.youtube.com/watch?v=1" },
        ];
      },
      async remove(id) {
        removed.push(id);
      },
    },
    async persistRecords(records) {
      persisted = records;
    },
    createId: (tab) => `tab-${tab.id}`,
  });

  assert.deepEqual(removed, [2]);
  assert.deepEqual(persisted.map((record) => record.id), ["tab-2"]);
  assert.deepEqual(queryProperties, { windowType: "normal" });
  assert.equal(result.stored, 1);
});

test("storage mutations run in strict order even when queued concurrently", async () => {
  const enqueue = createMutationQueue();
  const order = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });

  const first = enqueue(async () => {
    order.push("first:start");
    await firstGate;
    order.push("first:end");
  });
  const second = enqueue(async () => {
    order.push("second:start");
    order.push("second:end");
  });

  await Promise.resolve();
  assert.deepEqual(order, ["first:start"]);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(order, [
    "first:start",
    "first:end",
    "second:start",
    "second:end",
  ]);
});

test("a failed mutation does not block the queue", async () => {
  const enqueue = createMutationQueue();
  const order = [];
  const failed = enqueue(async () => {
    order.push("failed");
    throw new Error("expected");
  });
  const recovered = enqueue(async () => {
    order.push("recovered");
  });

  await assert.rejects(failed, /expected/);
  await recovered;
  assert.deepEqual(order, ["failed", "recovered"]);
});
