import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Raycaster, Vector3 } from 'three';
import { createDeviceBackdrop } from '../src/challenges/device-classification/device-backdrop.ts';

test('the translucent white device backing cannot intercept the grab ray', () => {
  const backdrop = createDeviceBackdrop();
  try {
    assert.equal(backdrop.material.color.getHex(), 0xffffff);
    assert.ok(backdrop.material.opacity > 0 && backdrop.material.opacity < 1);
    assert.equal(backdrop.material.depthWrite, false);
    assert.ok(backdrop.position.z < 0.22, 'the backing stays behind the device showcase');
    backdrop.updateMatrixWorld(true);
    const ray = new Raycaster(new Vector3(0, 0.7, 1), new Vector3(0, 0, -1));
    assert.equal(ray.intersectObject(backdrop).length, 0);
  } finally { backdrop.geometry.dispose(); backdrop.material.dispose(); }
});
