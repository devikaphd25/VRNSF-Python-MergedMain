import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Box3, EventDispatcher, Group, PerspectiveCamera, Vector3 } from 'three';
import { bindDesktopCameraRestore } from '../src/presentation/restore-desktop-camera';
import { frameDesktopPanel } from '../src/ui/desktop-panel-framing';

test('exiting XR restores the seated browser camera and keeps the UI above the floor', () => {
  const rig = new Group(); rig.position.set(2, 0, 3);
  const camera = new PerspectiveCamera(65, 1.6, 0.01, 100);
  camera.position.y = 1.6; rig.add(camera);
  const xr = new EventDispatcher() as any;
  const frames: Array<() => void> = [];
  const dispose = bindDesktopCameraRestore(camera, xr, callback => frames.push(callback));
  for (let cycle = 0; cycle < 3; cycle++) {
    xr.dispatchEvent({ type: 'sessionstart' });
    camera.position.set(0.3, -0.5, 0.8);
    camera.rotation.set(-1.2, 0.4, 0.2);
    camera.fov = 100; camera.zoom = 2; camera.near = 0.5;
    camera.aspect = 2; // Browser resize must survive the transition.
    xr.dispatchEvent({ type: 'sessionend' });
    assert.equal(camera.position.y, 1.6);
    // SDK cleanup can touch the camera after the session-end listener.
    camera.position.y = -0.5;
    frames.splice(0).forEach(callback => callback());
    assert.equal(camera.position.y, 1.6);
    assert.equal(camera.fov, 65); assert.equal(camera.zoom, 1);
    assert.equal(camera.near, 0.01); assert.equal(camera.aspect, 2);
    assert.ok(camera.quaternion.angleTo(new PerspectiveCamera().quaternion) < 1e-8);
    const panel = new Group();
    frameDesktopPanel(panel, camera, new Box3(new Vector3(-2, -0.8, 0), new Vector3(2, 0.8, 0)));
    assert.ok(panel.position.y - 0.8 > 0, 'The restored UI must stay above floor level');
  }
  dispose();
});

test('a previous exit callback cannot overwrite a new XR session', () => {
  const camera = new PerspectiveCamera(); camera.position.y = 1.6;
  const xr = new EventDispatcher() as any;
  const frames: Array<() => void> = [];
  bindDesktopCameraRestore(camera, xr, callback => frames.push(callback));
  xr.dispatchEvent({ type: 'sessionstart' });
  xr.dispatchEvent({ type: 'sessionend' });
  xr.dispatchEvent({ type: 'sessionstart' });
  camera.position.y = 0.7;
  frames.forEach(callback => callback());
  assert.equal(camera.position.y, 0.7);
});
