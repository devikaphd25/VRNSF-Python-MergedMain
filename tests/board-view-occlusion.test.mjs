import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { Group, Vector3 } from 'three';

function client() {
  const source = ts.createSourceFile('markers.ts', readFileSync('src/classroom/seat-markers.ts', 'utf8'), ts.ScriptTarget.Latest, true);
  const code = source.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getFullText(source)).join('\n');
  const context = vm.createContext({ exports: {}, window: { isInstructor: false }, socket: { id: 'self' },
    Image: class {}, Vector3, console: { log() {} } });
  vm.runInContext(ts.transpileModule(code + '\nexport { markers as fixtureMarkers };', { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
  const api = context.exports;
  const marker = (id, seat) => { const object = new Group(); object.userData.studentId = id; object.userData.seatName = seat; api.fixtureMarkers.set(id, object); return object; };
  return { api, target: marker('occupant', 'Seat_R1_03'), other: marker('other', 'Seat_R1_04'), ownHands: new Group() };
}

test('the viewing-seat occupant stays hidden across every visibility refresh, only on the viewing client', () => {
  const viewer = client(), classmate = client();
  viewer.api.setLocalBoardViewSeat('Seat_R1_03');
  for (const refresh of [() => viewer.api.updateMarkerVisibility(undefined), () => viewer.api.showAllMarkers(),
    () => viewer.api.setSeatMarkersForcedVisible(true), () => viewer.api.setSeatMarkersSuppressed(false)]) {
    refresh(); assert.equal(viewer.target.visible, false); assert.equal(viewer.other.visible, true);
    assert.equal(viewer.ownHands.visible, true, 'first-person arms are not a seated marker and must stay visible');
  }
  classmate.api.updateMarkerVisibility(undefined);
  assert.equal(classmate.target.visible, true, 'another client still sees the occupied seat');
  // An avatar joining/loading during SCREEN must also respect the local hidden seat.
  const late = new Group(); late.userData.seatName = 'Seat_R1_03'; viewer.api.fixtureMarkers.set('late', late);
  viewer.api.showAllMarkers(); assert.equal(late.visible, false);
  viewer.api.setLocalBoardViewSeat(null);
  assert.equal(viewer.target.visible, true); assert.equal(late.visible, true);
});

test('RETURN honors existing global suppression instead of exposing hidden class avatars', () => {
  const viewer = client(); viewer.api.setLocalBoardViewSeat('Seat_R1_03');
  viewer.api.setSeatMarkersSuppressed(true); viewer.api.setLocalBoardViewSeat(null);
  assert.equal(viewer.target.visible, false);
  viewer.api.setSeatMarkersSuppressed(false); assert.equal(viewer.target.visible, true);
});
