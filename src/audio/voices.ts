/**
 * The instruments the atlas's music is played on, all made in the browser: a plucked string, a bowed one, a
 * flute, a reed, an organ pipe, a singing voice, a bronze bell, a gamelan key and its gong, an mbira tine and
 * a keyboard. None is a copy of a real instrument; each is the family it belongs to, drawn in a few strokes.
 */

export type VoiceName = 'pluck' | 'lute' | 'bow' | 'flute' | 'reed' | 'pipe' | 'voice' | 'bell' | 'stone' | 'metal' | 'tine' | 'keys' | 'gong';

/** Voices that hold a note, and so can slide into it from the one before. */
export const SUSTAINED: ReadonlySet<VoiceName> = new Set(['bow', 'flute', 'reed', 'pipe', 'voice']);

export interface Note {
  hz: number;
  /** When it starts, in context time. */
  time: number;
  /** How long it is held, in seconds (struck and plucked voices ring on by themselves). */
  dur: number;
  /** 0–1. */
  strength: number;
  /** Slide up or down into the note from this pitch. */
  from?: number;
  pan: number;
}

/** Each family's loudness, matched by ear and by measurement so that a change of voice is not a change of level. */
const LEVEL: Record<VoiceName, number> = {
  pluck: 0.8,
  lute: 0.62,
  bow: 0.21,
  flute: 0.14,
  reed: 0.18,
  pipe: 0.18,
  voice: 0.72,
  bell: 0.13,
  stone: 0.2,
  metal: 0.19,
  tine: 0.21,
  keys: 0.2,
  gong: 0.16,
};

/** Partials of the struck voices: [ratio to the fundamental, level, seconds to die away]. */
const PARTIALS: Partial<Record<VoiceName, [number, number, number][]>> = {
  bell: [[0.5, 0.35, 4.5], [1, 1, 3.4], [1.19, 0.5, 2.4], [1.5, 0.3, 1.8], [2, 0.28, 1.4], [2.74, 0.18, 0.9], [3.76, 0.1, 0.5]],
  // A stone chime: a dry, glassy ring that is gone in a moment.
  stone: [[1, 1, 1.1], [2.92, 0.4, 0.45], [5.21, 0.16, 0.18]],
  metal: [[1, 1, 2.4], [2.76, 0.32, 0.8], [5.4, 0.12, 0.35]],
  tine: [[1, 1, 1.7], [4.95, 0.22, 0.3], [8.6, 0.07, 0.1]],
  gong: [[1, 1, 7], [1.47, 0.38, 4.5], [2.09, 0.28, 3.2], [2.56, 0.16, 2.2], [3.24, 0.08, 1.4]],
};

export class Voices {
  private plucks = new Map<number, {buffer: AudioBuffer; rate: number}>();
  private noise: AudioBuffer;

