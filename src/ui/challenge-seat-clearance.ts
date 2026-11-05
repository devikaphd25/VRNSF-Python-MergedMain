import { Box3, Object3D, Vector3 } from 'three';
import { getPanelLayoutBounds } from './desktop-panel-framing';

const checkedAt = new WeakMap<Object3D, number>();

/** Lift the entire panel above nearby seat backs, including its lowest buttons. */
export function raiseChallengeAboveSeats(panel: Object3D, scene: Object3D, eye: Vector3, document?: unknown): number {
  scene.updateWorldMatrix(true, true);
  panel.updateWorldMatrix(true, true);
  const layout = getPanelLayoutBounds(panel, document);
  const panelBounds = layout ? layout.clone().applyMatrix4(panel.matrixWorld) : new Box3().setFromObject(panel);
  if (panelBounds.isEmpty()) return 0;
  const center = panelBounds.getCenter(new Vector3());
  const forward = center.clone().sub(eye); forward.y = 0;
  const distance = forward.length();
  if (distance < 0.01) return 0;
  forward.normalize();
  const right = new Vector3(-forward.z, 0, forward.x);
  const halfWidth = Math.hypot(panelBounds.max.x - panelBounds.min.x, panelBounds.max.z - panelBounds.min.z) / 2;
  let minimumBottom = -Infinity;
  scene.traverse(seat => {
    if (!/^Seat_R[1-5]_0[1-5]$/.test(seat.name)) return;
    for (let parent: Object3D | null = seat; parent; parent = parent.parent) if (!parent.visible) return;
    const bounds = new Box3().setFromObject(seat);
    if (bounds.isEmpty()) return;
    const offset = bounds.getCenter(new Vector3()).sub(eye); offset.y = 0;
    const depth = offset.dot(forward);
    const radius = Math.hypot(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z) / 2;
    if (depth + radius < 0 || depth - radius > distance || Math.abs(offset.dot(right)) > halfWidth + radius) return;
    minimumBottom = Math.max(minimumBottom, bounds.max.y + 0.16);
  });
  const lift = Math.max(0, minimumBottom - panelBounds.min.y);
  if (!Number.isFinite(lift) || lift === 0) return 0;
  const position = panel.getWorldPosition(new Vector3()); position.y += lift;
  panel.position.copy(panel.parent ? panel.parent.worldToLocal(position) : position);
  panel.updateWorldMatrix(false, true);
  return lift;
}

/** UIKit/seat meshes finish loading asynchronously; recheck without scanning every frame. */
export function maintainChallengeSeatClearance(panel: Object3D, scene: Object3D, viewer: Object3D, document?: unknown): void {
  const now = performance.now();
  if (now - (checkedAt.get(panel) ?? -Infinity) < 250) return;
  checkedAt.set(panel, now);
  raiseChallengeAboveSeats(panel, scene, viewer.getWorldPosition(new Vector3()), document);
}
