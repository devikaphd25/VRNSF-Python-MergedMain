import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Scene, Vector3 } from 'three';
import { fitObjectHeight, objectLocalBounds } from '../src/ui/object-local-bounds.ts';

test('a rocket loaded after panel placement is centered and sized locally, independent of the seated viewer pose', () => {
  const scene = new Scene(), panel = new Group(), rocket = new Group(), inner = new Group();
  panel.position.set(7, 1.6, -5); panel.rotation.y = 0.9; panel.scale.setScalar(0.85);
  scene.add(panel); panel.add(rocket); rocket.position.set(2.08, -0.58, 0.78); rocket.rotation.y = -0.62; rocket.add(inner);
  const model = new Mesh(new BoxGeometry(20, 100, 20), new MeshBasicMaterial());
  model.position.set(100, 200, -50); inner.add(model);
  for (let attempt = 0; attempt < 3; attempt++) {
    fitObjectHeight(inner, 1.18);
    const bounds = objectLocalBounds(rocket), center = bounds.getCenter(new Vector3());
    assert.ok(Math.abs(bounds.getSize(new Vector3()).y - 1.18) < 1e-6);
    assert.ok(Math.abs(bounds.min.y) < 1e-6);
    assert.ok(Math.abs(center.x) < 1e-6 && Math.abs(center.z) < 1e-6);
    panel.position.x += 3; panel.rotation.y += 0.3;
  }
});

test('invisible model parts do not make the challenge framing smaller', () => {
  const root = new Group();
  const normal = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial()); root.add(normal);
  const unused = new Mesh(new BoxGeometry(100, 100, 100), new MeshBasicMaterial()); unused.visible = false; root.add(unused);
  assert.ok(objectLocalBounds(root).getSize(new Vector3()).distanceTo(new Vector3(1, 1, 1)) < 1e-6);
});
