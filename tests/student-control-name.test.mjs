import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

test('control board shows the registered database name independently for each student', () => {
  const source = ts.createSourceFile('presentation.ts', readFileSync('src/systems/presentation.system.ts', 'utf8'), ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find(ts.isClassDeclaration);
  const methods = declaration.members.filter(member => ['onStudentRegistered', 'updateStudentHandControl'].includes(member.name?.getText(source))).map(member => member.getText(source)).join('\n');
  const context = vm.createContext({ window: { vrUser: { fullName: 'Initial name' } } });
  vm.runInContext(ts.transpile(`class Controls { ${methods} }; globalThis.Controls = Controls;`, { target: ts.ScriptTarget.ES2022 }), context);
  const first = new context.Controls(), second = new context.Controls(), labels = [{}, {}];
  for (const [index, control] of [first, second].entries()) control.studentControlsDocument = { getElementById: id => ({ setProperties: properties => labels[index][id] = properties.text }) };
  first.onStudentRegistered({ success: true, user: { fullName: 'Student 5' } });
  second.onStudentRegistered({ success: true, user: { fullName: 'Student 6' } });
  first.studentHandRaised = true; first.updateStudentHandControl();
  assert.equal(labels[0]['side-student-name'], 'Student 5');
  assert.equal(labels[0]['side-hand-label'], 'Lower Hand');
  assert.equal(labels[1]['side-student-name'], 'Student 6');
  assert.equal(labels[1]['side-hand-label'], 'Raise Hand');
});
