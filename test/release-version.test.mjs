import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [packageJson, packageLock, publicVersion, androidGradle, changelog] = await Promise.all([
  readFile(new URL("../package.json", import.meta.url), "utf8"),
  readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
  readFile(new URL("../public/version.json", import.meta.url), "utf8"),
  readFile(new URL("../android/app/build.gradle", import.meta.url), "utf8"),
  readFile(new URL("../CHANGELOG.md", import.meta.url), "utf8"),
]);

test("todos os metadados apontam para o candidato v0.2.10", () => {
  assert.equal(JSON.parse(packageJson).version, "0.2.10");
  assert.equal(JSON.parse(packageLock).version, "0.2.10");
  assert.equal(JSON.parse(packageLock).packages[""].version, "0.2.10");
  assert.deepEqual(JSON.parse(publicVersion), { tag: "v0.2.10", apkVersion: "0.2.10" });
  assert.match(androidGradle, /versionCode = 13/);
  assert.match(androidGradle, /versionName = "0\.2\.10"/);
  assert.match(changelog, /^## v0\.2\.10 — 6 de outubro de 2026/m);
});
