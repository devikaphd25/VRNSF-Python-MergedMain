/**
 * Python puzzle number stored with each saved result (game_results.pythonpuzzle).
 * Every puzzle room sends its own number with the progress/completion payload.
 */
export const PYTHON_PUZZLE_NUMBERS = {
  castle: 1,
  forest: 2,
  ocean: 3,
} as const;
