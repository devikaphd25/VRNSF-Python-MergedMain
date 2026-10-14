/** Restore a student's existing device session only after server validation.
 * Instructors still enter the Professor PIN; saved display data alone is not login.
 */
import type { VRLoginUser } from "../systems/vr-login.system";
import { getPersistentDeviceId } from "./device-identity.services";

export async function restoreStoredStudentSession(): Promise<VRLoginUser | null> {
  try {
    const user = JSON.parse(localStorage.getItem("vrUser") ?? "null");
    const session = JSON.parse(localStorage.getItem("vrClassroomSession") ?? "null");
    if (
      user?.role !== "student" ||
      !Number.isInteger(user.id) || user.id <= 0 ||
      !session?.roomId || !session?.participantId
    ) return null;

    const response = await fetch("/api/device-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceId: getPersistentDeviceId(),
        userId: user.id,
        roomId: session.roomId,
        participantId: session.participantId,
      }),
    });
    if (!response.ok) return null;
    const result = await response.json();
    if (!result.success || result.user?.role !== "student" || result.user.id !== user.id) {
      return null;
    }

    const restoredUser: VRLoginUser = {
      ...result.user,
      loginTime: user.loginTime ?? new Date().toISOString(),
    };
    localStorage.setItem("vrUser", JSON.stringify(restoredUser));
    localStorage.setItem("vrClassroomSession", JSON.stringify(result.session));
    return restoredUser;
  } catch {
    // Missing, expired, unavailable or malformed sessions use the normal login.
    return null;
  }
}
