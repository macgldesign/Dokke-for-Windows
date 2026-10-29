import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const [pwa, model, picker, store, icon, language, grid, contentView] = await Promise.all([
  read("../public/index.html"),
  "",
  "",
  "",
  "",
  "",
  "",
  "",
]);

test("atalhos HTTP locais não expõem uma configuração na interface", () => {
  for (const source of [contentView, language, store, pwa]) {
    assert.doesNotMatch(source, /localShortcuts|LocalShortcutPolicy|local-settings\/shortcuts/);
    assert.doesNotMatch(source, /allowLocalNetworkShortcuts/);
  }
});













test("PWA renderiza e remove atalhos sem tratá-los como apps instalados", () => {
  const render = pwa.slice(pwa.indexOf("function renderLaunchpad"), pwa.indexOf("function renderDots"));
  assert.match(render, /piece\.type === "shortcut"/);
  const hold = pwa.slice(pwa.indexOf("function tileLong"), pwa.indexOf("\/\/ ---------- rendering: launchpad"));
  assert.match(hold, /piece\.type === "shortcut"/);
  assert.match(pwa, /isShortcut/);
});




