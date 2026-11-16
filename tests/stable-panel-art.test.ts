import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StablePanelArt } from '../src/ui/stable-panel-art.ts';

test('hover and selection repaint the same texture; shared drawing canvases do not overwrite other buttons', () => {
  const oldDocument = globalThis.document;
  const makeCanvas = () => {
    const canvas: any = { width: 512, height: 128, frame: '' };
    canvas.getContext = () => ({ clearRect() {}, drawImage(source: any) { canvas.frame = source.frame; } });
    return canvas;
  };
  globalThis.document = { createElement: makeCanvas } as any;
  const art = new StablePanelArt();
  try {
    const scratch = makeCanvas(); scratch.frame = 'normal';
    const first = art.update('answer-0', scratch); const version = first.version;
    scratch.frame = 'hover-color';
    const hover = art.update('answer-0', scratch);
    assert.equal(hover, first); assert.ok(hover.version > version);
    scratch.frame = 'selected-color';
    assert.equal(art.update('answer-0', scratch), first);
    scratch.frame = 'second answer';
    const second = art.update('answer-1', scratch);
    assert.notEqual(first, second);
    assert.equal(first.image.frame, 'selected-color'); assert.equal(second.image.frame, 'second answer');
    let disposed = 0;
    first.addEventListener('dispose', () => disposed++); second.addEventListener('dispose', () => disposed++);
    art.dispose(); assert.equal(disposed, 2);
  } finally { art.dispose(); globalThis.document = oldDocument; }
});
