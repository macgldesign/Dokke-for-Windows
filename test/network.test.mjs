import test from "node:test";
import assert from "node:assert/strict";
import { isAllowedRemoteAddress, isVirtualInterfaceName, listLanUrls } from "../network.js";

test("isAllowedRemoteAddress aceita rede local e loopback, recusa endereços públicos", () => {
  for (const ok of ["127.0.0.1", "::1", "::ffff:192.168.0.20", "192.168.1.5", "10.1.2.3", "172.16.0.9", "172.31.255.1", "169.254.1.1",
    "100.64.0.1", "fe80::1%eth0", "fd12:3456::1", "fc00::1", undefined]) assert.equal(isAllowedRemoteAddress(ok), true, String(ok));
  for (const bad of ["8.8.8.8", "172.32.0.1", "100.128.0.1", "2001:db8::1", "2804:14d::1", "::ffff:8.8.8.8", "999.1.1.1", "abc"]) assert.equal(isAllowedRemoteAddress(bad), false, bad);
});

test("isVirtualInterfaceName reconhece adaptadores virtuais comuns do Windows", () => {
  for (const n of ["vEthernet (WSL)", "VirtualBox Host-Only Network", "VMware Network Adapter VMnet8", "Tailscale", "Loopback Pseudo-Interface 1"]) assert.equal(isVirtualInterfaceName(n), true, n);
  for (const n of ["Ethernet", "Wi-Fi", "Ethernet 2", "Wi-Fi 3"]) assert.equal(isVirtualInterfaceName(n), false, n);
});

test("listLanUrls prefere Wi-Fi/Ethernet física e esconde APIPA e loopback", () => {
  const nic = (address, internal = false) => [{ family: "IPv4", address, internal }];
  const urls = listLanUrls(3000, {
    "vEthernet (WSL)": nic("172.28.0.1"),
    "Wi-Fi": nic("192.168.0.15"),
    Ethernet: nic("10.0.0.7"),
    "Ethernet 2": nic("169.254.3.4"),
    Loopback: nic("127.0.0.1", true),
  });
  assert.deepEqual(urls.map(u => u.url), ["http://192.168.0.15:3000", "http://10.0.0.7:3000", "http://172.28.0.1:3000"]);
  assert.equal(urls[2].virtual, true);
});
