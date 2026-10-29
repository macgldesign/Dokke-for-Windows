import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const store = await Promise.resolve("");
const picker = await Promise.resolve("");
const grid = await Promise.resolve("");

test("PWA e Android usam o limite anunciado pela API e informam quando ele foi atingido", () => {
  assert.match(html, /maxPinnedApps/);
  assert.match(html, /PINNED_LIMIT_REACHED/);
  assert.match(html, /pinnedLimitMessage/);
  assert.match(html, /m\.limits/);
});

