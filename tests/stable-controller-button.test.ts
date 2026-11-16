import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StableControllerButton } from '../src/ui/stable-controller-button';

test('brief ray misses keep the highlight and do not replay the enter sound', () => {
  const button = new StableControllerButton();
  assert.equal(button.update('answer-0', false, 0).entered, true);
  for (let time = 10; time < 1000; time += 20) {
    const miss = button.update('', false, time);
    assert.equal(miss.hovered, 'answer-0');
    assert.equal(miss.activate, false);
    assert.equal(button.update('answer-0', false, time + 10).entered, false);
  }
  assert.equal(button.update('', false, 1200).hovered, '');
});

test('one held trigger cannot repeatedly activate or click another question after navigation', () => {
  const button = new StableControllerButton();
  // A menu trigger held when the quiz opens must be released first.
  assert.equal(button.update('next', true, 0).activate, false);
  button.update('next', false, 10);
  assert.equal(button.update('next', true, 20).activate, true);
  for (let time = 30; time < 1000; time += 10)
    assert.equal(button.update('answer-1', true, time).activate, false);
  button.update('answer-1', false, 1000);
  assert.equal(button.update('answer-1', true, 1010).activate, true);
});

test('pressing during a miss never activates the stale highlighted button', () => {
  const button = new StableControllerButton();
  button.update('answer-0', false, 0);
  assert.equal(button.update('', true, 50).activate, false);
  assert.equal(button.update('answer-0', true, 60).activate, false);
});
