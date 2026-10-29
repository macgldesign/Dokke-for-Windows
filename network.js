// Utilitários de rede: quem pode falar com o servidor e quais URLs mostrar ao
// usuário para parear o celular.
import { networkInterfaces } from "node:os";

function stripMapped(address) {
  const text = String(address ?? "");
  return text.toLowerCase().startsWith("::ffff:") ? text.slice(7) : text;
}

function parseIpv4(address) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every(p => p <= 255) ? parts : null;
}

/** IPv4 privado/local: RFC1918, loopback, link-local e 100.64/10 (CGNAT/Tailscale). */
export function isPrivateIpv4(parts) {
  const [a, b] = parts;
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
    || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
}

/**
 * Origem aceitável: rede local ou loopback. Bloqueia endereços públicos (por
 * exemplo IPv6 global, caso o roteador deixe conexões de entrada passarem).
 * Acesso por túnel (cloudflared) chega por loopback e continua permitido.
 */
export function isAllowedRemoteAddress(address) {
  if (address === undefined || address === null) return true; // sockets sintéticos de teste
  const text = stripMapped(address).split("%")[0].toLowerCase();
  const v4 = parseIpv4(text);
  if (v4) return isPrivateIpv4(v4);
  if (text === "::1") return true;
  return /^f[cd][0-9a-f]{2}:/.test(text) || /^fe[89ab][0-9a-f]:/.test(text); // ULA fc00::/7 e link-local fe80::/10
}

const VIRTUAL = /(vethernet|virtual|vmware|vbox|hyper-?v|loopback|tailscale|zerotier|wsl|docker|bluetooth|tap-|tun\d|utun|awdl|llw)/i;

/** Nome de interface que parece virtual (VM, VPN, WSL…) e não deve ser o IP principal. */
export function isVirtualInterfaceName(name) {
  return VIRTUAL.test(String(name ?? ""));
}

/** URLs candidatas para o celular, da mais provável para a menos provável. */
export function listLanUrls(port, interfaces = networkInterfaces()) {
  const rows = [];
  for (const [name, infos] of Object.entries(interfaces ?? {})) {
    for (const info of infos ?? []) {
      if ((info.family !== "IPv4" && info.family !== 4) || info.internal) continue;
      const parts = parseIpv4(info.address);
      if (!parts || parts[0] === 169) continue; // APIPA: sem DHCP, inútil para parear
      const virtual = isVirtualInterfaceName(name);
      const rank = (virtual ? 100 : 0) + (parts[0] === 192 ? 0 : parts[0] === 10 ? 1 : parts[0] === 172 ? 2 : 3);
      rows.push({ name, address: info.address, url: `http://${info.address}:${port}`, virtual, rank });
    }
  }
  return rows.sort((a, b) => a.rank - b.rank || a.address.localeCompare(b.address))
    .map(({ rank, ...row }) => row);
}
