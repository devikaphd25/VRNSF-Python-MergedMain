import { Object3D, SkinnedMesh } from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";

/** Keep the alien's arm/hand triangles, excluding the head and torso from view. */
export function createFirstPersonAvatar(source: Object3D): Object3D {
  // SkeletonUtils gives this copy independent bones; moving it cannot move classmates.
  const root = clone(source);
  root.name = "FirstPersonAlienArms";
  root.traverse(object => {
    // Your own arms should not intercept clicks intended for classroom buttons.
    object.pointerEvents = "none";
    if (!(object instanceof SkinnedMesh)) {
      if ((object as any).isMesh) object.visible = false;
      return;
    }
    // Clone the mesh before removing triangles so the shared full-body asset stays intact.
    const geometry = object.geometry.clone();
    // skinIndex identifies influencing bones; skinWeight says how strongly each acts.
    const joints = geometry.getAttribute("skinIndex");
    const weights = geometry.getAttribute("skinWeight");
    const positions = geometry.getAttribute("position");
    if (!joints || !weights || !positions) { object.visible = false; geometry.dispose(); return; }
    const armBones = new Set(object.skeleton.bones.flatMap((bone, i) => /^(Left|Right)(UpperArm|LowerArm|Hand)$/.test(bone.name) ? [i] : []));
    // Keep vertices whose movement is mostly controlled by arm/hand bones.
    const belongsToArm = (vertex: number) => {
      let weight = 0;
      for (let component = 0; component < 4; component++) {
        if (armBones.has(joints.getComponent(vertex, component))) weight += weights.getComponent(vertex, component);
      }
      return weight > 0.5;
    };
    const index = geometry.index;
    const count = index?.count ?? positions.count;
    const triangles: number[] = [];
    // A triangle is visible only when all three corners belong to the arms.
    // The skeleton stays complete, but head/torso surfaces cannot block your view.
    for (let i = 0; i < count; i += 3) {
      const a = index ? index.getX(i) : i;
      const b = index ? index.getX(i + 1) : i + 1;
      const c = index ? index.getX(i + 2) : i + 2;
      if (belongsToArm(a) && belongsToArm(b) && belongsToArm(c)) triangles.push(a, b, c);
    }
    geometry.clearGroups();
    geometry.setIndex(triangles);
    object.geometry = geometry;
    // The animated arms can move outside the original mesh bounds; keep rendering them.
    object.frustumCulled = false;
  });
  return root;
}
