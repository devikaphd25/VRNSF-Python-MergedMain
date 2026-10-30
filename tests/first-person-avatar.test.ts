import { test } from "node:test";
import assert from "node:assert/strict";
import { Bone, BufferGeometry, Float32BufferAttribute, Group, Skeleton, SkinnedMesh, Uint16BufferAttribute } from "three";
import { createFirstPersonAvatar } from "../src/avatars/first-person-avatar.ts";

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

test('assigned avatar keeps separate hand meshes and hides head/body in first person', async () => {
  const { Mesh, BoxGeometry } = await import('three');
  for (const family of ['Avatar01', 'Avatar02', 'Avatar03']) {
    const source = new Group();
    const head = new Bone(); head.name = 'Head'; source.add(head);
    const body = new Mesh(new BoxGeometry()); body.name = `${family}_Body`; source.add(body);
    for (const side of ['Left', 'Right']) {
      const hand = new Group(); hand.name = `${family}_Hand${side}`;
      const surface = new Mesh(new BoxGeometry()); surface.name = `${side}Surface`;
      hand.add(surface); source.add(hand);
    }
    const copy = createFirstPersonAvatar(source);
    assert.equal(copy.getObjectByName(`${family}_Body`)!.visible, false);
    assert.equal(body.visible, true);
    for (const side of ['Left', 'Right']) {
      const hand = copy.getObjectByName(`${side}Surface`)!;
      assert.equal(hand.visible, true);
      assert.equal(hand.frustumCulled, false);
      assert.equal(hand.pointerEvents, 'none');
      assert.notEqual(hand, source.getObjectByName(`${side}Surface`));
    }
  }
});
