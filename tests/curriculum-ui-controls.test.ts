import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as types from '../shared/challenge-types.ts';

function controls(type: string) {
  const source = ts.createSourceFile('curriculum.ts', readFileSync('src/systems/curriculum-challenge.system.ts', 'utf8'), ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find(ts.isClassDeclaration)!;
  const names = ['usesHighlightedMcButton', 'usesTiltedCodeBoard', 'updateSubmitButton', 'paintChoiceFace'];
  const methods = declaration.members.filter(member => names.includes(member.name?.getText(source) ?? '')).map(member => member.getText(source)).join('\n');
  const elements = new Map<string, Set<string>>();
  const get = (id: string) => { if (!elements.has(id)) elements.set(id, new Set()); return elements.get(id)!; };
  const context = vm.createContext({ ...types, C1: { submit: 'submit', mc: 'choice', mcHighlight: 'selected', dark: 'dark', light: 'light' } });
  vm.runInContext(ts.transpile(`class Controls { ${methods} }; globalThis.Controls = Controls;`, { target: ts.ScriptTarget.ES2022 }), context);
  const control = new context.Controls(), painted: any[] = [];
  let answered = false;
  Object.assign(control, { challenge: { challengeType: type }, submitted: false, hoveredControlId: '',
    document: { getElementById: get }, isFivePartsChallenge: () => true,
    allQuestionsAnswered: () => answered,
    addClass: (element: Set<string>, ...names: string[]) => names.forEach(name => element.add(name)),
    removeClass: (element: Set<string>, ...names: string[]) => names.forEach(name => element.delete(name)),
    paintControlIcon() {}, paintHudFace: (...args: any[]) => painted.push(args),
    questions: [{ options: ['Live database option A', 'Live database option B', 'Live database option C'] }], questionIndex: 0,
    usesTrueFalseArt: () => false,
    selectedChoiceValue: () => 1, isChoiceSelected: (index: number, value: number) => index === value,
  });
  return { control, get, painted, answerAll: () => answered = true };
}

test('Day 1 Submit appears after all answers and hides again on submission', () => {
  for (const type of [types.CODE_PATTERN_CHALLENGE_TYPE, types.LOOP_SORT_CHALLENGE_TYPE, types.FLOWCHART_SHAPE_CHALLENGE_TYPE]) {
    const f = controls(type);
    f.control.updateSubmitButton(); assert.ok(f.get('quiz-submit').has('answer-hidden'));
    f.answerAll(); f.control.updateSubmitButton(); assert.equal(f.get('quiz-submit').has('answer-hidden'), false);
    f.control.submitted = true; f.control.updateSubmitButton(); assert.ok(f.get('quiz-submit').has('answer-hidden'));
  }
});

test('selection and hover artwork retain database-provided option text', () => {
  const f = controls(types.LOOP_SORT_CHALLENGE_TYPE);
  f.control.hoveredControlId = 'quiz-answer-1';
  f.control.paintChoiceFace(1);
  assert.equal(f.painted.length, 1);
  assert.equal(f.painted[0][1], 'selected');
  assert.match(f.painted[0][2], /Live database option B/);
  assert.equal(f.painted[0][4], 500);
  assert.equal(f.painted[0][5], true);
});
