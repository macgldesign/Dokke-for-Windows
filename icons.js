// Pipeline de ícones independente de plataforma: normalização de PNG, caches
// (memória LRU + disco com teto) e monograma de fallback. Cada plataforma só
// precisa fornecer `listApps()` e `readRawIcon(app)` (ver platform/windows.js).
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { deflateSync, inflateSync } from "node:zlib";

/** Ícone servido em até 512px para acompanhar telas de alta densidade. */
export const ICON_MAX_PX = 512;
/** TTL do inventário de apps usado pelo serviço de ícones. */
export const INSTALLED_APPS_TTL_MS = 120_000;
/** Cap do cache PNG em memória (LRU). Disco continua cacheando o resto. */
export const MEM_PNG_MAX = 40;
/** Cap de arquivos no cache de ícones em disco (poda os mais antigos). */
export const DISK_PNG_MAX = 256;

function lruSet(map, key, value, max) {
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  while (map.size > max) {
    const first = map.keys().next().value;
    map.delete(first);
  }
}

/** Poda o cache em disco: mantém só os DISK_PNG_MAX pngs mais recentes. */
export async function pruneIconCache(cacheDir, maxFiles = DISK_PNG_MAX, fsDeps = {}) {
  const readdirFn = fsDeps.readdir ?? readdir;
  const unlinkFn = fsDeps.unlink ?? unlink;
  const statFn = fsDeps.stat ?? stat;
  let files;
  try {
    files = (await readdirFn(cacheDir)).filter(f => f.endsWith(".png"));
  } catch { return; }
  if (files.length <= maxFiles) return;
  const dated = await Promise.all(files.map(async f => {
    const full = join(cacheDir, f);
    try { return { full, mtime: (await statFn(full)).mtimeMs }; } catch { return null; }
  }));
  const alive = dated.filter(Boolean).sort((a, b) => a.mtime - b.mtime);
  const excess = alive.slice(0, alive.length - maxFiles);
  await Promise.all(excess.map(e => unlinkFn(e.full).catch(() => {})));
}


/** PNG tem conteúdo visível? conversores podem gerar PNG todo transparente p/ alguns .icns
 *  (ex.: Books.app) — nesse caso tratamos como "sem ícone" (cai no monograma no cliente). */
function pngIsEmpty(buf) {
  try {
    if (!buf || buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47) return false;
    let off = 8;
    let idat = [];
    let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0, hasIHDR = false;
    while (off + 8 <= buf.length) {
      const len = buf.readUInt32BE(off);
      const type = buf.toString("latin1", off + 4, off + 8);
      const dataStart = off + 8;
      if (type === "IHDR") {
        hasIHDR = true;
        width = buf.readUInt32BE(dataStart);
        height = buf.readUInt32BE(dataStart + 4);
        bitDepth = buf[dataStart + 8];
        colorType = buf[dataStart + 9];
        interlace = buf[dataStart + 12];
      } else if (type === "IDAT") {
        idat.push(buf.subarray(dataStart, dataStart + len));
      } else if (type === "IEND") {
        break;
      }
      off = dataStart + len + 4; // pula CRC
    }
    if (!hasIHDR || interlace !== 0) return false;
    const hasAlpha = colorType === 6 || colorType === 4; // RGBA / gray+alpha
    if (!hasAlpha || bitDepth !== 8 || width < 1 || height < 1) return false;
    if (idat.length === 0) return false;
    const raw = inflateSync(Buffer.concat(idat));
    const channels = colorType === 6 ? 4 : 2;
    const stride = width * channels;
    let visible = 0, total = 0, p = 0;
    for (let y = 0; y < height; y++) {
      p += 1; // byte de filtro por linha
      for (let x = 0; x < width; x++) {
        const alphaIdx = p + x * channels + (channels - 1);
        if (alphaIdx + 1 > raw.length) return false;
        if (raw[alphaIdx] > 8) visible++;
        total++;
      }
      p += stride;
    }
    return total === 0 || visible / total < 0.01; // <1% opaco => vazio
  } catch (e) {
    return false;
  }
}

const MONOGRAM_COLORS = [
  ["#0a84ff","#5e5ce6"], ["#ff375f","#ff9f0a"], ["#30d158","#0a84ff"],
  ["#bf5af2","#ff375f"], ["#ff9f0a","#ff453a"], ["#64d2ff","#0a84ff"],
  ["#ffd60a","#ff9f0a"], ["#32d74b","#64d2ff"],
];

