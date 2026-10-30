/** ECS seat identity and classroom scene reference, consumed by SeatAssignmentSystem. */
import { createComponent, Group, Object3DEventMap, Types } from "@iwsdk/core";
import { SeatType } from "../classroom/seat-names";

export const SeatComponent = createComponent("Seat", {
  name: { type: Types.Enum, enum: SeatType, default: SeatType.Seat_R0_00 },
  scene: { type: Types.Object, default: undefined as Group<Object3DEventMap> | undefined },
});
