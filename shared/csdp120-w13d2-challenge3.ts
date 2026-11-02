export const CSDP120_W13D2_CHALLENGE3_TITLE = "Challenge 3";

const INDENT = "    ";

export const CSDP120_W13D2_C3_CODE_LINES = [
  "name = input('Username: ')",
  "# [Line 2: Strip whitespace]",
  "# [Line 3: Convert to lowercase]",
  "# [Line 4: Check if clean equals 'hawk1']",
  `${INDENT}print('Welcome back!')`,
  "else:",
  `${INDENT}# [Line 7: Print unknown user using clean]`,
];

export const CSDP120_W13D2_CHALLENGE3_QUESTIONS: Array<{
  prompt: string;
  instructorLabel: string;
  options: string[];
  correctIndex: number;
  correctIndices?: number[];
}> = [
  {
    prompt: "Which statement correctly strips whitespace from the input and assigns it to clean?",
    instructorLabel: "Strip whitespace into clean",
    options: [
      "clean = name.strip()",
      "name.strip()",
      "clean = name.rstrip()",
      "clean = name.lstrip()",
    ],
    correctIndex: 0,
  },
  {
    prompt: "Which statement correctly converts the cleaned name to lowercase and updates clean?",
    instructorLabel: "Convert clean to lowercase",
    options: [
      "clean.lower()",
      "clean = clean.lower()",
      "clean = name.lower()",
      "clean = clean.upper()",
    ],
    correctIndex: 1,
  },
  {
    prompt: "Which if condition correctly checks if the fully cleaned and lowercase name matches 'hawk1'?",
    instructorLabel: "If clean equals hawk1",
    options: [
      "if clean == 'hawk1':",
      "if name == 'hawk1':",
      "if clean == 'HAWK1':",
      "if clean != 'hawk1':",
    ],
    correctIndex: 0,
  },
  {
    prompt: "Which statement is correctly placed in the else block to output the unknown user using the cleaned variable?",
    instructorLabel: "Else print unknown user",
    options: [
      "print('Unknown user:', name)",
      "print('Unknown user:', clean)",
      "print('Unknown user:', clean.upper())",
      "print('Unknown user: ' + name)",
    ],
    correctIndex: 1,
  },
  {
    prompt: "What does the program print when the user inputs \"  HAWK1  \"? (spaces around HAWK1)",
    instructorLabel: "Input with spaces around HAWK1",
    options: [
      "Welcome back!",
      "Unknown user:   HAWK1  ",
      "Unknown user: hawk1",
      "Welcome back! (with spaces)",
    ],
    correctIndex: 0,
  },
  {
    prompt: "What does the program print when the user inputs Eagle9?",
    instructorLabel: "Input Eagle9",
    options: [
      "Unknown user: Eagle9",
      "Unknown user: eagle9",
      "Welcome back!",
      "Unknown user: EAGLE9",
    ],
    correctIndex: 1,
  },
];