function monogramInitials(name) {
  const w = name.trim().split(/\s+/);
  if (w.length > 1) return (w[0][0] + w[1][0]).toUpperCase();
  return name.trim().slice(0, 2).toUpperCase() || "?";
}

function monogramHash(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h;
}


function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : (pb <= pc ? b : c);
}

/** Decodifica o PNG RGBA não-interlaçado gerado pelo sips. */
function decodeRgbaPng(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  let off = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("latin1", off + 4, off + 8);
    const start = off + 8;
    if (start + len + 4 > buf.length) return null;
    if (type === "IHDR") {
      width = buf.readUInt32BE(start);
      height = buf.readUInt32BE(start + 4);
      bitDepth = buf[start + 8];
      colorType = buf[start + 9];
      interlace = buf[start + 12];
    } else if (type === "IDAT") {
      idat.push(buf.subarray(start, start + len));
    } else if (type === "IEND") {
      break;
    }
    off = start + len + 4;
  }
  const channels = colorType === 6 ? 4 : (colorType === 4 ? 2 : (colorType === 2 ? 3 : 0));
  if (!width || !height || bitDepth !== 8 || !channels || interlace !== 0 || !idat.length) return null;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(idat));
  if (raw.length < height * (stride + 1)) return null;
  const decoded = Buffer.alloc(width * height * channels);
  let src = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[src++];
    const row = y * stride;
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? decoded[row + x - channels] : 0;
      const up = y > 0 ? decoded[row - stride + x] : 0;
      const upLeft = y > 0 && x >= channels ? decoded[row - stride + x - channels] : 0;
      const value = raw[src++];
      if (filter === 0) decoded[row + x] = value;
      else if (filter === 1) decoded[row + x] = (value + left) & 255;
      else if (filter === 2) decoded[row + x] = (value + up) & 255;
      else if (filter === 3) decoded[row + x] = (value + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) decoded[row + x] = (value + paeth(left, up, upLeft)) & 255;
      else return null;
    }
  }
  const pixels = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const from = i * channels, to = i * 4;
    if (channels === 4) decoded.copy(pixels, to, from, from + 4);
    else if (channels === 2) {
      pixels[to] = decoded[from]; pixels[to + 1] = decoded[from]; pixels[to + 2] = decoded[from]; pixels[to + 3] = decoded[from + 1];
    } else {
      pixels[to] = decoded[from]; pixels[to + 1] = decoded[from + 1]; pixels[to + 2] = decoded[from + 2]; pixels[to + 3] = 255;
    }
  }
  return { width, height, pixels };
}

function pngChunk(type, data) {
  const name = Buffer.from(type, "latin1");
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  name.copy(out, 4);
  data.copy(out, 8);
  let crc = 0xffffffff;
  for (let i = 4; i < 8 + data.length; i++) {
    crc ^= out[i];
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 8 + data.length);
  return out;
}

/**
 * Recorta margens transparentes e reencaixa a arte em um canvas fixo.
 * Calendar e Notion, por exemplo, têm bounds visuais diferentes no ICNS.
 */
