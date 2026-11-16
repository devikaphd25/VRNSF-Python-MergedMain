/** Synthesized Challenge 1 effects; no downloads or audio files required. */
export class TrueFalseSounds {
  private context?: AudioContext;
  private output?: GainNode;
  private sources = new Set<AudioScheduledSourceNode>();
  private generation = 0;
  private lastHover = 0;

  private play(effect: (context: AudioContext, output: GainNode) => void): void {
    try {
      this.context ??= new AudioContext();
      const context = this.context;
      if (!this.output) {
        this.output = context.createGain();
        this.output.gain.value = 0.4;
        const limiter = context.createDynamicsCompressor();
        this.output.connect(limiter);
        limiter.connect(context.destination);
      }
      const output = this.output;
      const generation = this.generation;
      if (context.state === "running") effect(context, output);
      else void context.resume().then(() => {
        if (generation === this.generation && context.state === "running") effect(context, output);
      }).catch(() => {});
    } catch { /* Audio must never interrupt the challenge. */ }
  }

  private track(source: AudioScheduledSourceNode, cleanup: () => void): void {
    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      source.disconnect();
      cleanup();
    };
  }

  private tone(context: AudioContext, output: GainNode, from: number, to: number,
    duration: number, volume: number, type: OscillatorType = "sine", delay = 0): void {
    const start = context.currentTime + delay;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(from, start);
    oscillator.frequency.exponentialRampToValueAtTime(to, start + duration);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(volume, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain).connect(output);
    this.track(oscillator, () => gain.disconnect());
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  hover(): void {
    // Hover cannot unlock audio: never queue it until a later click.
    if (this.context?.state !== "running" || performance.now() - this.lastHover < 100) return;
    this.lastHover = performance.now();
    this.play((context, output) => this.tone(context, output, 1050, 1350, 0.07, 0.045));
  }

  unlock = (): void => {
    // Enter XR / mouse gestures enable hover audio before the first quiz answer.
    this.play(() => {});
  };

  click(): void {
    this.play((context, output) => this.tone(context, output, 680, 390, 0.12, 0.14, "triangle"));
  }

  launch(): void {
    this.stop();
    this.play((context, output) => {
      // Low ignition impact followed by a rising engine, matching the 5.5s flight.
      this.tone(context, output, 150, 38, 0.8, 0.65, "triangle");
      this.tone(context, output, 75, 320, 5.2, 0.22, "sawtooth", 0.15);
      const duration = 5.5;
      const noise = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
      const samples = noise.getChannelData(0);
      for (let index = 0; index < samples.length; index++) samples[index] = Math.random() * 2 - 1;
      const source = context.createBufferSource();
      source.buffer = noise;
      const filter = context.createBiquadFilter();
      filter.type = "lowpass";
      const start = context.currentTime;
      filter.frequency.setValueAtTime(350, start);
      filter.frequency.exponentialRampToValueAtTime(2600, start + 2.5);
      filter.frequency.exponentialRampToValueAtTime(700, start + duration);
      const gain = context.createGain();
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.8, start + 0.08);
      gain.gain.linearRampToValueAtTime(0.5, start + 1.5);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      source.connect(filter).connect(gain).connect(output);
      this.track(source, () => { filter.disconnect(); gain.disconnect(); });
      source.start(start);
      source.stop(start + duration);
    });
  }

  stop(): void {
    this.generation += 1;
    for (const source of this.sources) {
      try { source.stop(); } catch { /* Already ended. */ }
      source.disconnect();
    }
    this.sources.clear();
  }

  dispose(): void {
    this.stop();
    void this.context?.close().catch(() => {});
  }
}
