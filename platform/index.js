// Seleciona o provider da plataforma. Só o Windows tem suporte completo; em
// outros sistemas o servidor sobe com listas vazias (útil para desenvolver e
// rodar os testes em Linux) e as ações respondem 501.
import { join } from "node:path";
import { createIconService } from "../icons.js";
import { PlatformError, createWindowsProvider } from "./windows.js";

function createUnsupportedProvider(platform) {
  const unsupported = async () => { throw new PlatformError("PLATFORM_UNSUPPORTED", `plataforma sem suporte: ${platform}`, 501); };
  return {
    id: "unsupported",
    async getInstalledFull() { return []; },
    async getRawIcon() { return null; },
    appTools: { listAppProcesses: async () => [], listInstalledApps: async () => [] },
    actions: { activateApp: unsupported, openWebsite: unsupported, listShortcuts: async () => [], runShortcut: unsupported },
  };
}

export function createPlatform({ platform = process.platform, dataDir, provider, ...providerOptions } = {}) {
  const chosen = provider ?? (platform === "win32" ? createWindowsProvider(providerOptions) : createUnsupportedProvider(platform));
  const iconService = createIconService({
    listApps: () => chosen.getInstalledFull(),
    readRawIcon: app => chosen.getRawIcon(app),
    cacheDir: dataDir ? join(dataDir, "icon-cache") : undefined,
  });
  return { id: chosen.id, appTools: chosen.appTools, actions: chosen.actions, iconService };
}
