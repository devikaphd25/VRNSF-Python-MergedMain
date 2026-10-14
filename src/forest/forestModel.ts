/** Load the authored forest and prepare it for viewing from inside in stereo VR. */
import {
  Box3,
  DoubleSide,
  Group,
  LoadingManager,
  Mesh,
  Vector3,
} from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";

const FOREST_MODEL_PATH =
  `${import.meta.env.BASE_URL}models/forest/Meshy_AI_The_image_features_a__1013151630_texture.fbx`;

export function prepareForestModel(model: Group, footprint: number): Group {
  const box = new Box3().setFromObject(model);
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  const scale = footprint / Math.max(size.x, size.z, 0.0001);

  model.name = "ForestModel";
  model.scale.multiplyScalar(scale);
  model.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
  model.pointerEvents = "none";
  model.intersectChildren = false;

  model.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    // The headset is inside the scenery, not looking at the outside of a diorama.
    mesh.frustumCulled = false;
    mesh.raycast = () => {};
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      material.side = DoubleSide;
      material.needsUpdate = true;
    }
  });
  model.updateMatrixWorld(true);
  return model;
}

export function loadForestModel(footprint: number): Promise<Group> {
  return new Promise((resolve, reject) => {
    const manager = new LoadingManager();
    let model: Group | null = null;
    // FBX's geometry callback runs before its embedded texture finishes loading.
    // Wait for both so entering the forest never shows only the old puzzle props.
    manager.onLoad = () => {
      if (model) resolve(model);
    };
    manager.onError = (url) => reject(new Error(`Could not load forest asset: ${url}`));
    new FBXLoader(manager).load(
      FOREST_MODEL_PATH,
      (loaded) => { model = prepareForestModel(loaded, footprint); },
      undefined,
      reject,
    );
  });
}
