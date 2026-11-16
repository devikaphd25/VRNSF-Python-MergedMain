/** Session-local sequence: resume at the first task without a green completion dot. */
export class ActivitySequence {
  index = 0;
  private launchedKey: string | null = null;

  get awaitingReturn(): boolean { return this.launchedKey !== null; }

  move(direction: -1 | 1, count: number): void {
    if (!count || (direction === 1 && this.index >= count - 1)) return;
    this.index = Math.max(0, Math.min(count - 1, this.index + direction));
    this.launchedKey = null;
  }

  launched(key: string, advanceSequence = true): void {
    this.launchedKey = advanceSequence ? key : null;
  }

  resume(keys: string[], completedKeys: ReadonlySet<string>): void {
    const firstUnfinished = keys.findIndex(key => !completedKeys.has(key));
    this.index = firstUnfinished < 0 ? keys.length : firstUnfinished;
    this.launchedKey = null;
  }

  returned(keys: string[], completedKeys: ReadonlySet<string>): void {
    if (this.launchedKey === null) return;
    this.resume(keys, completedKeys);
  }
}
