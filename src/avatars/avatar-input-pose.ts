/** Read controller grips or tracked bare-hand wrists in the same XR space. */
export function readAvatarInputPose(frame: XRFrame, source: XRInputSource, reference: XRReferenceSpace): XRPose | null {
  // Bare hands: use the wrist joint. Finger joints are not read by this implementation.
  const wrist = source.hand?.get("wrist");
  if (wrist && frame.getJointPose) {
    const pose = frame.getJointPose(wrist, reference);
    if (pose) return pose;
  }
  // Controllers: gripSpace is the tracked grip, not the pointing laser.
  // Return null when neither input supplies a usable pose.
  return source.gripSpace ? (frame.getPose(source.gripSpace, reference) ?? null) : null;
}
