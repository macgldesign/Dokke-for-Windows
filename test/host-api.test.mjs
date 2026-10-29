import test from "node:test";
import assert from "node:assert/strict";
import { request, createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { startServer } from "../server.js";
import { monogramSvg } from "../icons.js";

const noopActions = { activateApp: async () => ({ focused: true }), openWebsite: async () => {}, listShortcuts: async () => [], runShortcut: async () => {} };
const emptyTools = { listAppProcesses: async () => [], listInstalledApps: async () => [] };

async function withServer(opts, fn) {
  const dataDir = await mkdtemp(join(tmpdir(), "dokke-host-"));
  const { port, close } = await startServer({ port: 0, dataDir, obs: null, appTools: emptyTools, actions: noopActions, ...opts });
  try { await fn(port, dataDir); } finally { await close(); await rm(dataDir, { recursive: true, force: true }); }
}
function rawGet(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, headers }, res => {
      let body = ""; res.on("data", c => body += c); res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on("error", reject); req.end();
  });
}

test("GET /api/host/info entrega PIN, porta e URLs só para o dono (loopback)", async () => {
  await withServer({}, async port => {
    const r = await rawGet(port, "/api/host/info");
    const data = JSON.parse(r.body);
    assert.equal(r.status, 200);
    assert.match(data.pin, /^\d{4}$/);
    assert.equal(data.port, port);
    assert.ok(Array.isArray(data.urls));
    assert.equal(typeof data.version, "string");
    // DNS rebinding: Host externo não herda a confiança do loopback
    const rebind = await rawGet(port, "/api/host/info", { Host: "evil.example.com" });
    assert.equal(rebind.status, 403);
    assert.doesNotMatch(rebind.body, /\d{4}/);
  });
});

test("GET /host serve a tela do host sem cache", async () => {
  await withServer({}, async port => {
    const r = await rawGet(port, "/host");
    assert.equal(r.status, 200);
    assert.match(r.headers["content-type"], /text\/html/);
    assert.match(r.headers["cache-control"], /no-store/);
    assert.match(r.body, /<title>Dokke<\/title>/);
    assert.equal((await rawGet(port, "/qr.js")).status, 200);
  });
});

test("origem fora da rede local é recusada em HTTP e WebSocket", async () => {
  await withServer({ allowRemote: () => false }, async port => {
    assert.equal((await rawGet(port, "/health")).status, 403);
    assert.equal((await rawGet(port, "/api/apps")).status, 403);
    await new Promise(resolve => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
      ws.on("open", () => { ws.close(); assert.fail("não deveria conectar"); });
      ws.on("error", () => resolve());
      ws.on("unexpected-response", () => resolve());
    });
  });
});

test("origem local passa pela guarda por padrão", async () => {
  await withServer({}, async port => assert.equal((await rawGet(port, "/health")).status, 200));
});

test("ativar app inexistente responde 404 com código estável", async () => {
  const err = Object.assign(new Error("app não encontrado"), { code: "APP_NOT_FOUND", status: 404 });
  await withServer({ actions: { ...noopActions, activateApp: async () => { throw err; } } }, async port => {
    const r = await fetch(`http://127.0.0.1:${port}/api/apps/Nada/activate`, { method: "POST", body: "{}" });
    assert.equal(r.status, 404);
    const body = await r.json();
    assert.equal(body.code, "APP_NOT_FOUND");
  });
});

test("ativar app informa se a janela realmente veio para frente", async () => {
  await withServer({ actions: { ...noopActions, activateApp: async () => ({ focused: false, launched: false }) } }, async port => {
    const r = await fetch(`http://127.0.0.1:${port}/api/apps/Chrome/activate`, { method: "POST", body: "{}" });
    assert.deepEqual(await r.json(), { ok: true, focused: false });
  });
});

test("ícone de monograma é servido como SVG e ícone real como PNG", async () => {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  await withServer({ iconService: { getIconPng: async n => (n === "Real" ? png : monogramSvg(n)) } }, async port => {
    const svg = await fetch(`http://127.0.0.1:${port}/api/apps/Chrome/icon`);
    assert.equal(svg.headers.get("content-type"), "image/svg+xml");
    const real = await fetch(`http://127.0.0.1:${port}/api/apps/Real/icon`);
    assert.equal(real.headers.get("content-type"), "image/png");
  });
});

test("portFallback usa a próxima porta livre quando a escolhida está ocupada", async () => {
  const occupied = createServer((req, res) => res.end("x"));
  await new Promise((resolve, reject) => { occupied.once("error", reject); occupied.listen(0, resolve); });
  const busy = occupied.address().port;
  try {
    const dataDir = await mkdtemp(join(tmpdir(), "dokke-fb-"));
    const started = await startServer({ port: busy, portFallback: true, dataDir, obs: null, appTools: emptyTools, actions: noopActions });
    try {
      assert.ok(started.port > busy && started.port <= busy + 9, `porta ${started.port}`);
      assert.equal((await rawGet(started.port, "/health")).status, 200);
    } finally { await started.close(); await rm(dataDir, { recursive: true, force: true }); }
  } finally { await new Promise(r => occupied.close(r)); }
});

test("sem portFallback, porta ocupada continua rejeitando", async () => {
  const occupied = createServer((req, res) => res.end("x"));
  await new Promise((resolve, reject) => { occupied.once("error", reject); occupied.listen(0, resolve); });
  try {
    const dataDir = await mkdtemp(join(tmpdir(), "dokke-nofb-"));
    await assert.rejects(startServer({ port: occupied.address().port, dataDir, obs: null, appTools: emptyTools, actions: noopActions }), /EADDRINUSE/);
    await rm(dataDir, { recursive: true, force: true });
  } finally { await new Promise(r => occupied.close(r)); }
});

test("PWA aceita PIN no fragmento (#pin=NNNN), limpa a URL e autentica sozinha", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /\/\^#pin=\(\\d\{4\}\)\$\/\.exec\(location\.hash/);
  assert.match(html, /history\.replaceState\(null, "", location\.pathname \+ location\.search\)/);
  assert.match(html, /if \(pendingPin && pin\)\{ pin\.value = pendingPin; pendingPin = null; setTimeout\(doLogin, 0\); \}/);
});

test("QR: matriz com localizadores, tamanho por versão e saída determinística", async () => {
  const src = await readFile(new URL("../public/qr.js", import.meta.url), "utf8");
  const root = {};
  new Function("self", src)(root);
  const m = root.DokkeQR.matrix("http://192.168.0.15:3000/#pin=1234");
  assert.equal(m.length, 29); // versão 3
  const finder = (r, c) => [0, 6].every(d => m[r][c + d] === 1 && m[r + d][c] === 1 && m[r + 6][c + d] === 1) && m[r + 3][c + 3] === 1 && m[r + 1][c + 1] === 0;
  assert.ok(finder(0, 0) && finder(0, m.length - 7) && finder(m.length - 7, 0));
  assert.deepEqual(m, root.DokkeQR.matrix("http://192.168.0.15:3000/#pin=1234"));
  assert.match(root.DokkeQR.svg("abc"), /^<svg /);
  assert.throws(() => root.DokkeQR.matrix("x".repeat(400)), /longo demais/);
});
