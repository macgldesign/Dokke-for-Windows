import test from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../server.js";

test("POST /api/apps/:name/activate foca via actions com pid", async () => {
  let called = null;
  const { port, close } = await startServer({
    port: 0,
    actions: { activateApp: async app => { called = app; } },
  });
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/apps/Chrome/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pid: 1234 }),
    });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true });
    assert.deepEqual(called, { name: "Chrome", pid: 1234 });
  } finally { await close(); }
});

test("POST activate sem body trata pid como undefined (abre)", async () => {
  let called = null;
  const { port, close } = await startServer({
    port: 0,
    actions: { activateApp: async app => { called = app; } },
  });
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/apps/TextEdit/activate`, { method: "POST" });
    assert.equal(r.status, 200);
    const d = await r.json();
    assert.deepEqual(d, { ok: true });
    assert.deepEqual(called, { name: "TextEdit", pid: undefined });
  } finally { await close(); }
});

test("POST activate com erro responde 500 ok:false", async () => {
  const { port, close } = await startServer({
    port: 0,
    actions: { activateApp: async () => { throw new Error("boom"); } },
  });
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/apps/Chrome/activate`, {
      method: "POST",
      body: JSON.stringify({ pid: 1 }),
    });
    assert.equal(r.status, 500);
    const d = await r.json();
    assert.equal(d.ok, false);
    assert.match(d.error, /erro interno/);
    assert.doesNotMatch(d.error, /boom/, "detalhe interno não vaza pro cliente");
  } finally { await close(); }
});

test("GET activate com URI malformada nao derruba o servidor", async () => {
  const { port, close } = await startServer({ port: 0 });
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/apps/%E0%A4%A/activate`);
    assert.ok(r.status === 400 || r.status === 404);
    const h = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(h.status, 200);
  } finally { await close(); }
});

test("POST activate com URI malformada responde 400 sem cair", async () => {
  const { port, close } = await startServer({ port: 0 });
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/apps/%E0%A4%A/activate`, {
      method: "POST",
      body: "{}",
    });
    assert.equal(r.status, 400);
    assert.deepEqual(await r.json(), { ok: false, error: "nome inválido" });
    const h = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(h.status, 200);
  } finally { await close(); }
});

test("POST activate com corpo maior que 64KB responde 413", async () => {
  const { port, close } = await startServer({ port: 0 });
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/apps/Chrome/activate`, {
      method: "POST",
      body: JSON.stringify({ pid: 1234, junk: "x".repeat(128 * 1024) }),
    });
    assert.equal(r.status, 413);
  } finally { await close(); }
});
