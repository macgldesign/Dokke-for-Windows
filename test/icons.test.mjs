import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { createIconService, isSvg, monogramSvg, normalizePngIcon } from "../icons.js";

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function rgbaPng(w, h, fn) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b, a] = fn(x, y); const o = y * (w * 4 + 1) + 1 + x * 4;
    raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const solid = rgbaPng(8, 8, () => [200, 30, 30, 255]);
const empty = rgbaPng(8, 8, () => [0, 0, 0, 0]);

test("monogramSvg é SVG determinístico com iniciais seguras", () => {
  const a = monogramSvg("Visual Studio Code");
  assert.ok(isSvg(a));
  assert.equal(a.toString(), monogramSvg("Visual Studio Code").toString());
  assert.match(a.toString(), />VS</);
  assert.doesNotMatch(monogramSvg("<script>").toString(), /<script>/);
});

test("normalizePngIcon mantém PNG válido", () => {
  const out = normalizePngIcon(solid, 64);
  assert.equal(out.subarray(1, 4).toString(), "PNG");
});

test("serviço usa o ícone do app, cacheia em disco e só lê uma vez", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dokke-icons-"));
  try {
    let reads = 0;
    const apps = [{ name: "A", path: "C:\\a.exe" }];
    const mk = () => createIconService({ listApps: async () => apps, readRawIcon: async () => { reads++; return solid; }, cacheDir: dir });
    const first = await mk().getIconPng("A");
    assert.equal(first.subarray(1, 4).toString(), "PNG");
    await mk().getIconPng("A"); // novo serviço: vem do disco
    assert.equal(reads, 1);
    assert.equal((await readdir(dir)).length, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("sem ícone, ícone vazio ou erro viram monograma SVG; app desconhecido também", async () => {
  const apps = [{ name: "Vazio", path: "x" }, { name: "Falha", path: "y" }, { name: "Nulo", path: "z" }];
  const svc = createIconService({
    listApps: async () => apps,
    readRawIcon: async app => { if (app.name === "Falha") throw new Error("x"); return app.name === "Vazio" ? empty : null; },
  });
  for (const name of ["Vazio", "Falha", "Nulo", "Desconhecido"]) assert.ok(isSvg(await svc.getIconPng(name)), name);
  assert.equal(await svc.getIconPng(""), null);
});

test("miss não rescaneia o inventário a cada pedido", async () => {
  let scans = 0;
  const svc = createIconService({ listApps: async () => { scans++; return []; }, readRawIcon: async () => null });
  await svc.getIconPng("X"); await svc.getIconPng("Y"); await svc.getIconPng("X");
  assert.equal(scans, 1);
});