  constructor(
    private ctx: BaseAudioContext,
    private rand: () => number,
  ) {
    const sr = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, sr, sr);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = rand() * 2 - 1;
  }

  /** Sound one note on a voice into `dest`. */
  play(voice: VoiceName, dest: AudioNode, n: Note) {
    const ctx = this.ctx;
    const pan = ctx.createStereoPanner();
    pan.pan.value = n.pan;
    pan.connect(dest);
    const level = LEVEL[voice] * n.strength;
    switch (voice) {
      case 'pluck':
      case 'lute':
        return this.pluck(pan, n, level, voice === 'lute');
      case 'keys':
        return this.keys(pan, n, level);
      case 'bell':
      case 'stone':
      case 'metal':
      case 'tine':
      case 'gong':
        return this.struck(voice, pan, n, level);
      default:
        return this.held(voice, pan, n, level);
    }
  }

  /** A plucked string (Karplus–Strong): a burst of noise going round a delay line, averaged at each pass.
   * Fingered (the qin, the lyre) or, for a lute, struck with a plectrum: brighter, and dying sooner. */
  private pluck(dest: AudioNode, n: Note, level: number, plectrum: boolean) {
    const ctx = this.ctx;
    const key = Math.round(n.hz * 4) * 2 + (plectrum ? 1 : 0);
    let p = this.plucks.get(key);
    if (!p) this.plucks.set(key, (p = pluckBuffer(ctx, n.hz, this.rand, plectrum)));
    const src = ctx.createBufferSource();
    src.buffer = p.buffer;
    src.playbackRate.value = p.rate;
    // A softer note is also a duller one.
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = (plectrum ? 2600 : 1400) + 3200 * n.strength;
    const gain = ctx.createGain();
    gain.gain.value = level;
    src.connect(tone).connect(gain).connect(dest);
    src.start(n.time);
  }

  /** Bowed, blown or sung: an oscillator held for the note's length, shaped by its family's filter. */
  private held(voice: VoiceName, dest: AudioNode, n: Note, level: number) {
    const ctx = this.ctx;
    const t = n.time;
    const attack = {bow: 0.14, flute: 0.07, reed: 0.04, pipe: 0.05, voice: 0.22}[voice as 'bow'] ?? 0.08;
    const release = {bow: 0.35, flute: 0.22, reed: 0.15, pipe: 0.25, voice: 0.45}[voice as 'bow'] ?? 0.3;
    const hold = Math.max(0.05, n.dur - attack);
    const end = t + attack + hold + release * 2.5;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(level, t + attack);
    amp.gain.setTargetAtTime(0, t + attack + hold, release / 3);
    amp.connect(dest);

    const oscillators: OscillatorNode[] = [];
    const tone = (type: OscillatorType, ratio: number, gain: number, into: AudioNode) => {
      const o = ctx.createOscillator();
      o.type = type;
      if (n.from) {
        o.frequency.setValueAtTime(n.from * ratio, t);
        o.frequency.exponentialRampToValueAtTime(n.hz * ratio, t + 0.16);
      } else o.frequency.setValueAtTime(n.hz * ratio, t);
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(g).connect(into);
      oscillators.push(o);
      return o;
    };

    let into: AudioNode = amp;
    if (voice === 'bow') {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1100 + 1900 * n.strength;
      lp.Q.value = 0.8;
      lp.connect(amp);
      into = lp;
      tone('sawtooth', 1, 1, into);
      tone('sawtooth', 1.003, 0.6, into);
    } else if (voice === 'reed') {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = Math.min(4000, n.hz * 3);
      bp.Q.value = 0.9;
      bp.connect(amp);
      into = bp;
      tone('square', 1, 1, into);
      tone('sawtooth', 1, 0.5, into);
    } else if (voice === 'pipe') {
      tone('sine', 1, 0.6, into);
      tone('sine', 2, 0.32, into);
      tone('sine', 3, 0.16, into);
      tone('sine', 4, 0.1, into);
    } else if (voice === 'voice') {
      // An "oo": a buzz through the first two resonances of the mouth.
      const mix = ctx.createGain();
      for (const [f, q, g] of [[380, 7, 1], [820, 9, 0.45], [2500, 10, 0.08]] as const) {
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = f;
        bp.Q.value = q;
        const gg = ctx.createGain();
        gg.gain.value = g;
        mix.connect(bp).connect(gg).connect(amp);
      }
      into = mix;
      tone('sawtooth', 1, 1, into);
    } else {
      // Flute: a near-pure tone and the breath across the mouthpiece.
      tone('sine', 1, 1, into);
      tone('sine', 2, 0.1, into);
      const breath = ctx.createBufferSource();
      breath.buffer = this.noise;
      breath.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = Math.min(6000, n.hz * 2.2);
      bp.Q.value = 1.4;
      const bg = ctx.createGain();
      bg.gain.setValueAtTime(0.16, t);
      bg.gain.setTargetAtTime(0.05, t + 0.06, 0.08);
      breath.connect(bp).connect(bg).connect(amp);
      breath.start(t, this.rand() * 0.5);
      breath.stop(end);
    }
    // Vibrato, after the note has settled; none on the organ.
    if (voice !== 'pipe') {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = voice === 'voice' ? 5.2 : 5.6;
      const depth = ctx.createGain();
      depth.gain.setValueAtTime(0, t);
      depth.gain.linearRampToValueAtTime(n.hz * (voice === 'flute' ? 0.003 : 0.0055), t + Math.min(0.7, attack + 0.4));
      lfo.connect(depth);
      for (const o of oscillators) depth.connect(o.frequency);
      lfo.start(t);
      lfo.stop(end);
    }
    for (const o of oscillators) {
      o.start(t);
      o.stop(end);
    }
  }

  /** Bells, bronze keys, iron tines and the gong: a few partials, each dying at its own rate. */
  private struck(voice: VoiceName, dest: AudioNode, n: Note, level: number) {
    const ctx = this.ctx;
    const t = n.time;
    // Low notes ring longer than high ones.
    const ring = Math.min(1.6, Math.max(0.6, (330 / n.hz) ** 0.35));
    const parts = PARTIALS[voice]!;
    const out = ctx.createGain();
    out.gain.value = level;
    out.connect(dest);
    const strike = (hz: number, gain: number, decay: number) => {
      const o = ctx.createOscillator();
      o.frequency.value = hz;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + (voice === 'gong' ? 0.03 : 0.004));
      g.gain.setTargetAtTime(0, t + 0.01, (decay * ring) / 4);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + decay * ring + 0.1);
    };
    for (const [ratio, gain, decay] of parts) strike(n.hz * ratio, gain, decay);
    // A gamelan key is tuned against its pair a few beats apart, so the two shimmer together.
    if (voice === 'metal' || voice === 'gong') strike(n.hz + (voice === 'gong' ? 1.2 : 2.6), 0.5, parts[0][2]);
    // The strike itself: a click for the tine and the key, a soft thud for the gong.
    const click = ctx.createBufferSource();
    click.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = voice === 'gong' ? 180 : Math.min(7000, n.hz * 5);
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(voice === 'tine' ? 0.25 : 0.12, t);
    cg.gain.setTargetAtTime(0, t, 0.012);
    click.connect(bp).connect(cg).connect(out);
    click.start(t, this.rand() * 0.5, 0.1);
  }

  /** A keyboard's hammered string: harmonics, slightly stretched, the higher ones dying first; damped on release. */
  private keys(dest: AudioNode, n: Note, level: number) {
    const ctx = this.ctx;
    const t = n.time;
    const out = ctx.createGain();
    out.gain.setValueAtTime(level, t);
    out.gain.setTargetAtTime(0, t + Math.max(0.25, n.dur), 0.12);
    out.connect(dest);
    const ring = Math.min(5, 2.6 * (330 / n.hz) ** 0.4);
    for (let k = 1; k <= 6; k++) {
      const o = ctx.createOscillator();
      o.frequency.value = n.hz * k * (1 + 0.0004 * k * k);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(1 / k ** 1.3, t + 0.004);
      g.gain.setTargetAtTime(0, t + 0.004, ring / (2 + k));
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + Math.max(0.25, n.dur) + 1);
    }
  }
}

