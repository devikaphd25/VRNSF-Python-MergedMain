/**
 * The ocean puzzle surrounds the player with a translucent water volume. A
 * transparent mesh the player stands *inside* must never write depth: its inner
 * faces sit in front of the whole scene and depth-reject everything drawn after
 * it — the puzzle and the celebration bubbles included — which a headset renders
 * as a black screen. This guards the fix in src/ocean/proceduralOcean.ts.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Box3, Mesh, Vector3 } from "three";
import { buildProceduralOcean } from "../src/ocean/proceduralOcean.ts";

// OceanEnvironmentManager builds the scene for this room size and puts the
// player rig at (0, 0, -1) with the eye about 1.6 m above it.
const FOOTPRINT = 16;
const CLEARING = 3.5;
const EYE = new Vector3(0, 1.6, -1);

test("No ocean mesh that encloses the player writes depth", () => {
  const scene = buildProceduralOcean(FOOTPRINT, CLEARING);
  scene.updateMatrixWorld(true);

  const enclosing: string[] = [];
  scene.traverse(object => {
    if (!(object instanceof Mesh)) return;
    if (!new Box3().setFromObject(object).containsPoint(EYE)) return;

    enclosing.push(object.geometry.type);
    assert.equal(
      (object.material as any).depthWrite !== true,
      true,
      `${object.geometry.type} encloses the player and writes depth`,
    );
  });

  // An empty list would let the assertions above pass by finding nothing.
  assert.ok(enclosing.length > 0, "no scene mesh encloses the player; the water volume is missing");
});
