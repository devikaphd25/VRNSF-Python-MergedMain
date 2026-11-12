import type { PerspectiveCamera, WebXRManager } from 'three';

/** WebXR writes the headset pose/projection into the desktop camera. Restore
 * its browser pose before camera-relative UI is fitted again on session end. */
export function bindDesktopCameraRestore(
  camera: PerspectiveCamera,
  xr: Pick<WebXRManager, 'addEventListener' | 'removeEventListener'>,
  nextFrame: (callback: () => void) => unknown = callback => requestAnimationFrame(callback),
): () => void {
  let saved: {
    position: typeof camera.position; quaternion: typeof camera.quaternion;
    scale: typeof camera.scale; fov: number; zoom: number; near: number; far: number;
  } | undefined;
  let generation = 0;
  const start = () => {
    generation++;
    saved = {
      position: camera.position.clone(), quaternion: camera.quaternion.clone(),
      scale: camera.scale.clone(), fov: camera.fov, zoom: camera.zoom,
      near: camera.near, far: camera.far,
    };
  };
  const end = () => {
    const snapshot = saved;
    if (!snapshot) return;
    const endedGeneration = generation;
    const restore = () => {
      if (generation !== endedGeneration) return;
      camera.position.copy(snapshot.position);
      camera.quaternion.copy(snapshot.quaternion);
      camera.scale.copy(snapshot.scale);
      camera.fov = snapshot.fov;
      camera.zoom = snapshot.zoom;
      camera.near = snapshot.near;
      camera.far = snapshot.far;
      // Keep the current browser aspect in case the window was resized in XR.
      camera.updateProjectionMatrix();
      camera.updateMatrix();
      camera.updateWorldMatrix(true, false);
    };
    restore();
    // Run again after SDK session-end cleanup, before the next browser render.
    nextFrame(restore);
    saved = undefined;
  };
  xr.addEventListener('sessionstart', start);
  xr.addEventListener('sessionend', end);
  return () => {
    generation++;
    xr.removeEventListener('sessionstart', start);
    xr.removeEventListener('sessionend', end);
  };
}
