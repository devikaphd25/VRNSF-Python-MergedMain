/** ECS marker and scene reference for the classroom projector screen. */
import { createComponent, Group, Object3DEventMap, Types } from "@iwsdk/core";

export const ProjectorScreenComponent = createComponent("projectorScreen", {
  scene: { type: Types.Object, default: undefined as Group<Object3DEventMap> | undefined },
});
