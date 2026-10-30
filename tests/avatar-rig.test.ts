import test from 'node:test';
import assert from 'node:assert/strict';
import { Bone, BoxGeometry, BufferGeometry, Float32BufferAttribute, Group, Mesh, Skeleton, SkinnedMesh, Uint16BufferAttribute, Vector3 } from 'three';
import { prepareAvatarRig } from '../src/avatars/avatar-rig';
import { seatedAvatarMetrics, SEATED_AVATAR_HEIGHT_OFFSET } from '../src/avatars/seated-avatar-layout';

function avatar(family = 'Avatar01') {
  const root = new Group();
  const neck = new Bone(); neck.name = 'Neck'; neck.position.y = 1.4;
  const head = new Bone(); head.name = 'Head'; head.position.y = 0.07;
  root.add(neck); neck.add(head);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([0,1.43,0.1, 0,1.6,0.1, 0,1.2,0],3));
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute([0,0,0,0, 1,0,0,0, 0,0,0,0],4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute([1,0,0,0, 1,0,0,0, 1,0,0,0],4));
  const mesh = new SkinnedMesh(geometry); mesh.name = `${family}_Body`;
  root.add(mesh); root.updateMatrixWorld(true); mesh.bind(new Skeleton([neck,head]));
  return { root, neck, head, mesh, geometry };
}

test('jaw and face use the same head bone while the source weights remain unchanged', () => {
  const a = avatar(); prepareAvatarRig(a.root);
  const joints = a.mesh.geometry.getAttribute('skinIndex');
  const weights = a.mesh.geometry.getAttribute('skinWeight');
  assert.equal(joints.getX(0), 1); assert.equal(weights.getX(0), 1);
  assert.equal(joints.getX(1), 1); assert.equal(weights.getX(1), 1);
  assert.equal(joints.getX(2), 0);
  assert.equal(a.geometry.getAttribute('skinIndex').getX(0), 0);
  const geometry = a.mesh.geometry;
  prepareAvatarRig(a.root); assert.equal(a.mesh.geometry, geometry);
  const original = new Vector3(0,1.43,0.1);
  a.head.quaternion.setFromAxisAngle(new Vector3(0,1,0), 0.5);
  a.root.updateMatrixWorld(true); a.mesh.skeleton.update();
  const moved = a.mesh.applyBoneTransform(0, original.clone());
  const pivot = new Vector3(0,1.47,0);
  const expected = original.clone().sub(pivot).applyQuaternion(a.head.quaternion).add(pivot);
  assert.ok(moved.distanceTo(expected) < 0.00001);
});

test('all supplied families restore an eye anchor at their intended eye level', () => {
  for (const [family,height] of [['Avatar01',1.56],['Avatar02',1.565],['Avatar03',1.52]] as const) {
    const a = avatar(family); prepareAvatarRig(a.root);
    const eye = a.root.getObjectByName('AvatarEyeAnchor')!;
    assert.ok(Math.abs(eye.getWorldPosition(new Vector3()).y - height) < 0.000001);
    assert.equal(eye.parent, a.head);
  }
});

test('seated eye height matches the normalized model eye anchor', () => {
  const source = new Group();
  const body = new Mesh(new BoxGeometry(0.5,0.72,0.3)); body.position.y = 1.36;
  const eye = new Group(); eye.name = 'AvatarEyeAnchor'; eye.position.y = 1.56;
  source.add(body,eye);
  const metrics = seatedAvatarMetrics(source);
  assert.ok(Math.abs(metrics.worldScale - 1.3*0.65/0.72) < 0.00001);
  assert.ok(Math.abs(metrics.eyeHeight - (SEATED_AVATAR_HEIGHT_OFFSET + 0.56*metrics.worldScale)) < 0.00001);

});
