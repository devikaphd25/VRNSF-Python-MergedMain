/** Enter immersive VR directly when launched through the Quest APK's app icon. */
import { buildSessionInit, normalizeReferenceSpec, resolveReferenceSpaceType, type World } from "@iwsdk/core";

export function isPackagedQuestApp(): boolean {
  return new URLSearchParams(window.location.search).get("quest-apk") === "1"
    && typeof Reflect.get(window, "getDigitalGoodsService") === "function";
}

export async function startPackagedQuestSession(world: World): Promise<void> {
  if (!isPackagedQuestApp() || !navigator.xr || world.renderer.xr.getSession()) return;
  let session: XRSession | undefined;
  try {
    if (!await navigator.xr.isSessionSupported("immersive-vr")) return;
    const options = world.xrDefaults ?? {};
    session = await navigator.xr.requestSession("immersive-vr", buildSessionInit(options));
    const reference = normalizeReferenceSpec(options.referenceSpace);
    const type = await resolveReferenceSpaceType(session, reference.type, reference.required ? [] : reference.fallbackOrder);
    world.renderer.xr.setReferenceSpaceType(type);
    await world.renderer.xr.setSession(session);
    world.session = session;
    session.addEventListener("end", () => { world.session = undefined; }, { once: true });
  } catch (error) {
    await session?.end().catch(() => {});
    console.warn("[Quest APK] Automatic VR entry failed; use Enter XR to retry.", error);
  }
}
