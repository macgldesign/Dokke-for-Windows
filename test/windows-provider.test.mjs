import test from "node:test";
import assert from "node:assert/strict";
import { createWindowsProvider, parseInstalled, parseRunning, matchRunning, packagedAumid, idFromTarget, PlatformError } from "../platform/windows.js";

const INVENTORY = JSON.stringify([
  { name: "Chrome", target: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", args: "", icon: "", source: "startmenu" },
  { name: "Notepad++", target: "C:\\Program Files\\Notepad++\\notepad++.exe", args: "", icon: "", source: "startmenu" },
  { name: "Uninstall Notepad++", target: "C:\\Program Files\\Notepad++\\uninstall.exe", args: "", icon: "", source: "startmenu" },
  { name: "Calculadora", target: "shell:AppsFolder\\Microsoft.WindowsCalculator_8wekyb3d8bbwe!App", args: "", icon: "", source: "packaged" },
  { name: "Docs", target: "C:\\Tools\\readme.txt", args: "", icon: "", source: "startmenu" },
  { name: "Chrome", target: "C:\\Other\\chrome-beta.exe", args: "", icon: "", source: "startmenu" },
]);

function fakeExec({ running = [], focus = { result: "focused" }, inventory = INVENTORY } = {}) {
  const calls = [];
  const exec = async (file, args) => {
    calls.push([file, args]);
    if (file === "powershell.exe") return { stdout: inventory };
    if (args[0] === "running") return { stdout: JSON.stringify(running) };
    if (args[0] === "focus") return { stdout: JSON.stringify(focus) };
    return { stdout: "" };
  };
  return { exec, calls };
}

test("parseInstalled filtra desinstaladores e não-executáveis, e desambigua nomes repetidos", () => {
  const apps = parseInstalled(INVENTORY);
  assert.deepEqual(apps.map(a => a.name), ["Calculadora", "Chrome", "Chrome (chrome-beta)", "Notepad++"]);
  assert.equal(apps.find(a => a.name === "Calculadora").aumid, "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App");
});

test("parseInstalled aceita um único objeto (ConvertTo-Json) e lixo", () => {
  assert.equal(parseInstalled(JSON.stringify({ name: "A", target: "C:\\a.exe", source: "startmenu" })).length, 1);
  assert.deepEqual(parseInstalled("não é json"), []);
  assert.deepEqual(parseInstalled(""), []);
});

test("packagedAumid e idFromTarget validam e normalizam", () => {
  assert.equal(packagedAumid("shell:AppsFolder\\A.B_x1!App"), "A.B_x1!App");
  assert.equal(packagedAumid("shell:AppsFolder\\foo; calc"), null);
  assert.equal(packagedAumid("C:\\a.exe"), null);
  assert.equal(idFromTarget("C:\\A\\B.exe"), "c:/a/b.exe");
  assert.notEqual(idFromTarget("C:\\a.exe", "--profile=1"), idFromTarget("C:\\a.exe", "--profile=2"));
});

test("matchRunning associa por caminho e AUMID e usa a janela mais à frente", () => {
  const installed = parseInstalled(INVENTORY);
  const windows = parseRunning(JSON.stringify([
    { pid: 10, hwnd: 111, path: "c:\\program files\\google\\chrome\\application\\chrome.exe" },
    { pid: 10, hwnd: 222, path: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" },
    { pid: 20, hwnd: 333, path: "C:\\Windows\\ApplicationFrameHost.exe", aumid: "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App" },
    { pid: 30, hwnd: 444, path: "C:\\desconhecido.exe" },
    { pid: -1, hwnd: 1, path: "x" },
  ]));
  assert.deepEqual(matchRunning(windows, installed), [
    { name: "Chrome", pid: 10, hwnd: 111, type: "Foreground" },
    { name: "Calculadora", pid: 20, hwnd: 333, type: "Foreground" },
  ]);
});

test("activateApp foca a janela pelo HWND quando o app já está aberto", async () => {
  const { exec, calls } = fakeExec({ running: [{ pid: 10, hwnd: 777, path: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" }] });
  const p = createWindowsProvider({ exec, helperPath: "H.exe" });
  const r = await p.actions.activateApp({ name: "Chrome" });
  assert.deepEqual(r, { focused: true, launched: false });
  assert.deepEqual(calls.at(-1), ["H.exe", ["focus", "777"]]);
});

test("activateApp trata o caso 'piscou' como sucesso sem foco (sem erro para o celular)", async () => {
  const { exec } = fakeExec({ running: [{ pid: 10, hwnd: 7, path: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" }], focus: { result: "flashed" } });
  const p = createWindowsProvider({ exec, helperPath: "H.exe" });
  assert.deepEqual(await p.actions.activateApp({ name: "Chrome" }), { focused: false, launched: false });
});

test("activateApp reabre o app se a janela sumiu (not-found)", async () => {
  const { exec, calls } = fakeExec({ running: [{ pid: 10, hwnd: 7, path: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" }], focus: { result: "not-found" } });
  const p = createWindowsProvider({ exec, helperPath: "H.exe" });
  assert.deepEqual(await p.actions.activateApp({ name: "Chrome" }), { focused: false, launched: true });
  assert.deepEqual(calls.at(-1), ["H.exe", ["launch", "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"]]);
});

test("activateApp abre app fechado e usa launch-packaged para apps da Store", async () => {
  const { exec, calls } = fakeExec();
  const p = createWindowsProvider({ exec, helperPath: "H.exe" });
  await p.actions.activateApp({ name: "Calculadora" });
  assert.deepEqual(calls.at(-1), ["H.exe", ["launch-packaged", "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App"]]);
});

test("activateApp falha com FOCUS_FAILED quando o helper reporta erro", async () => {
  const { exec } = fakeExec({ running: [{ pid: 10, hwnd: 7, path: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" }], focus: { result: "error", detail: "boom" } });
  const p = createWindowsProvider({ exec, helperPath: "H.exe" });
  await assert.rejects(p.actions.activateApp({ name: "Chrome" }), e => e instanceof PlatformError && e.code === "FOCUS_FAILED");
});

test("activateApp só aceita nomes do inventário: nada vindo da rede vira comando", async () => {
  const { exec, calls } = fakeExec();
  const p = createWindowsProvider({ exec, helperPath: "H.exe" });
  for (const name of ["calc.exe", "Chrome; calc", "..\\..\\cmd.exe", "", undefined]) {
    await assert.rejects(p.actions.activateApp({ name }), e => e.code === "APP_NOT_FOUND" && e.status === 404);
  }
  assert.ok(calls.every(c => c[0] === "powershell.exe" || c[1][0] === "running"), "nenhum launch/focus foi executado");
});

test("listAppProcesses usa cache curto e não quebra se o helper falhar", async () => {
  let t = 0;
  const { exec, calls } = fakeExec({ running: [{ pid: 1, hwnd: 2, path: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" }] });
  const p = createWindowsProvider({ exec, helperPath: "H.exe", now: () => t });
  await p.appTools.listAppProcesses();
  await p.appTools.listAppProcesses();
  assert.equal(calls.filter(c => c[1][0] === "running").length, 1);
  t = 2000;
  await p.appTools.listAppProcesses();
  assert.equal(calls.filter(c => c[1][0] === "running").length, 2);
  const broken = createWindowsProvider({ exec: async () => { throw new Error("sem helper"); }, helperPath: "H.exe" });
  assert.deepEqual(await broken.appTools.listAppProcesses(), []);
});

test("listInstalledApps não vaza caminhos nem argumentos", async () => {
  const { exec } = fakeExec();
  const p = createWindowsProvider({ exec, helperPath: "H.exe" });
  const apps = await p.appTools.listInstalledApps();
  assert.ok(apps.length > 0);
  for (const a of apps) assert.deepEqual(Object.keys(a).sort(), ["icon", "id", "name", "source"]);
});

test("openWebsite só abre http(s), por argv", async () => {
  const { exec, calls } = fakeExec();
  const p = createWindowsProvider({ exec, helperPath: "H.exe" });
  await p.actions.openWebsite("https://exemplo.com/a b");
  assert.deepEqual(calls.at(-1), ["rundll32.exe", ["url.dll,FileProtocolHandler", "https://exemplo.com/a%20b"]]);
  await assert.rejects(p.actions.openWebsite("file:///C:/Windows/System32/calc.exe"), e => e.code === "INVALID_URL");
  await assert.rejects(p.actions.openWebsite("javascript:alert(1)"), e => e.code === "INVALID_URL");
});

test("getRawIcon só devolve PNG válido", async () => {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0]);
  const mk = stdout => createWindowsProvider({ exec: async (f) => ({ stdout: f === "powershell.exe" ? INVENTORY : stdout }), helperPath: "H.exe" });
  const app = { target: "C:\\a.exe", iconLocation: "" };
  assert.ok((await mk(JSON.stringify({ png: png.toString("base64") })).getRawIcon(app)).equals(png));
  assert.equal(await mk(JSON.stringify({ png: Buffer.from("GIF89a").toString("base64") })).getRawIcon(app), null);
  assert.equal(await mk("").getRawIcon(app), null);
});
