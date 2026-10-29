/* Gerador de QR Code mínimo (modo byte, correção M, versões 1–10), sem dependências.
 * Uso: DokkeQR.matrix("texto") -> array de linhas com 0/1; DokkeQR.svg("texto", {scale, margin}). */
(function (root) {
  "use strict";
  // [ecc/bloco, blocos grupo1, dados grupo1, blocos grupo2, dados grupo2] — nível M, versões 1..10
  var M_TABLE = [null, [10,1,16,0,0],[16,1,28,0,0],[26,1,44,0,0],[18,2,32,0,0],[24,2,43,0,0],[16,4,27,0,0],[18,4,31,0,0],[22,2,38,2,39],[22,3,36,2,37],[26,4,43,1,44]];
  var ALIGN = [null, [], [6,18], [6,22], [6,26], [6,30], [6,34], [6,22,38], [6,24,42], [6,26,46], [6,28,50]];
  var EXP = new Array(512), LOG = new Array(256);
  (function () { var x = 1; for (var i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; } for (i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; })();
  function gmul(a, b) { return a && b ? EXP[LOG[a] + LOG[b]] : 0; }
  function rsGenerator(n) { var g = [1]; for (var i = 0; i < n; i++) { var next = new Array(g.length + 1).fill(0); for (var j = 0; j < g.length; j++) { next[j] ^= g[j]; next[j + 1] ^= gmul(g[j], EXP[i]); } g = next; } return g; }
  function rsRemainder(data, n) { var gen = rsGenerator(n), res = new Array(n).fill(0); for (var i = 0; i < data.length; i++) { var f = data[i] ^ res[0]; res.shift(); res.push(0); if (f) for (var j = 0; j < n; j++) res[j] ^= gmul(gen[j + 1], f); } return res; }
  function utf8(str) { return Array.prototype.slice.call(new TextEncoder().encode(str)); }
  function capacity(v) { var t = M_TABLE[v]; return t[1] * t[2] + t[3] * t[4]; }

  function buildCodewords(bytes, v) {
    var cap = capacity(v), bits = [];
    function put(val, len) { for (var i = len - 1; i >= 0; i--) bits.push((val >> i) & 1); }
    put(4, 4); put(bytes.length, v < 10 ? 8 : 16);
    bytes.forEach(function (b) { put(b, 8); });
    for (var i = 0; i < 4 && bits.length < cap * 8; i++) bits.push(0);
    while (bits.length % 8) bits.push(0);
    var data = []; for (i = 0; i < bits.length; i += 8) { var n = 0; for (var j = 0; j < 8; j++) n = (n << 1) | bits[i + j]; data.push(n); }
    for (var pad = 0xec; data.length < cap; pad ^= 0xec ^ 0x11) data.push(pad);
    var t = M_TABLE[v], blocks = [], pos = 0;
    for (var g = 0; g < t[1] + t[3]; g++) { var len = g < t[1] ? t[2] : t[4]; blocks.push(data.slice(pos, pos + len)); pos += len; }
    var ecc = blocks.map(function (b) { return rsRemainder(b, t[0]); }), out = [], maxLen = Math.max(t[2], t[4]);
    for (i = 0; i < maxLen; i++) blocks.forEach(function (b) { if (i < b.length) out.push(b[i]); });
    for (i = 0; i < t[0]; i++) ecc.forEach(function (e) { out.push(e[i]); });
    return out;
  }

  function makeGrid(v) {
    var n = 17 + 4 * v, m = [], fn = [];
    for (var i = 0; i < n; i++) { m.push(new Array(n).fill(0)); fn.push(new Array(n).fill(false)); }
    function set(r, c, val) { if (r >= 0 && c >= 0 && r < n && c < n) { m[r][c] = val ? 1 : 0; fn[r][c] = true; } }
    function finder(r, c) { for (var dr = -1; dr <= 7; dr++) for (var dc = -1; dc <= 7; dc++) { var on = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6 && (dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4)); set(r + dr, c + dc, on); } }
    finder(0, 0); finder(0, n - 7); finder(n - 7, 0);
    for (i = 8; i < n - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    var al = ALIGN[v];
    al.forEach(function (r) { al.forEach(function (c) {
      if ((r === 6 && c === 6) || (r === 6 && c === al[al.length - 1]) || (c === 6 && r === al[al.length - 1])) return;
      for (var dr = -2; dr <= 2; dr++) for (var dc = -2; dc <= 2; dc++) set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
    }); });
    set(n - 8, 8, 1); // módulo escuro
    for (i = 0; i < 9; i++) { if (!fn[8][i]) set(8, i, 0); if (!fn[i][8]) set(i, 8, 0); }
    for (i = 0; i < 8; i++) { set(8, n - 1 - i, 0); set(n - 1 - i, 8, 0); }
    return { n: n, m: m, fn: fn };
  }

  var MASKS = [
    function (r, c) { return (r + c) % 2 === 0; }, function (r) { return r % 2 === 0; }, function (r, c) { return c % 3 === 0; }, function (r, c) { return (r + c) % 3 === 0; },
    function (r, c) { return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0; }, function (r, c) { return ((r * c) % 2) + ((r * c) % 3) === 0; },
    function (r, c) { return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0; }, function (r, c) { return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0; }
  ];

  function placeData(g, codewords, mask) {
    var bits = []; codewords.forEach(function (b) { for (var i = 7; i >= 0; i--) bits.push((b >> i) & 1); });
    var idx = 0, up = true;
    for (var c = g.n - 1; c > 0; c -= 2) {
      if (c === 6) c--;
      for (var k = 0; k < g.n; k++) {
        var r = up ? g.n - 1 - k : k;
        for (var d = 0; d < 2; d++) { var cc = c - d; if (g.fn[r][cc]) continue; var bit = idx < bits.length ? bits[idx++] : 0; g.m[r][cc] = bit ^ (MASKS[mask](r, cc) ? 1 : 0); }
      }
      up = !up;
    }
  }

  function formatBits(mask) { var data = (0 << 3) | mask; /* M = 00 */ var rem = data; for (var i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537); return ((data << 10) | rem) ^ 0x5412; }
  function versionBits(v) { var rem = v; for (var i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25); return (v << 12) | rem; }
  function drawFormat(g, mask) {
    var bits = formatBits(mask), n = g.n;
    for (var i = 0; i < 15; i++) {
      var bit = (bits >> i) & 1;
      if (i < 6) g.m[i][8] = bit; else if (i < 8) g.m[i + 1][8] = bit; else g.m[n - 15 + i][8] = bit;
      if (i < 8) g.m[8][n - 1 - i] = bit; else if (i < 9) g.m[8][15 - i] = bit; else g.m[8][14 - i] = bit;
    }
    g.m[n - 8][8] = 1;
  }
  function drawVersion(g, v) {
    if (v < 7) return;
    var bits = versionBits(v), n = g.n;
    for (var i = 0; i < 18; i++) { var bit = (bits >> i) & 1, a = Math.floor(i / 3), b = i % 3 + n - 11; g.m[a][b] = bit; g.m[b][a] = bit; g.fn[a][b] = g.fn[b][a] = true; }
  }

  function penalty(m) {
    var n = m.length, p = 0, r, c, run, k;
    for (r = 0; r < n; r++) { run = 1; for (c = 1; c < n; c++) { if (m[r][c] === m[r][c - 1]) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1; } }
    for (c = 0; c < n; c++) { run = 1; for (r = 1; r < n; r++) { if (m[r][c] === m[r - 1][c]) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1; } }
    for (r = 0; r < n - 1; r++) for (c = 0; c < n - 1; c++) { var s = m[r][c] + m[r][c + 1] + m[r + 1][c] + m[r + 1][c + 1]; if (s === 0 || s === 4) p += 3; }
    var pat = [1,0,1,1,1,0,1,0,0,0,0], pat2 = pat.slice().reverse();
    function match(arr, at, pt) { for (var i = 0; i < 11; i++) if (arr[at + i] !== pt[i]) return false; return true; }
    for (r = 0; r < n; r++) for (c = 0; c <= n - 11; c++) { if (match(m[r], c, pat)) p += 40; if (match(m[r], c, pat2)) p += 40; }
    for (c = 0; c < n; c++) { var col = []; for (r = 0; r < n; r++) col.push(m[r][c]); for (r = 0; r <= n - 11; r++) { if (match(col, r, pat)) p += 40; if (match(col, r, pat2)) p += 40; } }
    var dark = 0; for (r = 0; r < n; r++) for (c = 0; c < n; c++) dark += m[r][c];
    k = Math.floor(Math.abs(dark * 20 - n * n * 10) / (n * n)); p += k * 10;
    return p;
  }

  function matrix(text) {
    var bytes = utf8(String(text)), v = 1;
    while (v <= 10 && bytes.length + (v < 10 ? 2 : 3) > capacity(v)) v++;
    if (v > 10) throw new Error("texto longo demais para o QR");
    var codewords = buildCodewords(bytes, v), best = null, bestScore = Infinity;
    for (var mask = 0; mask < 8; mask++) {
      var g = makeGrid(v); drawVersion(g, v); placeData(g, codewords, mask); drawFormat(g, mask);
      var score = penalty(g.m); if (score < bestScore) { bestScore = score; best = g; }
    }
    return best.m;
  }

  function svg(text, opts) {
    opts = opts || {}; var m = matrix(text), margin = opts.margin == null ? 4 : opts.margin, n = m.length, size = n + margin * 2, d = "";
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (m[r][c]) d += "M" + (c + margin) + " " + (r + margin) + "h1v1h-1z";
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + size + " " + size + '" shape-rendering="crispEdges" role="img" aria-label="QR Code">' +
      '<rect width="100%" height="100%" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
  }

  var api = { matrix: matrix, svg: svg };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.DokkeQR = api;
})(typeof self !== "undefined" ? self : this);
