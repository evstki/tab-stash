import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const popupCss = await readFile(
  new URL("../popup.css", import.meta.url),
  "utf8",
);

test("popup keeps its intrinsic width while Chrome calculates the viewport", () => {
  const geometry = popupCss.match(/html,\s*body\s*\{([^}]*)\}/s)?.[1] ?? "";

  assert.match(geometry, /width:\s*352px/);
  assert.match(geometry, /min-width:\s*352px/);
  assert.doesNotMatch(geometry, /max-width:\s*100vw/);
});
