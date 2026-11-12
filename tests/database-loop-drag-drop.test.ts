import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { Box3, Vector3 } from 'three';
import { databaseDragDropLesson } from '../server/services/database-drag-drop-lesson';

function rows() {
  return [1, 2].map(part => ({ id: part, question_type: 'drag_drop', options: { format: 'loop_parts',
    item: { id: `db-item-${part}`, name: `Database card ${part}`, part, instructor_label: 'Instructor-only grading label', code_lines: part === 1 ? ['database code'] : undefined, display_text: part === 2 ? '42' : undefined },
    round: { part, prompt: `Database prompt ${part}`, instructions: `Database instructions ${part}`, code_lines: part === 2 ? ['database countdown'] : undefined,
      boxes: [{category:part===1?'comparison':'finalN',label:`Database destination ${part}`}] } }, correct_answer: { category: part===1?'comparison':'finalN' } }));
}

test('loop cards, instructions, destination labels and code come from database rows without student answer keys', () => {
  const fixture = rows();
  const lesson = databaseDragDropLesson(fixture);
  assert.equal(lesson.format, 'loop_parts');
  assert.equal(lesson.items[0].name, 'Database card 1');
  assert.equal(lesson.rounds[0].prompt, 'Database prompt 1');
  assert.equal(lesson.rounds[1].boxes[0].label, 'Database destination 2');
  assert.deepEqual(lesson.rounds[1].codeLines, ['database countdown']);
  for (const item of lesson.items) { assert.equal((item as any).category, undefined); assert.equal((item as any).correct_answer, undefined); assert.equal((item as any).instructorLabel, undefined); }
  fixture[0].options.round.prompt = 'Edited in database';
  assert.equal(databaseDragDropLesson(fixture).rounds[0].prompt, 'Edited in database');
  assert.throws(() => databaseDragDropLesson([]));
  assert.throws(() => databaseDragDropLesson([{...fixture[0],correct_answer:{category:'input'}},fixture[1]]));
});

test('archived questions do not enter a replacement lesson and hardware lessons retain their existing format', () => {
  const archived = { id: 99, options: { archived: true } };
  assert.equal(databaseDragDropLesson([archived,...rows()]).questions.length, 2);
  const hardware = databaseDragDropLesson([{id:1,question_type:'drag_drop',options:{item:{id:'test-device',name:'Fixture device'}},correct_answer:{category:'output'}}]);
  assert.equal(hardware.format, 'devices');
  assert.equal(hardware.items[0].category, 'output');
});

test('the actual loop UI waits for the server grade and keeps wrong or unsaved drops retryable', () => {
  const source = ts.createSourceFile('loop.ts', readFileSync('src/systems/loop-drag-drop.system.ts','utf8'), ts.ScriptTarget.Latest,true);
  const declaration = source.statements.find(ts.isClassDeclaration)!;
  const method = declaration.members.find(member => member.name?.getText(source)==='handleRelease')!.getText(source);
  let acknowledge: any;
  const context = vm.createContext({ LoopDragItemComponent:{}, DROP_SNAP_DISTANCE:0.16,
    socket:{timeout:()=>({emit:(_name:string,_payload:any,callback:any)=>{acknowledge=callback;}})} });
  vm.runInContext(ts.transpile(`class Loop { ${method} }; globalThis.Loop=Loop`,{target:ts.ScriptTarget.ES2022}),context);
  const ui = new (context as any).Loop();
  const item = { id:'db-item',name:'Database card' };
  const device = {object3D:{getWorldPosition:(point:Vector3)=>point.set(0,0,0)},getValue:()=>0};
  const box = {category:'comparison'};
  Object.assign(ui,{active:true,advancing:false,activeDevices:[device],boxes:[box],worldPoint:new Vector3(),items:[item],challengeId:'run-1',completedItemIds:new Set(),
    getBoxWorldBounds:()=>new Box3(new Vector3(-1,-1,-1),new Vector3(1,1,1)),updateStatus:()=>{},partPrompt:()=>'',resetDevicePosition:()=>{ui.resets=(ui.resets??0)+1;},
    snapDeviceIntoBox:()=>{ui.snaps=(ui.snaps??0)+1;},acceptCorrectDrop:()=>{ui.accepted=(ui.accepted??0)+1;}});
  ui.handleRelease(device); assert.equal(ui.snaps,undefined); assert.equal(ui.accepted,undefined);
  acknowledge(null,{success:true,correct:false}); assert.equal(ui.resets,1); assert.equal(ui.accepted,undefined);
  ui.handleRelease(device); acknowledge(new Error('network timeout')); assert.equal(ui.resets,2); assert.equal(ui.completedItemIds.size,0);
  ui.handleRelease(device); acknowledge(null,{success:true,correct:true}); assert.equal(ui.snaps,1); assert.equal(ui.accepted,1); assert.ok(ui.completedItemIds.has(item.id));
  ui.advancing=false;ui.handleRelease(device);ui.challengeId='new-run';acknowledge(null,{success:true,correct:true});assert.equal(ui.accepted,1,'A stale reply must not change another run');
});
