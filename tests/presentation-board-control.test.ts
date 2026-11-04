import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as THREE from 'three';
import { canUsePresentationBoardView } from '../src/student/presentation-board-control.ts';
import { setPanelRayInteraction } from '../src/ui/panel-ray-interaction.ts';

test('SCREEN is available only to students in a presentation, outside transitions and activities', () => {
  assert.equal(canUsePresentationBoardView({}), false);
  assert.equal(canUsePresentationBoardView({ isPresentationOpen: true }), true);
  for (const flag of ['isInstructor', 'isPresentationTransitionInProgress', 'isLabActive', 'isPuzzleActive', 'isCastleActive', 'isDisplayRoomOpen', 'isQuickChallengeOpen', 'isCodePatternChallengeOpen', 'isChallenge2Open']) {
    assert.equal(canUsePresentationBoardView({ isPresentationOpen: true, [flag]: true }), false, flag);
  }
});

function controls() {
  // Exercise production event actions without initializing the browser-only XR SDK.
  const source = ts.createSourceFile('results.ts', readFileSync('src/systems/student-results.system.ts', 'utf8'), ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find(ts.isClassDeclaration)!;
  const names = ['lastBoardViewActivation', 'boardViewActive', 'boardButtonRequested', 'boardButtonApplied', 'resultWasVisible', 'savedPlayerPosition', 'savedPlayerQuaternion', 'activateBoardView', 'restoreSavedPlayerPose', 'setBoardViewLabel', 'setBoardViewButtonVisible', 'syncBoardButton', 'closeForRoomTransition'];
  const members = declaration.members.filter(member => names.includes(member.name?.getText(source) ?? '')).map(member => member.getText(source)).join('\n');
  const scene = new THREE.Scene(), player = new THREE.Group();
  player.position.set(3, 1.6, 6); player.rotation.y = 0.5; scene.add(player);
  const seat = new THREE.Group(); seat.name = 'Seat_R1_03'; seat.position.set(0, 1, -2); scene.add(seat);
  const board = new THREE.Group(); board.name = 'ProjectorScreen'; board.position.set(0, 2, -8); scene.add(board);
  const button = new THREE.Group(), icon = new THREE.Object3D(); icon.pointerEvents = 'none'; button.add(icon);
  const state: any = { player, isStudentBoardViewAvailable: false, studentBoardViewButtonEntity: { object3D: button, removeComponent() {}, addComponent() {} } };
  let now = 1000, label = '';
  const context = vm.createContext({ THREE, window: state, performance: { now: () => now }, canUsePresentationBoardView, setPanelRayInteraction, RayInteractable: Symbol('RayInteractable'), requestAnimationFrame() {} });
  vm.runInContext(ts.transpile(`class Controls { ${members} }; globalThis.Controls = Controls;`, { target: ts.ScriptTarget.ES2022 }), context);
  const control = new context.Controls();
  Object.assign(control, { world: { scene }, setVisible: (visible: boolean) => state.isStudentResultOpen = visible,
    boardViewDocument: { getElementById: () => ({ setProperties: (value: any) => label = value.text }), requestUpdate() {} },
  });
  return { control, state, player, button, icon, seat, label: () => label, tick: () => now += 400 };
}

test('presentation shortcut centers the student, RETURN restores the pose, and leaving resets the toggle', () => {
  const f = controls();
  const originalPosition = f.player.position.clone(), originalQuaternion = f.player.quaternion.clone();
  f.control.syncBoardButton();
  assert.equal(f.button.visible, false); assert.equal(f.button.intersectChildren, false);
  f.state.isPresentationOpen = true;
  f.control.closeForRoomTransition();
  assert.equal(f.button.visible, true); assert.equal(f.state.isStudentBoardViewAvailable, true);
  assert.equal(f.icon.pointerEvents, 'none', 'the white icon stays decorative so the surrounding button receives the ray');
  f.control.activateBoardView();
  assert.deepEqual(f.player.position.toArray(), f.seat.position.toArray()); assert.equal(f.label(), 'RETURN');
  f.tick(); f.control.activateBoardView();
  assert.deepEqual(f.player.position.toArray(), originalPosition.toArray()); assert.deepEqual(f.player.quaternion.toArray(), originalQuaternion.toArray()); assert.equal(f.label(), 'SCREEN');
  f.tick(); f.control.activateBoardView();
  f.control.closeForRoomTransition();
  f.state.isPresentationOpen = false; f.control.syncBoardButton();
  assert.equal(f.button.visible, false); assert.equal(f.state.isStudentBoardViewAvailable, false);
  assert.equal(f.control.boardViewActive, false); assert.equal(f.label(), 'SCREEN');
  assert.deepEqual(f.player.position.toArray(), originalPosition.toArray());
  f.state.isPresentationOpen = true; f.control.syncBoardButton();
  assert.equal(f.button.visible, true);
});

test('a stale left-trigger event cannot move students outside presentation mode or during a challenge', () => {
  const f = controls(), original = f.player.position.clone();
  f.state.isStudentBoardViewAvailable = true;
  f.control.activateBoardView(); assert.deepEqual(f.player.position.toArray(), original.toArray());
  f.state.isPresentationOpen = true; f.state.isCodePatternChallengeOpen = true;
  f.control.syncBoardButton(); f.tick(); f.control.activateBoardView();
  assert.equal(f.button.visible, false); assert.deepEqual(f.player.position.toArray(), original.toArray());
});