function pluckBuffer(ctx: BaseAudioContext, hz: number, rand: () => number, plectrum: boolean) {
  const sr = ctx.sampleRate;
  const n = Math.max(2, Math.floor(sr / hz));
  // Low strings ring longer than high ones, as on a lute.
  const seconds = Math.max(2.2, Math.min(5, 330 / hz + 1.6)) * (plectrum ? 0.6 : 1);
  const length = Math.floor(sr * seconds);
  const buffer = ctx.createBuffer(1, length, sr);
  const out = buffer.getChannelData(0);
  const ring = new Float32Array(n);
  // Softened noise: a fingertip rather than a plectrum.
  let lp = 0;
  let mean = 0;
  for (let i = 0; i < n; i++) {
    lp += (plectrum ? 0.9 : 0.45) * (rand() * 2 - 1 - lp);
    ring[i] = lp;
    mean += lp / n;
  }
  let peak = 1e-6;
  for (let i = 0; i < n; i++) {
    ring[i] -= mean;
    peak = Math.max(peak, Math.abs(ring[i]));
  }
  for (let i = 0; i < n; i++) ring[i] /= peak;
  // The loss per pass that brings the string to silence by the end of the buffer.
  const loss = 0.001 ** (1 / (hz * seconds));
  let at = 0;
  const tail = Math.floor(sr * 0.08);
  for (let i = 0; i < length; i++) {
    const a = ring[at];
    const next = at + 1 === n ? 0 : at + 1;
    out[i] = i > length - tail ? (a * (length - i)) / tail : a;
    ring[at] = loss * 0.5 * (a + ring[next]);
    at = next;
  }
  // The delay line is a whole number of samples; the playback rate makes up the difference, so it is in tune.
  return {buffer, rate: (hz * (n + 0.5)) / sr};
}
