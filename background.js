import { captureAndClose } from "./lib/capture.js";
import { appendRecords, removeRecords } from "./lib/library-storage.js";
import { createMutationQueue } from "./lib/mutation-queue.js";

const enqueueMutation = createMutationQueue();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  let operation;

  if (message?.type === "CAPTURE_AND_CLOSE") {
    operation = enqueueMutation(() =>
      captureAndClose({
        mode: message.mode,
        windowId: message.windowId,
        scope: message.scope,
        operationId: message.operationId,
        persistRecords: appendRecords,
      }),
    );
  } else if (message?.type === "DELETE_RECORDS") {
    const ids = Array.isArray(message.ids)
      ? message.ids.filter((id) => typeof id === "string" && id)
      : [];

    operation = enqueueMutation(async () => {
      const library = await removeRecords(ids);
      return { library };
    });
  } else {
    return false;
  }

  operation
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) =>
      sendResponse({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "The storage operation could not be completed.",
      }),
    );

  return true;
});
