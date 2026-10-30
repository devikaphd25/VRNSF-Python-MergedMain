import { test } from 'node:test';
import assert from 'node:assert/strict';
import { puzzleProgress } from '../src/games/python-puzzle/state/puzzle-progress.ts';
test('placing all blocks does not award success before Python passes', () => {
  const result = puzzleProgress(7, 7, 2, 1000, 12500, false);
  assert.equal(result.completedCards, 7);
  assert.equal(result.status, 'working');
  assert.equal(result.score, 0);
  assert.equal(result.wrongAnswers, 2);
  assert.equal(result.durationSeconds, 11);
});
test('successful puzzle retains attempts and elapsed time', () => {
  const result = puzzleProgress(7, 7, 1, 1000, 62000, true);
  assert.equal(result.status, 'completed');
  assert.equal(result.score, 100);
  assert.equal(result.accuracy, 50);
  assert.equal(result.correctAnswers, 1);
  assert.equal(result.durationSeconds, 61);
});
