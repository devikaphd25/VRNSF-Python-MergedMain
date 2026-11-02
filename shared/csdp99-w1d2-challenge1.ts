export const CSDP99_W1D2_CHALLENGE1_TITLE = "Challenge 1";

export const CSDP99_W1D2_CODE_LINES = [
  "user_input = \"\"",
  "while user_input != \"QUIT\":",
  "    user_input = input(\"Enter 'Quit' to exit: \")",
  "    print(f\"Entered: {user_input}\")",
  "print(\"Loop exited.\")",
];

export const CSDP99_W1D2_INPUT_SEQUENCE =
  "Given the input sequence Hi -> Bye -> QUIT.";

export const CSDP99_W1D2_CHALLENGE1_QUESTIONS: Array<{
  prompt: string;
  instructorLabel: string;
  options: string[];
  correctIndex: number;
  correctIndices?: number[];
}> = [
  {
    prompt: "How many times does the loop body run?",
    instructorLabel: "How many times loop body runs",
    options: ["1", "2", "3", "4"],
    correctIndex: 1,
  },
  {
    prompt: "What is the first line printed by the loop?",
    instructorLabel: "First line printed by loop",
    options: ["Entered: Hi", "Entered: Bye", "Entered: QUIT", "Loop exited."],
    correctIndex: 0,
  },
  {
    prompt: "What is the second line printed by the loop?",
    instructorLabel: "Second line printed by loop",
    options: ["Entered: Hi", "Entered: Bye", "Entered: QUIT", "Loop exited."],
    correctIndex: 1,
  },
  {
    prompt: "What is the last line the program prints?",
    instructorLabel: "Last line the program prints",
    options: ["Entered: QUIT", "Loop exited.", "Entered: Bye", "Program finished."],
    correctIndex: 1,
  },
  {
    prompt: "Which line inside the loop updates user input and allows the loop to stop?",
    instructorLabel: "Which line updates user input",
    options: ["Line 2", "Line 3", "Line 4", "Line 5"],
    correctIndex: 1,
  },
];
