import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { ActivitySequence } from '../src/instructor/activity-sequence.ts';

function dashboard() {
  const source = ts.createSourceFile('dashboard.ts', readFileSync('src/systems/instructor-dashboard.system.ts', 'utf8'), ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find(ts.isClassDeclaration);
  const action = declaration.members.find(member => member.name?.getText(source) === 'onChallengeLaunchError').getText(source);
  const context = vm.createContext({ window: { isInstructor: true } });
  vm.runInContext(ts.transpile(`class Dashboard { ${action} }; globalThis.Dashboard = Dashboard;`, { target: ts.ScriptTarget.ES2022 }), context);
  const control = new context.Dashboard(), sequence = new ActivitySequence(), completed = new Set(['activity:135', 'activity:177']);
  sequence.launched('activity:177');
  Object.assign(control, { pendingChallengeActivityId: 177, completedTaskKeys: completed, currentActivity: sequence,
    getTaskQueue: () => [{ key: 'activity:135' }, { key: 'activity:177' }], setDashboardVisible: value => control.visible = value,
    renderLessonPage() {}, showStatusMessage: message => control.message = message,
  });
  return { control, sequence, completed };
}

test('a rejected database challenge launch reopens the dashboard and removes its false completion dot', () => {
  const { control, sequence, completed } = dashboard();
  control.onChallengeLaunchError({ activityId: 177, message: 'Missing or invalid presentation in Supabase question 85.' });
  assert.equal(control.visible, true);
  assert.equal(control.taskView, 'all', 'The error status must be visible outside compact mode');
  assert.match(control.message, /Supabase question 85/);
  assert.equal(completed.has('activity:177'), false);
  assert.equal(completed.has('activity:135'), true);
  assert.equal(sequence.index, 1); assert.equal(sequence.awaitingReturn, false);
  assert.equal(control.pendingChallengeActivityId, undefined);
});

test('an unrelated error cannot undo another challenge or a successful launch', () => {
  const { control, completed } = dashboard();
  control.onChallengeLaunchError({ activityId: 178, message: 'Other activity' });
  assert.equal(completed.has('activity:177'), true); assert.equal(control.visible, undefined);
  control.pendingChallengeActivityId = undefined;
  control.onChallengeLaunchError({ activityId: 177, message: 'Late error' });
  assert.equal(completed.has('activity:177'), true);
});
