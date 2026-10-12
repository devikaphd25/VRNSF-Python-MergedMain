/** Puzzle definition for the Python Jigsaw activity inside the forest. */

export interface ForestJigsawLine {
  id: string;
  text: string;
  correctIndent: number;
  correctSlot: number;
}

export const FOREST_PUZZLE_LINES: ForestJigsawLine[] = [
  { id: "line1", text: "guests = ['Ava', 'Ben', 'Cai', 'Dee', 'Eli']", correctIndent: 0, correctSlot: 0 },
  { id: "line2", text: "name = input('Name: ')", correctIndent: 0, correctSlot: 1 },
  { id: "line3", text: "if name in guests:", correctIndent: 0, correctSlot: 2 },
  { id: "line4", text: "print('Welcome, ' + name + '!')", correctIndent: 1, correctSlot: 3 },
  { id: "line5", text: "else:", correctIndent: 0, correctSlot: 4 },
  { id: "line6", text: "print('Sorry, ' + name + ' is not on the list')", correctIndent: 1, correctSlot: 5 },
  { id: "line7", text: "print('Guests on list:', len(guests))", correctIndent: 0, correctSlot: 6 },
];

export const FOREST_EXPECTED_OUTPUT = "Name: Cai\nWelcome, Cai!\nGuests on list: 5";

/** Fixed shuffle so the puzzle starts in the same scrambled order every time. */
export const FOREST_SHUFFLED_ORDER = [5, 2, 6, 0, 3, 1, 4];
