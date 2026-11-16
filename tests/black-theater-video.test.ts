import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Group, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { centerTheaterViewer } from '../src/presentation/center-theater-viewer';
import { videoViewForActivity } from '../shared/video-view';
import { canUsePresentationBoardView } from '../src/student/presentation-board-control';

test('theater mode comes from the selected database video, with other activities unchanged', () => {
  assert.equal(videoViewForActivity({ activity_type: 'video', activity_key: 'video_black_theater' }), 'black_theater');
  assert.equal(videoViewForActivity({ activity_type: 'video', activity_key: null }), 'classroom');
  assert.equal(videoViewForActivity({ activity_type: 'debrief', activity_key: 'video_black_theater' }), 'classroom');
  assert.equal(canUsePresentationBoardView({ isPresentationOpen: true, isSoloVideoActive: true }), false);
  assert.equal(canUsePresentationBoardView({ isPresentationOpen: true, isSoloVideoActive: false }), true);
});

test('automatic theater centering compensates physical headset offsets and restores the assigned-seat rig', () => {
  const parent = new Group(); parent.position.set(3, 0, -2); parent.rotation.y = 0.4;
  const rig = new Group(); rig.position.set(2, 0.2, -5); rig.rotation.y = -0.7; parent.add(rig);
  const viewer = new PerspectiveCamera(); rig.add(viewer);
  const savedPosition = rig.position.clone(), savedRotation = rig.quaternion.clone();
  const targetEye = new Vector3(0, 2.8, -1.8), screen = new Vector3(0, 2.8, 6.2);
  for (const [x, y, z, yaw] of [[0, 1.6, 0, 0], [0.65, 1.2, -0.45, 1.1], [-0.8, 1.8, 0.3, -1.4]]) {
    viewer.position.set(x, y, z); viewer.rotation.set(0, yaw, 0);
    parent.updateMatrixWorld(true);
    centerTheaterViewer(rig, viewer, targetEye, screen);
    const eye = viewer.getWorldPosition(new Vector3());
    assert.ok(eye.distanceTo(targetEye) < 1e-8, 'Actual eyes must be centered, not just the rig origin');
    const forward = new Vector3(0, 0, -1).applyQuaternion(viewer.getWorldQuaternion(new Quaternion()));
    assert.ok(forward.dot(screen.clone().sub(eye).normalize()) > 0.99999);
    rig.position.copy(savedPosition); rig.quaternion.copy(savedRotation); rig.updateMatrixWorld(true);
    assert.ok(rig.position.distanceTo(savedPosition) < 1e-8);
    assert.ok(rig.quaternion.angleTo(savedRotation) < 1e-7);
  }
});
