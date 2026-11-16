import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { parse, interpret } from '@pmndrs/uikitml';
import { Text } from '@pmndrs/uikit';
import { Group } from 'three';
import { setMaxListeners } from 'node:events';

setMaxListeners(0);

test('the right-board name has a real text child that updates when the database name arrives', () => {
  const parsed = parse(readFileSync('ui/student-side-controls.uikitml', 'utf8'));
  const root = interpret(parsed);
  // Keep font-atlas I/O out of this Node test while exercising the real text binding.
  root.setProperties({ fontFamilies: { inter: { normal: () => new Promise(() => {}) } } });
  new Group().add(root);
  let name;
  root.traverse(element => { if (element.userData.id === 'side-student-name') name = element; });
  assert.ok(name, 'The right board must contain a name label');
  const glyph = name.children.find(child => child instanceof Text);
  assert.ok(glyph, 'An empty Text tag creates no glyph child, so setProperties alone cannot show the name');
  name.setProperties({ text: 'Student 5' });
  assert.equal(glyph.properties.value.text, 'Student 5');
  const controlRow = parsed.element.children.find(element =>
    element.children?.some(child => child.properties?.id === 'side-student-name'));
  assert.ok(controlRow, 'Name and Raise Hand must share their compact control row');
  const children = controlRow.children;
  assert.ok(children.some(element => element.properties?.id === 'side-raise-hand'));
  assert.ok(children.findIndex(element => element.properties?.id === 'side-student-name') >
    children.findIndex(element => element.properties?.id === 'side-hand-label'));
  root.dispose();
});

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
