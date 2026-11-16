// Shared client/server message format. Rotation is a quaternion [x, y, z, w].
export type AvatarRotation = [number, number, number, number];
// Position is an eye-relative offset in meters, converted to model-facing axes.
export type AvatarHandPose = { position: [number, number, number]; rotation: AvatarRotation };
// A null hand means tracking is unavailable; no individual finger data is sent.
export type SeatAvatarPose = { head: AvatarRotation; left: AvatarHandPose | null; right: AvatarHandPose | null };

/** Accept only finite, bounded tracking data; identity comes from the socket. */
export function sanitizeSeatAvatarPose(value: unknown): SeatAvatarPose | null {
  const rotation = (v: unknown): AvatarRotation | null => {
    if (!Array.isArray(v) || v.length !== 4 || !v.every(n => typeof n === "number" && Number.isFinite(n))) return null;
    const length = Math.hypot(...v);
    if (length < 0.5 || length > 1.5) return null;
    // Normalize acceptable rotations to unit length before applying them to bones.
    return v.map(n => n / length) as AvatarRotation;
  };
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  const head = rotation(data.head);
  if (!head) return null;
  // Invalid hands are discarded individually; an invalid head rejects the entire pose.
  // Each position component must stay within +/-2 meters.
  const hand = (v: unknown): AvatarHandPose | null => {
    if (!v || typeof v !== "object") return null;
    const h = v as Record<string, unknown>;
    const q = rotation(h.rotation);
    if (!q || !Array.isArray(h.position) || h.position.length !== 3 ||
        !h.position.every(n => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 2)) return null;
    return { position: h.position.slice() as [number, number, number], rotation: q };
  };
  return { head, left: hand(data.left), right: hand(data.right) };
}
