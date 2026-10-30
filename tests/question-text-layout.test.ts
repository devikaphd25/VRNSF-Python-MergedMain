import test from 'node:test';
import assert from 'node:assert/strict';
import { paintSerifBlock } from '../src/ui/serif-type';

test('Challenge 1 questions and longer prompts fit inside their image with padding', () => {
  // Representative text fixtures; live questions are supplied by Supabase.
  const prompts = ['RAM keeps its contents when the power is off.',
    'The CPU is the fastest component in the system.',
    'A program runs directly from the hard drive.',
    'An SSD is an example of secondary storage.',
    "'Loading...' means copying storage -> RAM.",
    'The CPU is the fastest component in the system. Explain how it works with RAM and secondary storage to execute program instructions.'];
  for (const text of prompts) {
    const drawn: { text: string; y: number; size: number; width: number }[] = [];
    const ctx = {
      font: '', fillStyle: '', textAlign: '', textBaseline: '',
      clearRect() {},
      measureText(value: string) { return { width: value.length * this.size() * 0.6 }; },
      size() { return Number(this.font.match(/([\d.]+)px/)?.[1]); },
      fillText(value: string, _x: number, y: number) {
        drawn.push({ text: value, y, size: this.size(), width: this.measureText(value).width });
      },
    };
    const canvas = { width: 960, height: 240, getContext: () => ctx, toDataURL: () => 'image' } as unknown as HTMLCanvasElement;
    paintSerifBlock({ canvas, text, color: '#fff', fontSize: 58 });
    assert.equal(drawn.map(line => line.text).join(' '), text);
    for (const line of drawn) {
      assert.ok(line.width <= 912);
      assert.ok(line.y - line.size * 0.64 >= 16);
      assert.ok(line.y + line.size * 0.64 <= 224);
    }
  }
});
