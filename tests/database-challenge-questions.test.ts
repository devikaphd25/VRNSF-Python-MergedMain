import { test } from 'node:test';
import assert from 'node:assert/strict';
import { databaseChallengeQuestions } from '../server/services/database-challenge-questions.ts';
import { gradeChallengeAnswer } from '../server/services/grade-challenge-answer.ts';

const row = () => ({ id: 41, question_type: 'multiple_choice', question_text: 'Database question',
  options: { choices: ['Database A', 'Database B'], presentation: { prompt: 'Edited prompt', codeLines: ['edited = 7'], instructorLabel: 'Edited monitor label' } },
  correct_answer: { choice_index: 1 } });

test('database edits supply the prompt, code, options, answer and instructor label without a catalog', () => {
  const input = row();
  const [question] = databaseChallengeQuestions([input], true);
  assert.equal(question.prompt, 'Edited prompt');
  assert.equal(question.instructorLabel, 'Edited monitor label');
  assert.deepEqual(question.presentation?.codeLines, ['edited = 7']);
  assert.deepEqual(question.options, ['Database A', 'Database B']);
  assert.equal(gradeChallengeAnswer(question, 1).correct, true);
  input.correct_answer.choice_index = 0;
  assert.equal(gradeChallengeAnswer(databaseChallengeQuestions([input], true)[0], 1).correct, false);
});

test('legacy True/False option arrays remain supported; curriculum content cannot silently fall back to source', () => {
  const input = { ...row(), options: ['True', 'False'] };
  assert.equal(databaseChallengeQuestions([input])[0].prompt, input.question_text);
  assert.throws(() => databaseChallengeQuestions([input], true), /presentation/);
  assert.throws(() => databaseChallengeQuestions([]), /missing/);
});

test('multi-select accepts exactly the stored choices and rejects extra or incomplete placements', () => {
  const question = databaseChallengeQuestions([{ ...row(), options: ['A', 'B', 'C', 'D', 'E'], correct_answer: { choice_indices: [0, 1, 3] } }])[0];
  assert.equal(gradeChallengeAnswer(question, 11).correct, true);
  assert.equal(gradeChallengeAnswer(question, 15).correct, false);
  assert.equal(gradeChallengeAnswer(question, 3).correct, false);
  assert.equal(gradeChallengeAnswer(question, 0).correct, false);
});

test('invalid database answers and malformed presentation fail clearly instead of silently grading', () => {
  for (const correct_answer of [{ choice_index: -1 }, { choice_index: 2 }, { choice_indices: [] }, { choice_indices: [0, 0] }, { choice_indices: [0, 5] }]) {
    assert.throws(() => databaseChallengeQuestions([{ ...row(), correct_answer }]), /Invalid Supabase question/);
  }
  assert.throws(() => databaseChallengeQuestions([{ ...row(), options: { choices: ['A', 'B'], presentation: { prompt: 'P', codeLines: 'not an array' } } }]), /presentation/);
});
