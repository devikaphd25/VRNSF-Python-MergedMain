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

function isRocketObject(object: Object3D): boolean {
  let current: Object3D | null = object;
  while (current) {
    if (
      current.name === "ClassRocketCompanion" ||
      current.name === "StudentRocketRig" ||
      current.userData?.isClassRocket ||
      current.userData?.isStudentRocket
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

/** Keep the student quiz in the scene depth buffer so XR hands and the default controller ray stay visible. */
export function applyStudentQuizSceneDepth(panel: Object3D): void {
  panel.renderOrder = 0;
  panel.traverse(object => {
    if (isRocketObject(object)) return;
    object.renderOrder = 0;
    const mesh = object as any;
    if (!mesh.isMesh || !mesh.material) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.forEach((material: any) => {
      if (material.depthTest === false) {
        material.depthTest = true;
        material.needsUpdate = true;
      }
    });
  });
}
