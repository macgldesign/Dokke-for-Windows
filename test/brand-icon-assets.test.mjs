import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = path.join(root, "assets", "branding", "dokke-icon");

const sourceVariants = [
  "Icon-dokke-iOS-ClearDark-1024@1x.png",
  "Icon-dokke-iOS-ClearLight-1024@1x.png",
  "Icon-dokke-iOS-Dark-1024@1x.png",
  "Icon-dokke-iOS-Default-1024@1x.png",
  "Icon-dokke-iOS-TintedDark-1024@1x.png",
  "Icon-dokke-iOS-TintedLight-1024@1x.png",
];

const expectedAndroidIconHashes = new Map([
  ["android/app/src/main/res/mipmap-mdpi/ic_launcher.png", "aa414f5cd0c4ead55a1c687a91094b844d80eaa09c353fd2514f707d9d0e7bd0"],
  ["android/app/src/main/res/mipmap-hdpi/ic_launcher.png", "d614406caa60b9bef4290ba917f896919518ed6838dde0d056bdc02004d6c2f5"],
  ["android/app/src/main/res/mipmap-xhdpi/ic_launcher.png", "70d3491dcfe5d6f414d8587dd9d76b209b0e5f35ebd5bcb58cb807b759b63efb"],
  ["android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png", "ec8880573ecb1cac0b598ce9a997fc4090ce3535471afd03630586d084701536"],
  ["android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png", "80e2dd3a2a2f856cc13db6ccceb0b54547823f7fb47c683c216575d1bd56fbb0"],
]);

function pngDimensions(filePath) {
  const png = readFileSync(filePath);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
  };
}

test("exports de aparência do Dokke ficam versionados no projeto", () => {
  for (const name of sourceVariants) {
    assert.deepEqual(pngDimensions(path.join(sourceDir, name)), { width: 1024, height: 1024 });
  }
});

test("o ícone Default sincroniza Mac, PWA, docs e Android", () => {
  const outputs = new Map([
    ["public/icon-dock-iOS-Default-1024@1x.png", 1024],
    ["public/icon-192.png", 192],
    ["public/icon-512.png", 512],
    ["docs/public/dokke-icon.png", 512],
    ["android/app/src/main/res/mipmap-mdpi/ic_launcher.png", 48],
    ["android/app/src/main/res/mipmap-hdpi/ic_launcher.png", 72],
    ["android/app/src/main/res/mipmap-xhdpi/ic_launcher.png", 96],
    ["android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png", 144],
    ["android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png", 192],
  ]);

  for (const [relativePath, size] of outputs) {
    assert.ok(existsSync(path.join(root, relativePath)), `${relativePath} ausente`);
    assert.deepEqual(pngDimensions(path.join(root, relativePath)), { width: size, height: size });
  }

  assert.deepEqual(
    createHash("sha256").update(readFileSync(path.join(root, "docs/public/dokke-icon.png"))).digest("hex"),
    createHash("sha256").update(readFileSync(path.join(root, "public/icon-512.png"))).digest("hex"),
    "o ícone exibido no README deve usar o artwork Default atual",
  );
});

test("os icones Android usam o mesmo artwork Default novo do Dokke", () => {
  for (const [relativePath, expectedHash] of expectedAndroidIconHashes) {
    const actualHash = createHash("sha256")
      .update(readFileSync(path.join(root, relativePath)))
      .digest("hex");
    assert.equal(actualHash, expectedHash, `${relativePath} ainda usa artwork antigo`);
  }
});


