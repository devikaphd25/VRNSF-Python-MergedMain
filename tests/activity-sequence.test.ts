import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ActivitySequence } from '../src/instructor/activity-sequence.ts';

const activities = Array.from({ length: 12 }, (_, i) => `activity:${i + 1}`);

test('videos 1, 2, then 11 from All Tasks resume at video 3', () => {
  const sequence = new ActivitySequence();
  const completed = new Set<string>();
  for (const index of [0, 1, 10]) {
    sequence.launched(activities[index], false);
    completed.add(activities[index]);
    sequence.returned(activities, completed);
  }
  sequence.resume(activities, completed);
  assert.equal(sequence.index, 2);
  assert.equal(completed.has(activities[10]), true);
});

test('a later green dot cannot skip an unfinished activity at the beginning', () => {
  const sequence = new ActivitySequence();
  sequence.resume(activities, new Set([activities[10]]));
  assert.equal(sequence.index, 0);
});

test('returning from a current task resumes at the earliest unfinished task once', () => {
  const sequence = new ActivitySequence();
  const completed = new Set([activities[0]]);
  sequence.launched(activities[0]);
  assert.equal(sequence.index, 0);
  sequence.returned(activities, completed);
  assert.equal(sequence.index, 1);
  sequence.move(1, activities.length);
  sequence.returned(activities, completed);
  assert.equal(sequence.index, 2, 'repeated returns must preserve manual navigation');
});

test('resuming skips a later green task once the preceding gap is completed', () => {
  const sequence = new ActivitySequence();
  const completed = new Set(activities.slice(0, 10));
  completed.add(activities[10]);
  sequence.resume(activities, completed);
  assert.equal(sequence.index, 11);
});

test('running a manually selected later task does not skip earlier unfinished work', () => {
  const sequence = new ActivitySequence();
  sequence.move(1, activities.length);
  sequence.launched(activities[1]);
  sequence.returned(activities, new Set([activities[1]]));
  assert.equal(sequence.index, 0);
});

test('all green dots finish the sequence; an empty list also has no current task', () => {
  const sequence = new ActivitySequence();
  sequence.resume(activities, new Set(activities));
  assert.equal(sequence.index, activities.length);
  sequence.resume([], new Set());
  assert.equal(sequence.index, 0);
});

test('completion keys belonging to removed or other activities do not affect the sequence', () => {
  const sequence = new ActivitySequence();
  sequence.launched('removed:1');
  sequence.returned(activities, new Set(['removed:1', 'other-day:1']));
  assert.equal(sequence.index, 0);
});

test('previous and next still browse activities without marking them green', () => {
  const sequence = new ActivitySequence();
  const completed = new Set<string>();
  sequence.move(-1, activities.length);
  assert.equal(sequence.index, 0);
  sequence.move(1, activities.length);
  assert.equal(sequence.index, 1);
  for (let i = 0; i < 20; i++) sequence.move(1, activities.length);
  assert.equal(sequence.index, activities.length - 1);
  sequence.resume(activities, completed);
  assert.equal(sequence.index, 0);
  assert.equal(completed.size, 0);
});
