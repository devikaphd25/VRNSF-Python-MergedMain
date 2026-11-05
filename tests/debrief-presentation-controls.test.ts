import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

test('database debrief launch sends its image and activity ID to students and opens the same instructor presentation', () => {
  const source = ts.createSourceFile('dashboard.ts', readFileSync('src/systems/instructor-dashboard.system.ts', 'utf8'), ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find(ts.isClassDeclaration)!;
  const method = declaration.members.find(member => member.name?.getText(source) === 'launchBriefingMode')!;
  const sent: any[] = [], opened: any[] = [], visibility: boolean[] = [];
  const context = vm.createContext({ DEBRIEF_IN_CLASSROOM_ONLY: true, performance: { now: () => 5000 },
    socket: { emit: (...args: any[]) => sent.push(args) },
    window: { presentationSystem: { enterImagePresentation: (...args: any[]) => opened.push(args) } },
  });
  vm.runInContext(ts.transpile(`class Dashboard { ${method.getText(source)} }; globalThis.Dashboard = Dashboard;`, { target: ts.ScriptTarget.ES2022 }), context);
  const dashboard = new context.Dashboard();
  Object.assign(dashboard, { lastPresentationActivationAt: 0, selectedActivityId: 260,
    pendingBriefingAssetPath: 'https://storage.example/signed-debrief.png',
    setCurrentMode(mode: string) { assert.equal(mode, 'Presentation Mode'); },
    showStatusMessage() {}, setDebriefViewChoiceVisible() {}, setDashboardVisible(value: boolean) { visibility.push(value); },
    setLabMonitorVisible() {}, setLabMonitorAvailable() {},
  });
  dashboard.launchBriefingMode('classroom');
  assert.equal(sent.length, 1);
  assert.equal(sent[0][0], 'instructorSendAllToDestination');
  assert.deepEqual(JSON.parse(JSON.stringify(sent[0][1])), { destination: 'Presentation', assetPath: dashboard.pendingBriefingAssetPath,
    activityId: 260, mediaType: 'image', debriefView: 'classroom' });
  assert.deepEqual(opened, [[dashboard.pendingBriefingAssetPath, 'classroom']]);
  assert.deepEqual(visibility, [false]);
});
