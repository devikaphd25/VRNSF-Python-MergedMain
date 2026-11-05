import { CanvasTexture, SRGBColorSpace } from 'three';

/** Repaint a persistent texture instead of asynchronously reloading an Image src. */
export class StablePanelArt {
  private readonly entries = new Map<string, { canvas: HTMLCanvasElement; texture: CanvasTexture }>();

  update(id: string, source: HTMLCanvasElement): CanvasTexture {
    let entry = this.entries.get(id);
    if (!entry) {
      const canvas = document.createElement('canvas');
      const texture = new CanvasTexture(canvas);
      texture.colorSpace = SRGBColorSpace;
      entry = { canvas, texture }; this.entries.set(id, entry);
    }
    if (entry.canvas.width !== source.width) entry.canvas.width = source.width;
    if (entry.canvas.height !== source.height) entry.canvas.height = source.height;
    const context = entry.canvas.getContext('2d');
    context?.clearRect(0, 0, source.width, source.height);
    context?.drawImage(source, 0, 0);
    entry.texture.needsUpdate = true;
    return entry.texture;
  }

  dispose(): void {
    for (const { texture } of this.entries.values()) texture.dispose();
    this.entries.clear();
  }
}
