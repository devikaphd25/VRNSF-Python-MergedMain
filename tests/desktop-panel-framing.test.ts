import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setMaxListeners } from 'node:events';
import { Box3, BoxGeometry, Euler, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, Vector3 } from 'three';
import { parse, interpret } from '@pmndrs/uikitml';
// Import the document alone: the SDK entry point initializes browser-only XR canvas art.
import { UIKitDocument } from '../node_modules/@iwsdk/core/dist/ui/document.js';
import { frameDesktopPanel, getPanelLayoutBounds } from '../src/ui/desktop-panel-framing.ts';
import { objectLocalBounds } from '../src/ui/object-local-bounds.ts';

setMaxListeners(0);
(globalThis as any).document = { body: { style: { cursor: '' } } };

function assertFramed(panel: Group, camera: PerspectiveCamera, bounds: Box3) {
  camera.updateMatrixWorld(true);
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) {
    const projected = new Vector3(x, y, 0).applyMatrix4(panel.matrixWorld).project(camera);
    assert.ok(Math.abs(projected.x) <= 0.881 && Math.abs(projected.y) <= 0.881,
      `The full challenge must fit: projected corner ${projected.x}, ${projected.y}`);
    assert.ok(projected.z > -1 && projected.z < 1);
  }
  const center = bounds.getCenter(new Vector3()).applyMatrix4(panel.matrixWorld).project(camera);
  assert.ok(Math.abs(center.x) < 0.00001 && Math.abs(center.y) < 0.00001, 'Both boards must share the center of the viewport');
}

test('desktop framing centers offset boards for pitched cameras and wide/narrow windows', () => {
  const scene = new Scene(), panel = new Group(), rig = new Group();
  scene.add(panel, rig);
  rig.position.set(5, 1, -3);
  rig.rotation.y = 0.8;
  const camera = new PerspectiveCamera(60, 1.6, 0.01, 100);
  camera.position.set(1, 1.5, 2);
  camera.quaternion.setFromEuler(new Euler(-0.4, 0.35, 0.1));
  rig.add(camera);
  // The boards and timer need not be centered around the entity's origin.
  const bounds = new Box3(new Vector3(-3.2, -1.2, 0), new Vector3(1.1, 0.9, 0));
  for (const aspect of [2.4, 1.6, 1, 0.55]) {
    camera.aspect = aspect; camera.updateProjectionMatrix();
    frameDesktopPanel(panel, camera, bounds);
    assertFramed(panel, camera, bounds);
  }
});

test('actual curriculum layout, code board and timer fit after desktop resizing and layout changes', async () => {
  const parsed = parse(readFileSync('ui/curriculum-challenge.uikitml', 'utf8'));
  function layoutOnly(element: any): any {
    if (typeof element === 'string') return null;
    return { ...element, type: 'container', children: (element.children ?? []).map(layoutOnly).filter(Boolean) };
  }
  parsed.element = layoutOnly(parsed.element);
  const root = interpret(parsed)!;
  const document = new UIKitDocument(root);
  const scene = new Scene(), panel = new Group(); panel.add(document); scene.add(panel);
  document.setTargetDimensions(4.25, 1.62);
  const camera = new PerspectiveCamera(65, 1.6, 0.01, 100);
  camera.position.set(2, 1.6, 3); camera.rotation.set(-0.25, 0.5, 0); scene.add(camera);
  for (const layout of ['two-boards', 'wide-code', 'single-board']) {
    const code = document.getElementById('code-column')!;
    code.setProperties({ display: layout === 'single-board' ? 'none' : 'flex' });
    root.setProperties({ width: layout === 'single-board' ? 128 : layout === 'wide-code' ? 248 : 236 });
    for (let i = 0; i < 8; i++) { await new Promise(resolve => setTimeout(resolve, 20)); root.update(16); }
    const bounds = getPanelLayoutBounds(panel, document);
    assert.ok(bounds, 'Measure the actual visible UIKit layout');
    assert.ok(bounds.getSize(new Vector3()).x > 1);
    for (const aspect of [1.6, 0.65, 2.1]) {
      camera.aspect = aspect; camera.updateProjectionMatrix();
      frameDesktopPanel(panel, camera, bounds);
      assertFramed(panel, camera, bounds);
    }
    // Updating placement must not change the panel's measured local size.
    const measuredAgain = getPanelLayoutBounds(panel, document)!;
    assert.ok(measuredAgain.min.distanceTo(bounds.min) < 0.00001);
    assert.ok(measuredAgain.max.distanceTo(bounds.max) < 0.00001);
  }
  const rocket = new Group(); rocket.name = 'StudentRocketRig';
  const body = new Mesh(new BoxGeometry(0.3, 1.18, 0.3), new MeshBasicMaterial());
  rocket.add(body); rocket.position.set(2.08, -0.58, 0.78); rocket.rotation.y = -0.62; panel.add(rocket);
  rocket.userData.panelFrameBounds = objectLocalBounds(rocket);
  const boardsOnly = getPanelLayoutBounds(panel, document, false)!;
  rocket.visible = false;
  const withoutRocket = getPanelLayoutBounds(panel, document)!;
  rocket.visible = true;
  assert.ok(boardsOnly.min.distanceTo(withoutRocket.min) < 1e-6);
  assert.ok(boardsOnly.max.distanceTo(withoutRocket.max) < 1e-6,
    'Day 2 must use the same reading-board framing as Day 1, regardless of its rocket');
  frameDesktopPanel(panel, camera, boardsOnly);
  assertFramed(panel, camera, boardsOnly);
  const restingBounds = getPanelLayoutBounds(panel, document)!;
  frameDesktopPanel(panel, camera, restingBounds);
  const afterPlacement = getPanelLayoutBounds(panel, document)!;
  assert.ok(afterPlacement.min.distanceTo(restingBounds.min) < 1e-6);
  assert.ok(afterPlacement.max.distanceTo(restingBounds.max) < 1e-6, 'Rocket bounds must not drift when the panel moves');
  body.position.y = 100;
  const launchedBounds = getPanelLayoutBounds(panel, document)!;
  assert.ok(launchedBounds.min.distanceTo(restingBounds.min) < 1e-6);
  assert.ok(launchedBounds.max.distanceTo(restingBounds.max) < 1e-6, 'Launching the rocket must not shrink or recenter the questions');
  document.dispose();
});
