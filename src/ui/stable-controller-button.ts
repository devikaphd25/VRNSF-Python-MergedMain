/** Tolerate short ray misses without flashing the highlight or replaying hover audio.
 * A trigger must be released before it can activate another button. */
export class StableControllerButton {
  hovered = '';
  private lastHitAt = -Infinity;
  private pressed = true;

  update(target: string, trigger: boolean, now: number): { hovered: string; activate: boolean; entered: boolean } {
    const previous = this.hovered;
    if (target) {
      this.hovered = target;
      this.lastHitAt = now;
    } else if (now - this.lastHitAt > 160) {
      this.hovered = '';
    }
    const activate = Boolean(target) && trigger && !this.pressed;
    this.pressed = trigger;
    return { hovered: this.hovered, activate, entered: Boolean(this.hovered) && previous !== this.hovered };
  }

  reset(): void {
    this.hovered = '';
    this.lastHitAt = -Infinity;
    this.pressed = true;
  }
}