export function normalizePngIcon(buf, maxPx = ICON_MAX_PX) {
  const decoded = decodeRgbaPng(buf);
  if (!decoded) return buf;
  const { width, height, pixels } = decoded;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4 + 3] <= 8) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX || maxY < minY) return buf;

  const frame = Math.max(1, Math.round(maxPx * 0.94));
  const cropW = maxX - minX + 1, cropH = maxY - minY + 1;
  const scale = Math.min(frame / cropW, frame / cropH);
  const outW = Math.max(1, Math.round(cropW * scale));
  const outH = Math.max(1, Math.round(cropH * scale));
  const canvas = Buffer.alloc(maxPx * maxPx * 4);
  const left = Math.floor((maxPx - outW) / 2), top = Math.floor((maxPx - outH) / 2);
  for (let y = 0; y < outH; y++) {
    const sy = Math.min(cropH - 1, Math.floor(y / scale));
    for (let x = 0; x < outW; x++) {
      const sx = Math.min(cropW - 1, Math.floor(x / scale));
      const from = ((minY + sy) * width + minX + sx) * 4;
      const to = ((top + y) * maxPx + left + x) * 4;
      pixels.copy(canvas, to, from, from + 4);
    }
  }

  const stride = maxPx * 4;
  const scanlines = Buffer.alloc(maxPx * (stride + 1));
  for (let y = 0; y < maxPx; y++) {
    const row = y * (stride + 1);
    canvas.copy(scanlines, row + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(maxPx, 0);
  ihdr.writeUInt32BE(maxPx, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(scanlines, { level: 6 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}


/** True quando o buffer é um SVG (o monograma não precisa de conversor externo). */
export function isSvg(buf) {
  if (!Buffer.isBuffer(buf)) return false;
  const head = buf.subarray(0, 64).toString("utf8").trimStart();
  return head.startsWith("<svg") || head.startsWith("<?xml");
}

/** Monograma em SVG puro: sem sips/ImageMagick, funciona em qualquer SO. */
export function monogramSvg(name, size = 128) {
  const initials = monogramInitials(String(name || ""));
  const [c1, c2] = MONOGRAM_COLORS[monogramHash(String(name || "")) % MONOGRAM_COLORS.length];
  const safe = initials.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 128 128">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${c1}"/>` +
    `<stop offset="100%" stop-color="${c2}"/></linearGradient></defs>` +
    `<rect width="128" height="128" rx="28" fill="url(#g)"/>` +
    `<text x="64" y="72" text-anchor="middle" font-family="Segoe UI,system-ui,sans-serif" font-weight="700" ` +
    `font-size="${initials.length > 1 ? 48 : 56}" fill="#fff" dominant-baseline="central">${safe}</text></svg>`,
    "utf8",
  );
}

/**
 * Serviço de ícones. `readRawIcon(app)` devolve um PNG (Buffer) ou null.
 * O resultado é normalizado, cacheado (memória + disco) e, sem ícone, vira
 * monograma SVG. Misses em memória não reescaneiam o inventário.
 */
export function createIconService({
  listApps,
  readRawIcon,
  cacheDir,
  ttlMs = INSTALLED_APPS_TTL_MS,
  memMax = MEM_PNG_MAX,
  diskMax = DISK_PNG_MAX,
  maxPx = ICON_MAX_PX,
} = {}) {
  if (typeof listApps !== "function" || typeof readRawIcon !== "function") {
    throw new TypeError("createIconService requer listApps e readRawIcon");
  }
  let appsByName = null;
  let appsAt = 0;
  let scanInflight = null;
  const memPng = new Map();
  const loadInflight = new Map();

  async function resolveApps() {
    const now = Date.now();
    if (appsByName && now - appsAt < ttlMs) return appsByName;
    if (scanInflight) return scanInflight;
    scanInflight = Promise.resolve()
      .then(() => listApps())
      .then(apps => {
        appsByName = new Map(apps.map(a => [a.name, a]));
        appsAt = Date.now();
        return appsByName;
      })
      .finally(() => { scanInflight = null; });
    return scanInflight;
  }

  const diskFile = app => join(cacheDir, `${createHash("sha1").update(`${app.name}\0${app.path}`).digest("hex")}-z${maxPx}.png`);

  async function load(name) {
    const app = (await resolveApps()).get(name);
    let buf = null;
    if (app) {
      if (cacheDir) { try { buf = await readFile(diskFile(app)); } catch {} }
      if (!buf) {
        try { buf = await readRawIcon(app); } catch { buf = null; }
        if (buf) buf = normalizePngIcon(buf, maxPx);
        if (buf && pngIsEmpty(buf)) buf = null;
        if (buf && cacheDir) {
          try {
            await mkdir(cacheDir, { recursive: true });
            await writeFile(diskFile(app), buf);
            await pruneIconCache(cacheDir, diskMax);
          } catch {}
        }
      }
    }
    return buf ?? monogramSvg(name);
  }

  return {
    async getIconPng(name) {
      if (typeof name !== "string" || !name) return null;
      if (memPng.has(name)) {
        const hit = memPng.get(name);
        lruSet(memPng, name, hit, memMax);
        return hit;
      }
      if (loadInflight.has(name)) return loadInflight.get(name);
      const p = load(name).then(buf => { lruSet(memPng, name, buf, memMax); return buf; })
        .finally(() => loadInflight.delete(name));
      loadInflight.set(name, p);
      return p;
    },
  };
}
