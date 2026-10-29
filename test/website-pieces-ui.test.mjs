import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const pwa = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const picker = await Promise.resolve("");
const grid = await Promise.resolve("");
const icon = await Promise.resolve("");
const store = await Promise.resolve("");

test("@spec:AC-310 PWA monta sites e atalhos a partir de pieces sem inventário de apps", () => {
  const render = pwa.slice(pwa.indexOf("function renderLaunchpad"), pwa.indexOf("function renderDots"));
  assert.match(render, /state\.pieces\.length/);
  assert.match(render, /piece\.type === "website"/);
  assert.match(render, /piece\.type === "website" \|\| piece\.type === "shortcut"\) byPosition\.set\(position, piece\)/);
  assert.doesNotMatch(render, /if \(!state\.installedReady\)/);
});

test("@spec:AC-311 companion abre site somente por ID remoto e permanece no Dokke", () => {
  const action = pwa.slice(pwa.indexOf("async function activatePiece"), pwa.indexOf("async function pinApp"));
  assert.match(action, /\/api\/pieces\/" \+ encodeURIComponent\(piece\.id\) \+ "\/open/);
  assert.doesNotMatch(action, /window\.open|location\.(assign|replace)|href/);
  const tile = pwa.slice(pwa.indexOf("function buildTile"), pwa.indexOf("function replaceChildren"));
  assert.match(tile, /tile\.dataset\.id = a\.id/);
  assert.match(tile, /tile\.dataset\.type = a\.type/);
  assert.doesNotMatch(tile, /<a|href/);
});








test("PWA busca favicon de website com fallback resiliente", () => {
  const favicon = pwa.slice(pwa.indexOf("function websiteFaviconPath"), pwa.indexOf("function loadIcon"));
  const tile = pwa.slice(pwa.indexOf("function buildTile"), pwa.indexOf("function replaceChildren"));
  assert.match(favicon, /www\.google\.com/);
  assert.match(favicon, /s2\/favicons/);
  assert.match(favicon, /domain/);
  assert.match(favicon, /sz/);
  assert.match(pwa, /function websiteFaviconFallbackPath/);
  assert.match(tile, /a\.type === "website" && img\.dataset\.faviconFallback !== "1"/);
  assert.match(tile, /websiteFaviconFallbackPath\(a\.url\)/);
});



test("PWA e APK usam a mesma placa branca para favicon de website", () => {
  const tile = pwa.slice(pwa.indexOf("function buildTile"), pwa.indexOf("function replaceChildren"));
  assert.match(pwa, /\.website-plate\{[\s\S]*width: 80%; height: 80%;[\s\S]*background: rgba\(255,255,255,\.96\)/);
  assert.match(pwa, /\.atile \.aglass \.website-plate img\.aicon\{[\s\S]*width: calc\(100% \* var\(--tile-in\)\); height: calc\(100% \* var\(--tile-in\)\);/);
  assert.match(pwa, /\.atile \.aglass \.website-plate \.gicon\{[\s\S]*width: calc\(100% \* var\(--tile-in\)\); height: calc\(100% \* var\(--tile-in\)\);/);
  assert.match(pwa, /\.website-plate img\.aicon[\s\S]*object-fit: cover;/);
  assert.match(tile, /const websitePlate = a\.type === "website"/);
  assert.match(tile, /websitePlate\.appendChild\(img\)/);
  assert.match(tile, /websitePlate \|\| glass/);
});


test("PWA mantém o vazio no mesmo slot persistido", () => {
  const render = pwa.slice(pwa.indexOf("function renderLaunchpad"), pwa.indexOf("function renderDots"));
  assert.match(render, /piece\.position/);
  assert.match(render, /buildEmptyTile\(\)/);
  assert.match(render, /state\.maxPinnedPages/);
  assert.match(render, /pageCount \* pz/);
  assert.match(pwa, /\.atile\.empty/);
  const statuses = pwa.slice(pwa.indexOf("function updateStatuses"), pwa.indexOf("// tela 2:"));
  assert.match(statuses, /if \(!st\) continue/);
});
