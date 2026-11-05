import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeDebriefMistakes } from '../server/services/summarize-debrief-mistakes.ts';
import { debriefMistakePages } from '../src/presentation/debrief-mistakes-panel.ts';

test('debrief retains first-attempt mistakes after a correct retry, excludes correct and unanswered responses', () => {
  const questions = [{ id: 10, question_order: 1, question_text: 'Database question', options: ['A', 'B'] }];
  const result = (id: number, attempt: number, correct: boolean | null, answer: any) => ({ participant_id: id, attempt_number: attempt, started_at: '2026-11-04',
    challenge_responses: [{ question_id: 10, is_correct: correct, student_answer: answer }] });
  const review = summarizeDebriefMistakes({ id: 177, title: 'Database title' }, questions, [
    result(1, 1, false, { choice_index: 0, value: 'Old error' }), result(1, 2, true, { choice_index: 1 }),
    result(2, 1, false, { choice_index: 0, value: 'Saved wrong answer' }),
    result(3, 1, false, { choice_index: 0, value: 'Saved wrong answer' }), result(4, 1, null, null),
  ]);
  assert.equal(review.title, 'Database title'); assert.equal(review.studentCount, 4);
  assert.deepEqual(review.questions[0].answers, [{ answer: 'Old error', studentCount: 1 }, { answer: 'Saved wrong answer', studentCount: 2 }]);
});

test('multi-select mistakes count wrong combinations rather than mislabelling each selected option as wrong', () => {
  const review = summarizeDebriefMistakes({ id: 1, title: 'Multi' }, [{ id: 10, question_order: 3, question_text: 'Select all', options: { choices: ['A', 'B', 'C'] } }],
    [1, 2].map(id => ({ participant_id: id, attempt_number: 1, started_at: '', challenge_responses: [{ question_id: 10, student_answer: { choice_indices: id === 1 ? [2, 0] : [0, 2] }, is_correct: false }] })));
  assert.deepEqual(review.questions[0].answers, [{ answer: 'A + C', studentCount: 2 }]);
  const pages = debriefMistakePages(review, text => [text], 1);
  assert.deepEqual(pages, [['Question 3'], ['A + C']]);
});
