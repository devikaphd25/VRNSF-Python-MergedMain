import { prepareAvatarRig } from "./avatar-rig";
import { Object3D } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

// First-person hands and seated copies share downloads, but clone before animating.
const avatarLoads = new Map<string, Promise<Object3D>>();
export function loadAvatarModel(url: string): Promise<Object3D> {
  let pending = avatarLoads.get(url);
  if (!pending) {
    pending = new GLTFLoader().loadAsync(url).then(gltf => prepareAvatarRig(gltf.scene));
    avatarLoads.set(url, pending);
    pending.catch(() => avatarLoads.delete(url));
  }
  return pending;
}
