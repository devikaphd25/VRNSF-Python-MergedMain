import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bindChallengeAvatarVisibility } from '../src/student/challenge-avatar-visibility.ts';

function client(instructor = false) {
  const handlers = new Map<string, (data?: any) => void>();
  const state: Record<string, any> = { isInstructor: instructor };
  const changes: boolean[] = [];
  bindChallengeAvatarVisibility({ on: (event, handler) => handlers.set(event, handler) }, state, () => changes.push(state.isStudentChallengeActive));
  return { state, changes, emit: (event: string, data?: any) => handlers.get(event)?.(data) };
}

test('all quick challenge types hide classmates until the matching instructor stop or timeout', () => {
  const f = client();
  f.emit('quickChallengeStarted', { id: 'first' }); assert.equal(f.state.isStudentChallengeActive, true);
  f.emit('quickChallengeResult', {}); assert.equal(f.state.isStudentChallengeActive, true, 'submitting does not end the shared activity');
  f.emit('quickChallengeStarted', { id: 'next' });
  f.emit('quickChallengeEnded', { quizId: 'first' }); assert.equal(f.state.isStudentChallengeActive, true);
  f.emit('quickChallengeEnded', { quizId: 'next', stoppedByInstructor: true }); assert.equal(f.state.isStudentChallengeActive, false);
  f.emit('quickChallengeStarted', { id: 'timed' });
  f.emit('quickChallengeEnded', { quizId: 'timed', timedOut: true }); assert.equal(f.state.isStudentChallengeActive, false);
});

test('device challenges and classroom transitions reset visibility; instructor remains unaffected', () => {
  const f = client(); f.emit('challenge2Started', { id: 'devices' }); assert.equal(f.state.isStudentChallengeActive, true);
  f.emit('challenge2Ended', { challengeId: 'devices' }); assert.equal(f.state.isStudentChallengeActive, false);
  for (const event of ['modeChanged', 'classEnded', 'disconnect']) {
    f.emit('quickChallengeStarted', { id: 'run' }); f.emit(event, { mode: 'Classroom Mode' }); assert.equal(f.state.isStudentChallengeActive, false);
  }
  const teacher = client(true); teacher.emit('quickChallengeStarted', { id: 'run' });
  assert.notEqual(teacher.state.isStudentChallengeActive, true);
});
