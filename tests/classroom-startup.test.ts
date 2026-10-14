import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mock, test } from "node:test";

// Loading policy/integrity regressions, not headset or controller emulation.
mock.module("@iwsdk/core", {
  namedExports: { AssetType: { GLTF: "gltf", HDRTexture: "hdr-texture" } },
});
const { classroomAssets } = await import("../src/config/classroom-assets.ts");

test("Required classroom models finish before login or saved-session restoration", () => {
  for (const key of ["classroom2", "nasaSeatSource"]) {
    assert.equal(classroomAssets[key].type, "gltf");
    assert.equal(classroomAssets[key].priority, "critical",
      `${key} is used immediately after login and cannot load in the background`);
  }
});

test("Every startup model is present as a complete GLB, including the NASA source", async () => {
  for (const [key, asset] of Object.entries(classroomAssets)) {
    if (asset.type !== "gltf") continue;
    const file = await readFile(new URL(`../public/${asset.url}`, import.meta.url));
    assert.equal(file.toString("ascii", 0, 4), "glTF", `${key}: GLB signature`);
    assert.equal(file.readUInt32LE(4), 2, `${key}: GLB version`);
    assert.equal(file.readUInt32LE(8), file.length, `${key}: complete download`);
  }
});
