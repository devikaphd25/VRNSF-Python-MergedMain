import { test } from "node:test";
import assert from "node:assert/strict";
import { Bone, BufferGeometry, Float32BufferAttribute, Group, Skeleton, SkinnedMesh, Uint16BufferAttribute } from "three";
import { createFirstPersonAvatar } from "../src/components/instructor/first-person-avatar.ts";

test("first-person clone keeps arm triangles, hides head, and leaves original rig intact", () => {
  const root = new Group();
  const arm = new Bone(); arm.name = "LeftHand";
  const head = new Bone(); head.name = "Head";
  root.add(arm, head);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(new Array(18).fill(0), 3));
  geometry.setAttribute("skinIndex", new Uint16BufferAttribute([0,0,0,0, 0,0,0,0, 0,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0], 4));
  geometry.setAttribute("skinWeight", new Float32BufferAttribute([1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0], 4));
  geometry.setIndex([0,1,2,3,4,5]);
  const mesh = new SkinnedMesh(geometry); mesh.name = "Body";
  root.add(mesh); mesh.bind(new Skeleton([arm, head]));
  const copy = createFirstPersonAvatar(root);
  const arms = copy.getObjectByName("Body") as SkinnedMesh;
  assert.deepEqual(Array.from(arms.geometry.index!.array), [0,1,2]);
  assert.equal(geometry.index!.count, 6);
  assert.notEqual(arms.skeleton.bones[0], arm);
  assert.equal(arms.frustumCulled, false);
});
