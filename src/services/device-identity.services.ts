const DEVICE_ID_STORAGE_KEY = "vrDeviceId";

export function getPersistentDeviceId(): string {
  /*
   * A physical Quest keeps one permanent ID across browser sessions.
   * Desktop testing uses one ID per tab so two tabs represent two students
   * instead of overwriting the same Supabase participant/app_user.
   */
  const isQuestBrowser = /OculusBrowser|Meta Quest|Quest/i.test(
    navigator.userAgent
  );
  const storage = isQuestBrowser ? localStorage : sessionStorage;
  const existingDeviceId = storage.getItem(DEVICE_ID_STORAGE_KEY);

  if (existingDeviceId) {
    return existingDeviceId;
  }

  const deviceId = crypto.randomUUID();
  storage.setItem(DEVICE_ID_STORAGE_KEY, deviceId);
  return deviceId;
}
