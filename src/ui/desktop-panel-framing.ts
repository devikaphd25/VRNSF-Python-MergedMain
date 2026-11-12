import { Box3, Matrix4, Object3D, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { objectLocalBounds } from './object-local-bounds';

/** UIKit bounds in the panel's coordinate system, including artwork outside the root box. */
export function getPanelLayoutBounds(panel: Object3D, document: any, includeRocket = true): Box3 | undefined {
  if (!document?.rootElement || !document.isObject3D) return;
  panel.updateWorldMatrix(true, true);
  const toPanel = new Matrix4().copy(panel.matrixWorld).invert().multiply(document.matrixWorld);
  const bounds = new Box3();
  const corner = new Vector3();
  const transform = new Matrix4();
  document.rootElement.traverse((element: any) => {
    const matrix = element.globalPanelMatrix?.value;
    const size = element.size?.value;
    if (!matrix || !size || size[0] <= 0 || size[1] <= 0 || element.isVisible?.value === false) return;
    transform.copy(toPanel).multiply(matrix);
    for (const x of [-0.5, 0.5]) for (const y of [-0.5, 0.5]) {
      bounds.expandByPoint(corner.set(x, y, 0).applyMatrix4(transform));
    }
  });
  const rocket = panel.getObjectByName('StudentRocketRig');
  if (includeRocket && rocket?.visible) {
    const local = rocket.userData.panelFrameBounds as Box3 | undefined;
    const rocketBounds = (local?.clone() ?? objectLocalBounds(rocket)).applyMatrix4(
      new Matrix4().copy(panel.matrixWorld).invert().multiply(rocket.matrixWorld));
    bounds.union(rocketBounds);
  }
  return bounds.isEmpty() ? undefined : bounds;
}

/** Browser mode follows the full camera pose and fits both boards with screen margins. */
export function frameDesktopPanel(panel: Object3D, camera: PerspectiveCamera, bounds: Box3, safeArea = 0.88): void {
  camera.updateWorldMatrix(true, false);
  const eye = camera.getWorldPosition(new Vector3());
  const orientation = camera.getWorldQuaternion(new Quaternion());
  const scale = panel.getWorldScale(new Vector3());
  const size = bounds.getSize(new Vector3()).multiply(scale);
  const center = bounds.getCenter(new Vector3()).multiply(scale);
  const tanHalfFov = Math.tan(camera.getEffectiveFOV() * Math.PI / 360);
  const distance = Math.max(1,
    Math.abs(size.y) / (2 * tanHalfFov * safeArea),
    Math.abs(size.x) / (2 * tanHalfFov * camera.aspect * safeArea)) + Math.abs(size.z) / 2;
  const position = eye.add(new Vector3(0, 0, -distance).sub(center).applyQuaternion(orientation));
  if (panel.parent) {
    panel.parent.updateWorldMatrix(true, false);
    panel.position.copy(panel.parent.worldToLocal(position));
    panel.quaternion.copy(panel.parent.getWorldQuaternion(new Quaternion()).invert().multiply(orientation));
  } else {
    panel.position.copy(position);
    panel.quaternion.copy(orientation);
  }
  panel.updateWorldMatrix(false, true);
}
