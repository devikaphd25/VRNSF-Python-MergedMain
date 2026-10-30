/** Scene reference shared by seat-selection and raise-hand notification panels. */
import { createComponent, Group, Object3DEventMap, Types } from "@iwsdk/core";

export const ClassroomPanelScene = createComponent("PSC", {
  scene: {
    type: Types.Object,
    default: undefined as Group<Object3DEventMap> | undefined,
  },
});
