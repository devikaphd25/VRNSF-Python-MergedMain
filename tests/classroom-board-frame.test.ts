import { test } from "node:test";
import assert from "node:assert/strict";
import { Raycaster, Vector3 } from "three";
import { createClassroomBoardFrame } from "../src/classroom/classroom-board-frame.ts";

for (const [width, height] of [[3.8, 4.2], [10, 5]]) {
  test(`frame leaves the entire ${width} x ${height} display clear`, () => {
    const frame = createClassroomBoardFrame(width, height);
    frame.updateMatrixWorld(true);
    for (const x of [-0.499, -0.25, 0, 0.25, 0.499]) {
      for (const y of [-0.499, -0.25, 0, 0.25, 0.499]) {
        const ray = new Raycaster(new Vector3(x * width, y * height, 2), new Vector3(0, 0, -1));
        assert.equal(ray.intersectObject(frame, true).length, 0);
      }
    }
    const bezel = Math.min(width, height) * 0.025;
    const ray = new Raycaster(new Vector3(width / 2 + bezel * 1.5, 0, 2), new Vector3(0, 0, -1));
    assert.ok(ray.intersectObject(frame, true).length > 0, "border must remain visible");
  });
}
