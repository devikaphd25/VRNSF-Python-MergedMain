import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classroomStudentName } from '../shared/classroom-student-name';

test('headsets with the same saved Student 3 name get distinct numbers in one session', () => {
  const participants = [{ id: 150 }, { id: 152 }, { id: 151 }];
  assert.equal(classroomStudentName('Student 3', 150, participants), 'Student 1');
  assert.equal(classroomStudentName('Student 3', 151, participants), 'Student 2');
  assert.equal(classroomStudentName('Student3', 152, participants), 'Student 3');
});

test('reconnects, later joins and gaps in participant IDs do not change assigned names', () => {
  const first = [{ id: 110 }, { id: 121 }];
  const expanded = [{ id: 140 }, ...first, { id: 121 }];
  assert.equal(classroomStudentName('Student 9', 121, first), 'Student 2');
  assert.equal(classroomStudentName('Student 2', 121, expanded), 'Student 2');
  assert.equal(classroomStudentName('Student', 140, expanded), 'Student 3');
  assert.equal(classroomStudentName('Student 3', 500, [{ id: 500 }]), 'Student 1');
});

test('custom student names are preserved and missing generic participants are rejected', () => {
  assert.equal(classroomStudentName('Jordan Smith', 8, [{ id: 8 }]), 'Jordan Smith');
  assert.throws(() => classroomStudentName('Student 3', 9, [{ id: 8 }]));
});
