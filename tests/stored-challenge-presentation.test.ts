import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyStoredChallengePresentations } from '../server/services/stored-challenge-presentation.ts';
import { databaseChallengeQuestions } from '../server/services/database-challenge-questions.ts';

const stored = { version: 1, activityId: 177, questions: [{ questionId: 85, presentation: { prompt: 'Original prompt', codeLines: ['example from Supabase'], instructorLabel: 'Pattern' } }] };
const row = { id: 85, question_type: 'multiple_choice', question_text: 'Edited database prompt', options: ['Edited option', 'Second option'], correct_answer: { choice_index: 1 } };

test('plain answer-option updates cannot remove the separately stored code panel', () => {
  const [question] = databaseChallengeQuestions(applyStoredChallengePresentations([row], stored, 177), true);
  assert.equal(question.prompt, row.question_text);
  assert.deepEqual(question.options, row.options);
  assert.equal(question.correctIndex, 1);
  assert.deepEqual(question.presentation?.codeLines, ['example from Supabase']);
  assert.ok(Array.isArray(row.options), 'Loading must not rewrite database question rows');
});

test('an existing presentation edited in the question table takes precedence', () => {
  const edited = { ...row, options: { choices: row.options, presentation: { prompt: 'New panel', guide: ['New guide'] } } };
  const [question] = databaseChallengeQuestions(applyStoredChallengePresentations([edited], stored, 177), true);
  assert.equal(question.prompt, 'New panel'); assert.deepEqual(question.presentation?.guide, ['New guide']);
});

test('code panels cannot be borrowed from another activity or attached to the wrong question', () => {
  assert.throws(() => applyStoredChallengePresentations([row], stored, 178), /does not match/);
  assert.throws(() => applyStoredChallengePresentations([{ ...row, id: 86 }], stored, 177), /question 86/);
  assert.throws(() => applyStoredChallengePresentations([row], { ...stored, questions: [...stored.questions, ...stored.questions] }, 177), /duplicate/);
});
