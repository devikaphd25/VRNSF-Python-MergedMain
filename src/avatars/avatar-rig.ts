import { Matrix4, Object3D, SkinnedMesh, Vector3 } from "three";

// Eye anchors from the supplied original models; optimization removed these empty nodes.
const EYES: Record<string, [number, number, number]> = {
  Avatar01: [0, 1.56, 0.1124955],
  Avatar02: [0, 1.565, 0.03733135],
  Avatar03: [0, 1.52, 0.13705517],
};

/** Repair the supplied rigs once at load time; shared downloads remain in their rest pose. */
export function prepareAvatarRig(root: Object3D): Object3D {
  const family = Object.keys(EYES).find(name => root.getObjectByName(`${name}_Body`));
  const head = root.getObjectByName("Head");
  const neck = root.getObjectByName("Neck");
  if (!family || !head || !neck || root.userData.avatarRigPrepared) return root;
  root.updateMatrixWorld(true);
  const inverseRoot = new Matrix4().copy(root.matrixWorld).invert();
  const neckHeight = neck.getWorldPosition(new Vector3()).applyMatrix4(inverseRoot).y;
  const point = new Vector3();
  root.traverse(object => {
    if (!(object instanceof SkinnedMesh)) return;
    const headIndex = object.skeleton.bones.findIndex(bone => bone === head);
    const positions = object.geometry.getAttribute("position");
    const joints = object.geometry.getAttribute("skinIndex");
    const weights = object.geometry.getAttribute("skinWeight");
    if (headIndex < 0 || !positions || !joints || !weights) return;
    // Clone before editing so a caller's source geometry stays intact.
    const geometry = object.geometry.clone();
    const fixedJoints = geometry.getAttribute("skinIndex");
    const fixedWeights = geometry.getAttribute("skinWeight");
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld).applyMatrix4(inverseRoot);
      // The complete jaw/head follows Head; a 2 cm band blends into the neck.
      const influence = Math.max(0, Math.min(1, (point.y - neckHeight) / 0.02));
      if (influence <= 0) continue;
      if (influence === 1) {
        fixedJoints.setXYZW(i, headIndex, 0, 0, 0);
        fixedWeights.setXYZW(i, 1, 0, 0, 0);
        continue;
      }
      const combined = new Map<number, number>();
      for (let c = 0; c < 4; c++) {
        const joint = joints.getComponent(i, c);
        combined.set(joint, (combined.get(joint) ?? 0) + weights.getComponent(i, c) * (1 - influence));
      }
      combined.set(headIndex, (combined.get(headIndex) ?? 0) + influence);
      const strongest = [...combined].sort((a, b) => b[1] - a[1]).slice(0, 4);
      const total = strongest.reduce((sum, entry) => sum + entry[1], 0);
      for (let c = 0; c < 4; c++) {
        fixedJoints.setComponent(i, c, strongest[c]?.[0] ?? 0);
        fixedWeights.setComponent(i, c, (strongest[c]?.[1] ?? 0) / total);
      }
    }
    object.geometry = geometry;
  });
  if (!root.getObjectByName("AvatarEyeAnchor")) {
    const anchor = new Object3D();
    anchor.name = "AvatarEyeAnchor";
    anchor.position.copy(head.worldToLocal(root.localToWorld(new Vector3(...EYES[family]))));
    head.add(anchor);
  }
  root.userData.avatarRigPrepared = true;
  root.updateMatrixWorld(true);
  return root;
}
