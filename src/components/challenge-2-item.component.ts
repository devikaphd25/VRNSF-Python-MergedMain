/** ECS state for a grabbable Challenge 2 snippet or number card. */
import { createComponent, Types } from "@iwsdk/core";

export const Challenge2GrabItem = createComponent("Challenge2GrabItem", {
  itemIndex: { type: Types.Int32, default: 0 },
  expectedCategory: {
    type: Types.Enum,
    default: "input",
    enum: {
      input: "input",
      output: "output",
      both: "both",
      storage: "storage",
      initialization: "initialization",
      comparison: "comparison",
      update: "update",
      print1: "print1",
      print2: "print2",
      print3: "print3",
      finalN: "finalN"
    }
  }
});
