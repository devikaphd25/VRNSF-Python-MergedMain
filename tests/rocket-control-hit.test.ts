import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Group, Mesh, MeshBasicMaterial, PlaneGeometry, Raycaster, Vector3 } from 'three';
import { StudentRocketRig } from '../src/challenges/true-false/student-rocket';

test('XR rocket hit checks use flat controls without traversing detailed model meshes', () => {
  // Avoid browser canvas/model loading: exercise the real hit methods with a
  // detailed-mesh sentinel that would fail if a recursive raycast touched it.
  const rocket = Object.create(StudentRocketRig.prototype) as any;
  rocket.root = new Group();
  rocket.root.visible = true;
  rocket.launching = false; rocket.hasLaunched = false;
  rocket.assembled = Array(5).fill(false);
  rocket.unlocked = Array(5).fill(true);
  const model = new Mesh(new PlaneGeometry(100, 100), new MeshBasicMaterial());
  model.raycast = () => { throw Error('Detailed rocket mesh must never be raycast for button hover'); };
  rocket.root.add(model);
  rocket.launchButton = new Mesh(new PlaneGeometry(0.5, 0.16), new MeshBasicMaterial());
  rocket.launchButton.position.set(2, 0, 0);
  rocket.root.add(rocket.launchButton);
  rocket.pickups = Array.from({ length: 5 }, (_, index) => {
    const hit = new Mesh(new PlaneGeometry(0.24, 0.24), new MeshBasicMaterial());
    hit.position.set(index * 0.3, 0, 0);
    rocket.root.add(hit);
    return { hit, wrapper: new Group() };
  });
  rocket.root.updateMatrixWorld(true);
  const ray = (x: number) => new Raycaster(new Vector3(x, 0, 1), new Vector3(0, 0, -1));
  for (let frame = 0; frame < 1440; frame++) {
    assert.equal(rocket.hitControls(ray(0)), true, 'Unlocked pickup remains reachable');
    assert.equal(rocket.hitControls(ray(10)), false, 'Background is not a control');
  }
  rocket.unlocked[0] = false;
  assert.equal(rocket.hitControls(ray(0)), false, 'Locked pickup is not draggable');
  rocket.unlocked.fill(true); rocket.assembled.fill(true);
  assert.equal(rocket.hitControls(ray(2)), true, 'Launch remains reachable once assembled');
  rocket.root.visible = false;
  assert.equal(rocket.hitControls(ray(2)), false);
});
