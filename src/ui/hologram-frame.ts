import { Object3D } from "three";

const FRAME_KEY = "challengeHologramFrame";

function disposeChild(panel: Object3D, name: string): void {
  const child = panel.getObjectByName(name);
  if (!child) return;
  panel.remove(child);
  child.traverse((object: any) => {
    object.geometry?.dispose?.();
    object.material?.dispose?.();
  });
}

export function removeHologramFrame(panel: Object3D): void {
  const record = panel.userData[FRAME_KEY] as
    | { glow?: Object3D; rim?: Object3D }
    | undefined;
  if (record?.glow) panel.remove(record.glow);
  if (record?.rim) panel.remove(record.rim);
  delete panel.userData[FRAME_KEY];
  disposeChild(panel, "ChallengeHologramGlow");
  disposeChild(panel, "ChallengeHologramRim");
}

export function attachHologramFrame(panel: Object3D): void {
  removeHologramFrame(panel);
}
