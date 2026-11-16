/** ECS state for a grabbable Challenge 2 snippet or number card. */
import { createComponent, Types } from "@iwsdk/core";

export const LoopDragItemComponent = createComponent("LoopDragItemComponent", {
  itemIndex: { type: Types.Int32, default: 0 }
});
