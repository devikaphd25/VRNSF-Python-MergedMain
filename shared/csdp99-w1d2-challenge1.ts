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
    instructorLabel: "Loop body times",
    options: ["1", "2", "3", "4"],
    correctIndex: 1,
  },
  {
    prompt: "What is the first line printed by the loop?",
    instructorLabel: "First printed line",
    options: ["Entered: Hi", "Entered: Bye", "Entered: QUIT", "Loop exited."],
    correctIndex: 0,
  },
  {
    prompt: "What is the second line printed by the loop?",
    instructorLabel: "Second printed line",
    options: ["Entered: Hi", "Entered: Bye", "Entered: QUIT", "Loop exited."],
    correctIndex: 1,
  },
  {
    prompt: "What is the last line the program prints?",
    instructorLabel: "Last printed line",
    options: ["Entered: QUIT", "Loop exited.", "Entered: Bye", "Program finished."],
    correctIndex: 1,
  },
  {
    prompt: "Which line inside the loop updates user input and allows the loop to stop?",
    instructorLabel: "Input update line",
    options: ["Line 2", "Line 3", "Line 4", "Line 5"],
    correctIndex: 1,
  },
];

export const CSDP99_W1D2_CHALLENGE1_EXTRA_CREDIT: Array<{
  prompt: string;
  instructorLabel: string;
  options: string[];
  correctIndex: number;
}> = [
  {
    prompt: "What is the initial value of user_input before the while loop starts?",
    instructorLabel: "Initial user_input",
    options: ['"QUIT"', '"" (an empty string)', '"Hi"', "0"],
    correctIndex: 1,
  },
  {
    prompt: "What does the comparison operator != mean?",
    instructorLabel: "Meaning of !=",
    options: ["Equal to", "Greater than", "Not equal to", "Less than or equal to"],
    correctIndex: 2,
  },
  {
    prompt: "Which function is used to get text input from the user?",
    instructorLabel: "Input function",
    options: ["print()", "input()", "while()", "scan()"],
    correctIndex: 1,
  },
];
