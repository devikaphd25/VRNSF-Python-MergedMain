export const CSDP99_W1D1_CHALLENGE1_TITLE = "Challenge 1";

export const CSDP99_W1D1_CODE_LINES = [
  "Welcome, Jordan!",
  "Your locker is ready.",
  "Welcome, Maria!",
  "Your locker is ready.",
  "Welcome, Sam!",
  "Your locker is ready.",
];

export const CSDP99_W1D1_CHALLENGE1_QUESTIONS = [
  {
    prompt: "Find the pattern that repeats",
    instructorLabel: "Repeated pattern selection",
    options: ["Line 1", "Line 2", "Lines 1 and 2", "Lines 1 to 6"],
    correctIndex: 2,
  },
  {
    prompt: "Count how many times it appears",
    instructorLabel: "Count the pattern appears",
    options: ["1", "2", "3", "6"],
    correctIndex: 2,
  },
  {
    prompt: "Select the three problems with duplicated code. Select all that apply",
    instructorLabel: "Card placements",
    options: [
      "Makes the program large",
      "Time consuming to write",
      "Python cannot run repeated lines",
      "An error must be corrected in many places",
      "Repeated lines run more slowly",
    ],
    correctIndex: -1,
    correctIndices: [0, 1, 3],
  },
];
