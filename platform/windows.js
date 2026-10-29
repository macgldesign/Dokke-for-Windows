// Provider Windows do Dokke.
//
// Parte da lógica de inventário (script PowerShell e parse de atalhos/apps da
// Store) foi adaptada do WinDock (MIT, © Ali Saad) — veja NOTICE.
// Tudo que roda comandos usa argv (execFile): nenhum texto vindo da rede é
// interpolado em linha de comando, e apps só são ativados se existirem no
// inventário descoberto.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

export const POWERSHELL = "powershell.exe";
export const PS_FLAGS = Object.freeze(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command"]);

/** PowerShell constante: atalhos do Menu Iniciar + apps empacotados (Store). */
export const INVENTORY_PS = [
  "$ErrorActionPreference='SilentlyContinue';",
  "[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false);",
  "$out=@();",
  "$roots=@([Environment]::GetFolderPath('CommonStartMenu'),[Environment]::GetFolderPath('StartMenu'));",
  "$sh=New-Object -ComObject WScript.Shell;",
  "foreach($r in $roots){",
  "  if(-not $r){continue};",
  "  Get-ChildItem -LiteralPath $r -Recurse -Filter *.lnk | ForEach-Object {",
  "    $lk=$sh.CreateShortcut($_.FullName);",
  "    if($lk.TargetPath -and $lk.TargetPath.ToLower().EndsWith('.exe')){",
  "      $out+=[pscustomobject]@{name=$_.BaseName; target=$lk.TargetPath; args=$lk.Arguments; icon=$lk.IconLocation; source='startmenu'}",
  "    }",
  "  }",
  "};",
  "$catalog=(New-Object -ComObject Shell.Application).NameSpace('shell:AppsFolder');",
  "if($catalog){foreach($item in $catalog.Items()) {",
  "  $aumid=$item.ExtendedProperty('System.AppUserModel.ID');",
  "  if($aumid -and $aumid.Contains('!')){",
  "    $out+=[pscustomobject]@{name=$item.Name; target=('shell:AppsFolder\\'+$aumid); args=''; icon=''; source='packaged'}",
  "  }",
  "}};",
  "$out | ConvertTo-Json -Compress -Depth 3",
].join(" ");

const PACKAGED_PREFIX = "shell:AppsFolder\\";
const PNG_MAGIC = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const UNINSTALL_NAME = /\b(uninstall|desinstalar|remover)\b/i;
const UNINSTALL_EXE = /^unins\d*\.exe$/i;

export class PlatformError extends Error {
  constructor(code, message, status = 500) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** Identificador estável: caminho do alvo em minúsculas (+ hash dos argumentos). */
export function idFromTarget(target, args = "") {
  const id = String(target || "").trim().toLowerCase().replace(/\\/g, "/");
  const extra = String(args || "").trim();
  if (!extra) return id;
  let h = 0;
  for (const ch of extra) h = (Math.imul(h, 31) + ch.codePointAt(0)) >>> 0;
  return `${id}#${h.toString(16)}`;
}

/** AUMID válido de app empacotado ("Pacote_hash!App") ou null. */
export function packagedAumid(target) {
  if (typeof target !== "string" || !target.toLowerCase().startsWith(PACKAGED_PREFIX.toLowerCase())) return null;
  const aumid = target.slice(PACKAGED_PREFIX.length);
  return aumid.length <= 128 && /^[a-z0-9][a-z0-9.-]*_[a-z0-9]+![a-z0-9][a-z0-9._-]*$/i.test(aumid) ? aumid : null;
}

function jsonArray(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (parsed === null || parsed === undefined) return [];
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

/**
 * Converte a saída do inventário em apps únicos por nome (o Dokke fixa apps por
 * nome). Menu Iniciar vence apps empacotados; nomes repetidos com alvos
 * diferentes ganham o nome do executável entre parênteses.
 */
export function parseInstalled(raw) {
  const rows = [];
  const seenIds = new Set();
  for (const row of jsonArray(raw)) {
    const name = typeof row?.name === "string" ? row.name.trim() : "";
    const target = typeof row?.target === "string" ? row.target.trim() : "";
    if (!name || !target || name.length > 120) continue;
    const aumid = packagedAumid(target);
    if (!aumid && (/^shell:/i.test(target) || !/\.exe$/i.test(target))) continue;
    if (UNINSTALL_NAME.test(name) || UNINSTALL_EXE.test(basename(target.replace(/\\/g, "/")))) continue;
    const args = aumid ? "" : typeof row?.args === "string" ? row.args.trim() : "";
    const id = aumid ? idFromTarget(target) : idFromTarget(target, args);
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    rows.push({
      id, name, target, args, aumid,
      iconLocation: typeof row?.icon === "string" ? row.icon.trim() : "",
      source: aumid ? "packaged" : "startmenu",
    });
  }
  rows.sort((a, b) => (a.source === b.source ? 0 : a.source === "startmenu" ? -1 : 1)
    || a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  const used = new Set();
  const apps = [];
  for (const app of rows) {
    let name = app.name;
    if (used.has(name.toLowerCase())) {
      const exe = app.aumid ? app.aumid.split("_")[0] : basename(app.target.replace(/\\/g, "/")).replace(/\.exe$/i, "");
      name = `${app.name} (${exe})`;
      if (used.has(name.toLowerCase())) continue;
    }
    used.add(name.toLowerCase());
    apps.push({ ...app, name });
  }
  return apps.sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}

/** Saída do helper `running`: janelas de topo visíveis, da frente para trás. */
export function parseRunning(raw) {
  const out = [];
  for (const row of jsonArray(raw)) {
    const pid = Number(row?.pid);
    const hwnd = Number(row?.hwnd);
    if (!Number.isInteger(pid) || pid <= 0 || !Number.isSafeInteger(hwnd) || hwnd === 0) continue;
    out.push({
      pid, hwnd,
      path: typeof row?.path === "string" ? row.path.trim() : "",
      aumid: typeof row?.aumid === "string" ? row.aumid.trim() : "",
      title: typeof row?.title === "string" ? row.title : "",
    });
  }
  return out;
}

/** Associa janelas a apps do inventário (por AUMID ou caminho do executável). */
export function matchRunning(windows, installed) {
  const byAumid = new Map();
  const byPath = new Map();
  for (const app of installed) {
    if (app.aumid) { if (!byAumid.has(app.aumid.toLowerCase())) byAumid.set(app.aumid.toLowerCase(), app); continue; }
    const key = app.target.toLowerCase();
    const current = byPath.get(key);
    if (!current || (current.args && !app.args)) byPath.set(key, app); // prefere o atalho sem argumentos
  }
  const out = [];
  const seen = new Set();
  for (const w of windows) {
    const app = (w.aumid && byAumid.get(w.aumid.toLowerCase())) || (w.path && byPath.get(w.path.toLowerCase()));
    if (!app || seen.has(app.name)) continue; // a primeira janela (mais à frente) de cada app
    seen.add(app.name);
    out.push({ name: app.name, pid: w.pid, hwnd: w.hwnd, type: "Foreground" });
  }
  return out;
}

export function defaultExec(file, args, { timeout = 20_000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, timeout, maxBuffer: 8 * 1024 * 1024, encoding: "utf8" },
      (error, stdout, stderr) => {
        if (error) { error.stderr = stderr; reject(error); } else resolve({ stdout: stdout ?? "", stderr: stderr ?? "" });
      });
  });
}

export function resolveHelperPath(env = process.env) {
  const here = fileURLToPath(new URL(".", import.meta.url));
  const candidates = [
    env.DOKKE_HELPER,
    join(here, "..", "Dokke.exe"),
    join(here, "..", "..", "Dokke.exe"),
  ].filter(Boolean);
  return candidates.find(p => existsSync(p)) ?? candidates[0] ?? join(here, "..", "Dokke.exe");
}

export function createWindowsProvider({
  exec = defaultExec,
  helperPath = resolveHelperPath(),
  inventoryTtlMs = 120_000,
  runningTtlMs = 1_500,
  now = Date.now,
} = {}) {
  const helper = (args, opts) => exec(helperPath, args, opts);
  let inventory = null;
  let inventoryAt = 0;
  let inventoryInflight = null;
  let running = null;
  let runningAt = 0;
  let runningInflight = null;

  async function getInstalledFull({ refresh = false } = {}) {
    if (!refresh && inventory && now() - inventoryAt < inventoryTtlMs) return inventory;
    if (inventoryInflight) return inventoryInflight;
    inventoryInflight = exec(POWERSHELL, [...PS_FLAGS, INVENTORY_PS], { timeout: 60_000 })
      .then(({ stdout }) => { inventory = parseInstalled(stdout); inventoryAt = now(); return inventory; })
      .finally(() => { inventoryInflight = null; });
    return inventoryInflight;
  }

  async function listWindows() {
    const { stdout } = await helper(["running"]);
    return parseRunning(stdout);
  }

  async function listAppProcesses({ fresh = false } = {}) {
    if (!fresh && running && now() - runningAt < runningTtlMs) return running;
    if (runningInflight && !fresh) return runningInflight;
    const p = (async () => {
      try {
        const [windows, installed] = await Promise.all([listWindows(), getInstalledFull()]);
        return matchRunning(windows, installed);
      } catch {
        return [];
      }
    })().then(value => { running = value; runningAt = now(); return value; })
      .finally(() => { if (runningInflight === p) runningInflight = null; });
    runningInflight = p;
    return p;
  }

  async function launch(app) {
    if (app.aumid) await helper(["launch-packaged", app.aumid]);
    else await helper(app.args ? ["launch", app.target, app.args] : ["launch", app.target]);
  }

  async function activateApp({ name } = {}) {
    const installed = await getInstalledFull();
    const app = installed.find(a => a.name === name);
    if (!app) throw new PlatformError("APP_NOT_FOUND", "app não encontrado", 404);
    const current = (await listAppProcesses({ fresh: true })).find(r => r.name === app.name);
    if (!current) { await launch(app); return { focused: false, launched: true }; }
    const { stdout } = await helper(["focus", String(current.hwnd)]);
    const [result] = jsonArray(stdout);
    switch (result?.result) {
      case "focused": return { focused: true, launched: false };
      case "flashed": return { focused: false, launched: false };
      case "not-found": await launch(app); return { focused: false, launched: true };
      default: throw new PlatformError("FOCUS_FAILED", result?.detail || "não foi possível trazer o app para frente", 502);
    }
  }

  async function openWebsite(url) {
    let parsed;
    try { parsed = new URL(url); } catch { throw new PlatformError("INVALID_URL", "URL inválida", 400); }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new PlatformError("INVALID_URL", "URL inválida", 400);
    await exec("rundll32.exe", ["url.dll,FileProtocolHandler", parsed.href]);
  }

  async function getRawIcon(app) {
    const { stdout } = await helper(app.aumid ? ["icon-packaged", app.aumid] : ["icon", app.target, app.iconLocation || ""]);
    const [row] = jsonArray(stdout);
    if (typeof row?.png !== "string" || row.png.length > 1024 * 1024) return null;
    const bytes = Buffer.from(row.png, "base64");
    return bytes.subarray(0, 8).equals(PNG_MAGIC) ? bytes : null;
  }

  return {
    id: "windows",
    getInstalledFull,
    getRawIcon,
    appTools: {
      listAppProcesses,
      async listInstalledApps(opts) {
        return (await getInstalledFull(opts)).map(a => ({ name: a.name, id: a.id, source: a.source, icon: true }));
      },
    },
    actions: {
      activateApp,
      openWebsite,
      async listShortcuts() { return []; },
      async runShortcut() { throw new PlatformError("SHORTCUTS_UNSUPPORTED", "atalhos do Apple Shortcuts não existem no Windows", 501); },
    },
  };
}
