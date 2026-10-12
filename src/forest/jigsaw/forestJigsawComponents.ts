/** ECS component definitions for the forest jigsaw puzzle blocks and buttons. */
import { createComponent, Types } from "@iwsdk/core";

export const ForestJigsawBlock = createComponent("ForestJigsawBlock", {
  lineId: { type: Types.String, default: "" },
  text: { type: Types.String, default: "" },
  slotIndex: { type: Types.Int32, default: -1 },
  indent: { type: Types.Int32, default: 0 },
  originalIndex: { type: Types.Int32, default: 0 },
  faceEntity: { type: Types.Entity, default: null },
});

export const ForestJigsawButton = createComponent("ForestJigsawButton", {
  buttonType: {
    type: Types.Enum,
    default: "indent",
    enum: {
      indent: "indent",
      dedent: "dedent",
      reset: "reset",
      exit: "exit",
      submit: "submit",
    },
  },
});
