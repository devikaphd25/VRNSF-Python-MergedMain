export const CSDP99_W1D1_CHALLENGE2_TITLE = "Challenge 2";

export const CSDP99_W1D1_CHALLENGE2_GUIDE = [
  "Choose the correct loop type for each of the 7 scenarios:",
  "",
  "Count-controlled: repeats a specific number of times",
  "",
  "or",
  "",
  "Condition-controlled: repeats while a condition is true",
];

const LOOP_OPTIONS = ["Count-controlled", "Condition-controlled"];

export const CSDP99_W1D1_CHALLENGE2_QUESTIONS: Array<{
  prompt: string;
  instructorLabel: string;
  options: string[];
  correctIndex: number;
  correctIndices?: number[];
}> = [
  {
    prompt: "Do 10 push-ups in a workout set.",
    instructorLabel: "Do 10 push-ups",
    options: LOOP_OPTIONS,
    correctIndex: 0,
  },
  {
    prompt: "Make a sandwich for each of 12 guests.",
    instructorLabel: "Make sandwiches for 12 guests",
    options: LOOP_OPTIONS,
    correctIndex: 0,
  },
  {
    prompt: "Print a message 5 times.",
    instructorLabel: "Print a message 5 times",
    options: LOOP_OPTIONS,
    correctIndex: 0,
  },
  {
    prompt: "Water each of the 8 plants on the shelf.",
    instructorLabel: "Water all 8 plants",
    options: LOOP_OPTIONS,
    correctIndex: 0,
  },
  {
    prompt: "Keep asking for input until the user types quit.",
    instructorLabel: "Ask input until 'quit' typed",
    options: LOOP_OPTIONS,
    correctIndex: 1,
  },
  {
    prompt: "Keep stirring the sauce while it is still thin.",
    instructorLabel: "Stir sauce while thin",
    options: LOOP_OPTIONS,
    correctIndex: 1,
  },
  {
    prompt: "Keep calling until someone answers.",
    instructorLabel: "Call until someone answers",
    options: LOOP_OPTIONS,
    correctIndex: 1,
  },
];
