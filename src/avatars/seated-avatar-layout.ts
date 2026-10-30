import { Box3, Object3D, Vector3 } from "three";

export const SEATED_AVATAR_FORWARD_OFFSET = 0.18;
export const SEATED_AVATAR_HEIGHT_OFFSET = 0.50;
export const SEATED_AVATAR_MARKER_SCALE = 0.65;
export const SEATED_AVATAR_MODEL_SIZE = 1.3;

let localSeatAnchor: Vector3 | undefined;
export function setLocalSeatAnchor(position: Vector3): void { localSeatAnchor = position.clone(); }
export function getLocalSeatAnchor(): Vector3 | undefined { return localSeatAnchor; }

export function seatedAvatarMetrics(source: Object3D): { worldScale: number; eyeHeight: number } {
  source.updateWorldMatrix(true, true);
  const bounds = new Box3().setFromObject(source);
  const size = bounds.getSize(new Vector3());
  const worldScale = SEATED_AVATAR_MODEL_SIZE * SEATED_AVATAR_MARKER_SCALE /
    Math.max(size.x, size.y, size.z, 0.001);
  const eye = source.getObjectByName("AvatarEyeAnchor") ?? source.getObjectByName("Head");
  const eyeY = eye ? eye.getWorldPosition(new Vector3()).y : bounds.max.y;
  return { worldScale, eyeHeight: SEATED_AVATAR_HEIGHT_OFFSET + (eyeY - bounds.min.y) * worldScale };
}
