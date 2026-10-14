import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SeatAvatarPoseDriver } from '../src/components/instructor/seat-avatar-pose.ts';
import { readFileSync } from 'node:fs';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Quaternion, Vector3 } from 'three';
import { createFirstPersonAvatar } from '../src/components/instructor/first-person-avatar.ts';
test('actual alien retains first-person arm geometry and follows a reachable hand target', async () => {
const b=readFileSync('public/gltf/avatars/student-avatar-01-alien.glb');
const len=b.readUInt32LE(12); const j=JSON.parse(b.subarray(20,20+len).toString());
const bin=b.subarray(28+len);j.buffers[0].uri='data:application/octet-stream;base64,'+bin.toString('base64');
for(const m of j.meshes)for(const p of m.primitives)delete p.material;
delete j.images;delete j.textures;delete j.materials;
(globalThis as any).ProgressEvent=class {};
const g=await new GLTFLoader().parseAsync(JSON.stringify(j),'');g.scene.updateMatrixWorld(true);
const arms=createFirstPersonAvatar(g.scene);
let triangles=0;
arms.traverse((o:any)=>{if(o.isSkinnedMesh)triangles+=o.geometry.index.count/3;});
assert.ok(triangles > 100);
const handAxes = new Map<string, Vector3>();
for (const side of ['Left', 'Right']) {
  const hand = arms.getObjectByName(`${side}Hand`)!;
  const lower = arms.getObjectByName(`${side}LowerArm`)!;
  handAxes.set(side, hand.getWorldPosition(new Vector3()).sub(lower.getWorldPosition(new Vector3()))
    .normalize().applyQuaternion(hand.getWorldQuaternion(new Quaternion()).invert()));
}
const driver=new SeatAvatarPoseDriver(arms);
const offset: [number,number,number] = [0.25, -0.3, 0.25];
driver.setPose({head:[0,0,0,1],left:{position:offset,rotation:[0,0,0,1]},right:null});
const target=arms.getObjectByName('Head')!.getWorldPosition(new Vector3()).add(new Vector3(...offset).multiplyScalar(.8));
for(let i=0;i<90;i++)driver.update(1/90);
assert.ok(arms.getObjectByName('LeftHand')!.getWorldPosition(new Vector3()).distanceTo(target)<.04);
// Neutral tracking must point forward, not retain the GLB's downward rest pose.
for (const rotation of [new Quaternion(), new Quaternion().setFromAxisAngle(new Vector3(1,0,0), -.4)]) {
  driver.setPose({head:[0,0,0,1],left:{position:offset,rotation:rotation.toArray()},
    right:{position:[-.25,-.3,.25],rotation:rotation.toArray()}});
  for(let i=0;i<90;i++)driver.update(1/90);
  for (const side of ['Left', 'Right']) {
    const actual = handAxes.get(side)!.clone().applyQuaternion(arms.getObjectByName(`${side}Hand`)!.getWorldQuaternion(new Quaternion()));
    const expected = new Vector3(0,0,1).applyQuaternion(rotation);
    assert.ok(actual.angleTo(expected) < .01, `${side} wrist should follow neutral and pitched input`);
  }
}
});
