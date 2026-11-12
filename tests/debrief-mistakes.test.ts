import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeDebriefMistakes } from '../server/services/summarize-debrief-mistakes.ts';
import { debriefMistakePages, drawDebriefMistakes } from '../src/presentation/debrief-mistakes-panel.ts';

test('debrief retains first-attempt mistakes after a correct retry, excludes correct and unanswered responses', () => {
  const questions = [{ id: 10, question_order: 1, question_text: 'Database question', options: ['A', 'B'] }];
  const result = (id: number, attempt: number, correct: boolean | null, answer: any) => ({ participant_id: id, attempt_number: attempt, started_at: '2026-11-04',
    challenge_responses: [{ question_id: 10, is_correct: correct, student_answer: answer }] });
  const review = summarizeDebriefMistakes({ id: 177, title: 'Database title' }, questions, [
    result(1, 1, false, { choice_index: 0, value: 'Old error' }), result(1, 2, true, { choice_index: 1 }),
    result(2, 1, false, { choice_index: 0, value: 'Saved wrong answer' }),
    result(3, 1, false, { choice_index: 0, value: 'Saved wrong answer' }), result(4, 1, null, null),
  ]);
  assert.equal(review.title, 'Database title'); assert.equal(review.studentCount, 3);
  assert.equal(review.questions[0].answeredStudentCount, 3);
  assert.equal(review.questions[0].incorrectStudentCount, 3);
  assert.deepEqual(review.questions[0].answers, [{ answer: 'Old error', studentCount: 1 }, { answer: 'Saved wrong answer', studentCount: 2 }]);
});

test('multi-select mistakes count wrong combinations rather than mislabelling each selected option as wrong', () => {
  const review = summarizeDebriefMistakes({ id: 1, title: 'Multi' }, [{ id: 10, question_order: 3, question_text: 'Select all', options: { choices: ['A', 'B', 'C'] } }],
    [1, 2].map(id => ({ participant_id: id, attempt_number: 1, started_at: '', challenge_responses: [{ question_id: 10, student_answer: { choice_indices: id === 1 ? [2, 0] : [0, 2] }, is_correct: false }] })));
  assert.deepEqual(review.questions[0].answers, [{ answer: 'A + C', studentCount: 2 }]);
  const pages = debriefMistakePages(review, text => [text], 1);
  assert.deepEqual(pages, [['Q3 — Select all: 2 of 2']]);
});

test('question counts do not count a student twice for different wrong answers across retries', () => {
  const review = summarizeDebriefMistakes({ id: 1, title: 'Quiz' },
    [{ id: 10, question_order: 1, question_text: 'Question', options: ['A', 'B'] }],
    [0, 1].map((choice, index) => ({ participant_id: 1, attempt_number: index + 1, started_at: '',
      challenge_responses: [{ question_id: 10, student_answer: { choice_index: choice }, is_correct: false }] })));
  assert.equal(review.questions[0].incorrectStudentCount, 1);
  assert.deepEqual(debriefMistakePages(review, text => [text], 5), [['Q1 — Question: 1 of 1']]);
});

test('first answers determine difficulty, not a later wrong retry or duplicated bonus snapshot', () => {
  const questions = [
    { id: 10, question_order: 1, question_text: 'Main', options: { choices: ['A', 'B'], presentation: { instructorLabel: 'Loop repetitions' } } },
    { id: 11, question_order: 2, question_text: 'Bonus', options: ['A', 'B'] },
  ];
  const response = (id: number, correct: boolean | null) => ({ question_id: id, is_correct: correct, student_answer: correct == null ? null : { choice_index: correct ? 1 : 0 } });
  const result = (attempt: number, time: string, main: boolean, bonus: boolean | null) => ({ participant_id: 1, attempt_number: attempt, started_at: time, challenge_responses: [response(10, main), response(11, bonus)] });
  // Input deliberately unordered: timestamps break equal-attempt ties.
  const review = summarizeDebriefMistakes({ id: 1, title: 'Quiz' }, questions, [
    result(2, '2026-11-11T11:00:00Z', false, true),
    result(1, '2026-11-11T10:05:00Z', true, false),
    result(1, '2026-11-11T10:00:00Z', true, null),
  ]);
  assert.equal(review.studentCount, 1);
  assert.equal(review.questions[0].incorrectStudentCount, 0, 'A later wrong retry must not turn the initial correct answer into a mistake');
  assert.equal(review.questions[0].shortLabel, 'Loop repetitions');
  assert.equal(review.questions[1].answeredStudentCount, 1);
  assert.equal(review.questions[1].incorrectStudentCount, 1, 'Use the first graded bonus response, skipping initial empty bonus placeholders');
});

test('an older server payload cannot render undefined labels or fabricated zero counts', () => {
  const oldPayload = { activityId: 180, title: 'Challenge 1', studentCount: 1,
    questions: [{ questionNumber: 1, question: 'Loop repetitions', answers: [] }] } as any;
  const text: string[] = [];
  drawDebriefMistakes({ fillText: (line: string) => text.push(line) } as any, oldPayload, false, 0);
  assert.ok(text.includes('Updated counts are not loaded yet.'));
  assert.ok(text.every(line => !line.includes('undefined')));
  assert.deepEqual(debriefMistakePages(oldPayload, line => [line], 6), [['Q1 — Loop repetitions: Counts unavailable']]);
});

test('wrong drops still count after correction, once per student rather than once per failed drop', () => {
  const question = { id: 50, question_order: 1, question_text: 'Match the snippet', options: {
    round: { boxes: [{category:'comparison',label:'Missing Comparison'},{category:'update',label:'Missing Update'}] }
  } };
  const result = (student: number, correct: boolean, category: string, mistakes: any[], attempt = 1) => ({
    participant_id: student, attempt_number: attempt, started_at: '', challenge_responses: [{
      question_id: 50, is_correct: correct, student_answer: { category, wrong_attempts: mistakes }
    }]
  });
  const review = summarizeDebriefMistakes({id:181,title:'Challenge 2'},[question],[
    result(1,true,'initialization',[['comparison',2],['update',1]]),
    result(1,true,'initialization',[],2),
    result(2,true,'initialization',[]),
    result(3,false,'update',[['update',1]]),
  ]);
  assert.equal(review.questions[0].answeredStudentCount,3);
  assert.equal(review.questions[0].incorrectStudentCount,2);
  assert.deepEqual(review.questions[0].answers,[
    {answer:'Missing Comparison',studentCount:1},
    {answer:'Missing Update',studentCount:1},
  ]);
});

test('empty or zero-count wrong-drop history does not mark a correct placement as wrong', () => {
  const review = summarizeDebriefMistakes({id:181,title:'Challenge 2'},
    [{id:50,question_order:1,question_text:'Match',options:{}}],
    [{participant_id:1,attempt_number:1,started_at:'',challenge_responses:[{
      question_id:50,is_correct:true,student_answer:{category:'update',wrong_attempts:[['comparison',0]]}
    }]}]);
  assert.equal(review.questions[0].incorrectStudentCount,0);
});
