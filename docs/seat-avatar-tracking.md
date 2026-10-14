# Seat avatar tracking

The alien seat marker now supports head rotation and controller-driven arms/hands. It remains at the assigned seat. The student's own seat marker remains hidden, while a separate first-person copy shows their alien arms and hands in the headset. Other students and the instructor see the seated avatar move.

## File guide — start here

Read `seat-avatar-tracking.system.ts` first. The avatar source files contain comments explaining each step.

| File | What it does |
| --- | --- |
| `public/gltf/avatars/student-avatar-01-alien.glb` | The model: mesh, materials, skin weights, and existing head/arm/wrist bones. No finger bones. |
| `src/index.ts` | Loads the GLB as `studentSeatAlien` and starts the tracking system for all roles. |
| `src/systems/seat-avatar-tracking.system.ts` | Coordinates headset input, local arms, and network messages. Updates local arms every frame and sends poses 15 times per second. |
| `src/components/instructor/avatar-input-pose.ts` | Reads a bare-hand wrist joint or a controller grip pose. |
| `src/components/instructor/first-person-avatar.ts` | Makes an independent copy showing only your arms/hands, so the head and torso do not block your view. |
| `src/components/instructor/seat-avatar-pose.ts` | Rotates the head, bends shoulders/elbows toward hand positions, corrects wrist orientation, and smooths movement. Used for both local and remote models. |
| `src/components/instructor/seat-markers.ts` | Creates an alien and name label at each occupied seat. Matches incoming movement to the student's socket ID. |
| `shared/seat-avatar-tracking.ts` | Defines and validates pose messages used by both client and server. |
| `server.ts` (`seatAvatarPose` handler) | Forwards validated movement to other participants in the same classroom. |
| `src/network/socket.ts` | Supplies the shared network connection; it is also used by other classroom features. |

## How movement travels

1. The headset supplies eye rotation and controller/bare-hand wrist poses.
2. The tracking system converts them to offsets relative to the eyes and the model's forward direction.
3. Your first-person model applies the pose immediately through `SeatAvatarPoseDriver`.
4. The same pose goes through Socket.IO to `server.ts`, then to classroom peers.
5. Each peer's tracking system calls `applySeatAvatarPose`; the seat marker's driver moves the corresponding student's bones.

The Raise Hand button is a separate override for the right arm. It is not the same as detecting a physically raised hand.

## Where to adjust the avatar

| Setting | Location and current value |
| --- | --- |
| Your first-person size | Tracking system: `scale.setScalar(1.25)`. The head-alignment calculation also uses `1.25`; keep those values consistent. |
| Seated model size | Seat markers: model normalization `1.3`, then outer marker scale `0.65`. Both affect final size. |
| Seated model height | Seat markers: `pos.y + 0.50`. This is relative to the seat anchor. |
| Hand reach | Pose driver: offset multiplier `0.8`, also affected by the model's world scale. |
| Wrist droop correction | Pose driver: `neutralHandOrientation` aligns the resting hand direction with model forward before tracking is applied. |
| Movement smoothing | Pose driver: `14` in the blend formula. Larger values catch up faster. |
| Brief hand tracking loss | Tracking system: retain the last hand pose for up to `250` milliseconds. |
| Stalled pose timeout | Pose driver: `700` milliseconds before returning toward rest. |

## Checks

- `tests/avatar-input-pose.test.ts`: bare-hand/controller selection and missing input.
- `tests/first-person-avatar.test.ts`: arm-only geometry and independent cloned bones.
- `tests/alien-model.test.ts`: actual GLB reach and wrist orientation.
- `tests/seat-avatar-tracking.test.ts`: message validation, Raise Hand, head movement, and reset.

## Try it in a headset

1. Restart the backend with `npm run dev:server` and refresh both clients.
2. Sign in as instructor in a browser and as a different student in the headset, in the same classroom.
3. Enter VR facing comfortably forward. This sets the neutral body direction for that XR session.
4. Look down at your hands and lift each VR controller or tracked bare hand: your own alien arms should follow. The instructor should view the student's assigned seat. Turn and tilt your head, move each controller separately, and twist each wrist.
5. Select Raise Hand, then Lower Hand. The right arm should lift and resume tracking when lowered. Raise Hand also works without XR tracking.
6. Exit VR or set controllers aside. Missing poses return to the model's rest pose (after about 0.7 seconds for stalled tracking). Reenter VR facing forward to recalibrate.

Controller positions are scaled to this alien's proportions. This is approximate upper-body retargeting, not a calibrated full-body or finger tracker. Both controller grip poses and bare-hand wrist joints are supported. Brief hand tracking losses retain the last pose for up to 250 ms. Finger articulation is not supported. There are no individual finger bones. The body stays seated and the model's size is unchanged. Tracking pauses while the student is in a game or Challenge 2; other clients still render classmates. Pose packets are transient and are not saved to the database.

Physical headset validation remains necessary, particularly for neutral facing direction, wrist alignment, and elbow appearance. The automated checks do not prove visual alignment on the actual device.

If the instructor sees no motion, restart the backend: an already-running Node process does not load newly added Socket.IO handlers. Refresh both browser and headset after client updates.
