/**
 * The atlas's music: made in the browser, not recorded. Each musical tradition (data/soundscapes.json) is a
 * way of playing (a scale, the voices that play it, a manner) and the score moves between them as the
 * viewpoint, the year or a traveller's whereabouts change: the outgoing player finishes its phrase while the
 * incoming one fades in over a shared drone, so the music turns over rather than cuts.
 *
 * Within a tradition the music is as large as the known world: where a viewpoint knows little it keeps to a
 * few notes in a narrow register, and its range and density open as the fog recedes. While time runs the
 * notes move; while it stands still they thin to a note now and then.
 */

import {createComposer, type Member, type Tune} from './composer';
import {Samples} from './samples';
import {SUSTAINED, type VoiceName, Voices} from './voices';

/** How a tradition plays, as the engine needs it (see `Tradition` in ./choose for the authored form). */
export interface Style {
  id: string;
  /** Cents above the tonic, within the octave. */
  scale: number[];
  /** `wander`: a line in short phrases. `alap`: slow and unmetred, dwelling on the tonic and fifth.
   * `ostinato`: short cycles repeated, a note changing now and then. */
  pattern: 'wander' | 'alap' | 'ostinato';
  /** Seconds per beat. */
  beat: number;
  /** How often the line leaps instead of stepping, 0–1. */
  leaps: number;
  /** How often a note is ornamented with a grace note, 0–1. */
  ornament: number;
  /** Held notes slide into the next. */
  glide: boolean;
  /** The drone's level, 0–1. */
  drone: number;
  /** A tanpura's cycle of plucked drone notes. */
  tanpura: boolean;
  /** A gong closes each cycle. */
  gong: boolean;
}

/** What the music follows, read each time it plans ahead. */
export interface Hearing {
  /** How much of the world the viewpoint knows, 0–1. */
  known: number;
  /** Time is running: the timeline is playing or a journey is under way. */
  moving: boolean;
  style: Style;
  /** The voices that may play now (an instrument's voice joins once it is known). */
  voices: VoiceName[];
  /** Change tradition at once (a reader picked one), rather than after the place has held for a while. */
  immediate?: boolean;
  /** A composed tradition: the members of its ensemble who may play now, its pieces for the year, its
   * idiomatic motifs and drum patterns. Without an ensemble the music is improvised from the scale. */
  ensemble?: Member[];
  tunes?: Tune[];
  motifs?: string[];
  percussion?: Record<string, string>;
  /** A recording to play instead of composing (served from public/audio/). */
  recording?: string;
}

const TONIC = 293.66; // D above middle C
const hzOf = (cents: number) => TONIC * 2 ** (cents / 1200);
const mod = (a: number, n: number) => ((a % n) + n) % n;

/**
 * The notes in reach for a share of the world known, low to high: a few around the tonic at first, then the
 * rest of the scale and the octaves either side. The first widenings count for most.
 */
export function notesFor(scale: number[], known: number): number[] {
  const all: number[] = [];
  for (let o = -2; o <= 1; o++) for (const c of scale) if (c + 1200 * o >= -1700 && c + 1200 * o <= 1900) all.push(c + 1200 * o);
  const rank = (p: number) => Math.abs(p - 150) - (mod(p, 1200) === 0 ? 260 : 0) - (mod(p - 700, 1200) < 30 || mod(p - 700, 1200) > 1170 ? 150 : 0);
  const k = Math.max(0, Math.min(1, known));
  const n = Math.min(all.length, 3 + Math.round(Math.sqrt(k) * (all.length - 3)));
  return [...all].sort((a, b) => rank(a) - rank(b)).slice(0, n).sort((a, b) => a - b);
}

interface Bus {
  dry: AudioNode;
  send: AudioNode;
}

/** One tradition's player: it writes notes ahead into the audio context, up to a time. Improvised from a
 * scale (below), composed from pieces (./composer), or a recording. */
export interface Player {
  id: string;
  out: GainNode;
  fill(until: number, h: Hearing): void;
  resume(time: number): void;
  /** Stop beginning phrases; the one under way is finished. */
  retire(): void;
  /** Retired and done. */
  done(): boolean;
  /** The piece being played, if it has a name. */
  piece?(): string | null;
}

/** A recording, looped with a short crossfade at the seam. */
function createRecordingPlayer(ctx: BaseAudioContext, bus: Bus, samples: Samples, id: string, path: string, start: number): Player {
  const out = ctx.createGain();
  out.connect(bus.dry);
  let buffer: AudioBuffer | null = null;
  let next = -1;
  let retiring = false;
  let playing: AudioBufferSourceNode[] = [];
  void samples.recording(path).then(b => (buffer = b));
  return {
    id,
    out,
    fill(until) {
      if (!buffer || retiring) return;
      if (next < 0) next = Math.max(start, ctx.currentTime + 0.1);
      while (next < until) {
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, next);
        g.gain.linearRampToValueAtTime(1, next + 1.5);
        g.gain.setValueAtTime(1, next + buffer.duration - 1.5);
        g.gain.linearRampToValueAtTime(0, next + buffer.duration);
        src.connect(g).connect(out);
        src.start(next);
        playing.push(src);
        next += buffer.duration - 1.5;
      }
    },
    resume(time) {
      for (const s of playing) s.stop();
      playing = [];
      next = time + 0.2;
    },
    retire() {
      retiring = true;
      setTimeout(() => playing.forEach(s => s.stop()), 9000);
    },
    done: () => retiring,
    piece: () => path,
  };
}

function createPlayer(ctx: BaseAudioContext, bus: Bus, voices: Voices, id: string, start: number, rand: () => number): Player {
  const out = ctx.createGain();
  out.connect(bus.dry);
  out.connect(bus.send);
  let next = start;
  let nextTanpura = start;
  let last = 0;
  let lastHz = 0;
  let left = 0;
  let known = -1;
  let still = true;
  let retiring = false;
  let finished = false;
  let voice: VoiceName = 'pluck';
  let cycle: number[] = [];
  let at = 0;
  // While it plays out its last phrase, a retiring player keeps its own scale and voices.
  let own: Hearing | null = null;

  const pick = <T>(from: readonly T[]): T => from[Math.floor(rand() * from.length)];
  const nearest = (notes: number[], c: number) => {
    let best = 0;
    for (let i = 1; i < notes.length; i++) if (Math.abs(notes[i] - c) < Math.abs(notes[best] - c)) best = i;
    return best;
  };
  const clampIndex = (notes: number[], i: number) => Math.max(0, Math.min(notes.length - 1, i));

  const sound = (v: VoiceName, cents: number, time: number, dur: number, strength: number, glide: boolean) => {
    const hz = hzOf(cents);
    const from = glide && SUSTAINED.has(v) && lastHz && Math.abs(Math.log2(hz / lastHz)) < 0.34 && rand() < 0.6 ? lastHz : undefined;
    voices.play(v, out, {hz, time, dur, strength, from, pan: (rand() - 0.5) * 0.7});
    lastHz = hz;
  };

  const newPhrase = (h: Hearing) => {
    const choice = h.voices.length > 1 ? h.voices.filter(v => v !== voice) : h.voices;
    voice = choice.length ? pick(choice) : 'pluck';
  };

  const step = (h: Hearing) => {
    const s = h.style;
    known = known < 0 ? h.known : known + (h.known - known) * (h.moving ? 0.35 : 0.7);
    const notes = notesFor(s.scale, known);
    const B = s.beat;
    still = !h.moving;
    if (still) {
      // Time stands still: one note now and then, sometimes answered.
      if (retiring) {
        finished = true;
        return;
      }
      if (!h.voices.includes(voice)) newPhrase(h);
      last = notes[clampIndex(notes, nearest(notes, last) + pick([-1, 0, 1, 1, 2]))];
      sound(voice, last, next, B * 2.5, 0.45 + rand() * 0.2, false);
      next += rand() < 0.3 ? B * 1.5 : B * (7 + rand() * 7);
      left = 0;
      return;
    }
    if (left <= 0) {
      if (retiring) {
        finished = true;
        return;
      }
      newPhrase(h);
      if (s.pattern === 'ostinato') {
        // A short cycle, walked from near the middle of what is in reach, repeated two to four times.
        const L = pick([4, 6, 8]);
        let i = nearest(notes, rand() < 0.5 ? 0 : 700);
        cycle = [];
        for (let k = 0; k < L; k++) {
          cycle.push(notes[i]);
          i = clampIndex(notes, i + (rand() < s.leaps ? pick([-3, -2, 2, 3]) : pick([-1, 1, 1, -1, 0])));
        }
        left = L * (2 + Math.floor(rand() * 3));
        at = 0;
      } else {
        // A new phrase: longer where more is known, and beginning near the tonic or the fifth.
        left = 2 + Math.floor(rand() * (2 + 5 * known));
        if (s.pattern === 'alap') left += 2;
        if (rand() < 0.5) last = notes[nearest(notes, rand() < 0.6 ? 0 : -500)];
      }
    }
    const strength = 0.5 + rand() * 0.35;
    if (s.pattern === 'ostinato') {
      const L = cycle.length;
      // Now and then, at the top of a repeat, one note of the cycle changes.
      if (at % L === 0 && at > 0 && rand() < 0.35) {
        const j = Math.floor(rand() * L);
        cycle[j] = notes[clampIndex(notes, nearest(notes, cycle[j]) + pick([-1, 1]))];
      }
      const c = cycle[at % L];
      sound(voice, c, next, B * 0.9, at % 2 ? strength * 0.75 : strength, false);
      // A second, lower line heard between the beats of the first.
      const under = c - 1200;
      if (known > 0.15 && rand() < 0.45 && notes.includes(under)) voices.play(voice, out, {hz: hzOf(under), time: next + B / 2, dur: B * 0.9, strength: strength * 0.5, pan: (rand() - 0.5) * 0.7});
      at++;
      left--;
      if (s.gong && at % L === 0) voices.play('gong', out, {hz: hzOf(-2400), time: next + B, dur: 4, strength: 0.55, pan: 0});
      next += left > 0 ? B : B * (2 + rand() * 2);
      return;
    }
    // Wander and alap: mostly by step, now and then a leap; a wide world leaps more.
    const leap = rand() < s.leaps * (0.6 + 0.8 * known);
    const move = leap ? pick([-4, -3, 3, 4]) : pick([-2, -1, -1, 1, 1, 2]);
    let i = nearest(notes, last) + move;
    if (i < 0 || i >= notes.length) i = nearest(notes, last) - move;
    i = clampIndex(notes, i);
    // An alap's phrase comes to rest on the tonic or the fifth.
    if (s.pattern === 'alap' && left === 1) i = [...notes.keys()].filter(k => mod(notes[k], 1200) === 0 || mod(notes[k] - 700, 1200) === 0).sort((a, b) => Math.abs(a - i) - Math.abs(b - i))[0] ?? i;
    const lengths = s.pattern === 'alap' ? [1, 1.5, 2, 2, 3] : voice === 'voice' ? [1, 1, 1, 1, 2] : [0.5, 0.5, 1, 1, 1, 1.5, 2];
    const gap = left > 1 ? B * pick(lengths) : B * (3 + rand() * (5 - 2.5 * known));
    // A grace note from just above, now and then.
    if (rand() < s.ornament && i + 1 < notes.length) voices.play(voice, out, {hz: hzOf(notes[i + 1]), time: next - 0.08, dur: 0.07, strength: strength * 0.45, pan: 0});
    last = notes[i];
    sound(voice, last, next, left > 1 ? gap * 0.95 : B * 2.2, strength, s.glide);
    // With enough of the world in view, a second string sometimes sounds the octave or fifth below.
    const under = last - (rand() < 0.5 ? 1200 : 700);
    if (!SUSTAINED.has(voice) && known > 0.25 && rand() < 0.3 * known && notes.some(n => Math.abs(n - under) < 30)) voices.play(voice, out, {hz: hzOf(under), time: next + 0.02, dur: gap, strength: strength * 0.6, pan: 0});
    left--;
    next += gap;
  };

  const tanpura = (until: number, h: Hearing) => {
    // Pa, Sa, Sa and the low Sa, plucked round and round under everything.
    const B = h.style.beat;
    while (nextTanpura < until) {
      for (const [k, c] of [-500, 0, 0, -1200].entries()) voices.play('pluck', out, {hz: hzOf(c - 1200), time: nextTanpura + k * B * 1.1, dur: 1, strength: 0.2, pan: -0.2 + k * 0.13});
      nextTanpura += B * 4.4;
    }
  };

  return {
    id,
    out,
    fill(until, heard) {
      if (finished) return;
      if (!retiring || !own) own = heard;
      const h = retiring ? {...own, known: heard.known, moving: heard.moving} : heard;
      // Time has started to run: do not sit out the long rest that was planned while it stood still.
      if (still && h.moving) next = Math.min(next, until + 0.2);
      if (h.style.tanpura && !retiring) tanpura(until, h);
      for (let n = 0; next < until && n < 24 && !finished; n++) step(h);
    },
    resume(time) {
      next = nextTanpura = time + 0.3;
      left = 0;
    },
    retire() {
      retiring = true;
    },
    done: () => finished,
  };
}

/** The whole score: the room, the drone, and the players, one for each tradition heard lately. */
export interface Score {
  out: GainNode;
  fill(until: number, h: Hearing): void;
  resume(time: number): void;
  /** The tradition playing now, and the piece if it has a name. */
  current(): {tradition: string; piece: string | null} | null;
}

/** How long the place must stay the same before the music follows it, in seconds. */
const HOLD = 2.5;
/** The crossfade's time constant: about three times this to be done. */
const FADE = 1.8;
const DRONE = 0.13;

export function createScore(ctx: BaseAudioContext, rand: () => number = Math.random): Score {
  const out = ctx.createGain();
  // A gentle limiter, so a chord of samples never clips.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -10;
  limiter.knee.value = 8;
  limiter.ratio.value = 6;
  limiter.attack.value = 0.004;
  limiter.release.value = 0.25;
  limiter.connect(out);
  const dry = ctx.createGain();
  dry.gain.value = 0.8;
  const send = ctx.createGain();
  send.gain.value = 0.5;
  const reverb = ctx.createConvolver();
  reverb.buffer = room(ctx, rand);
  dry.connect(limiter);
  send.connect(reverb).connect(limiter);
  const voices = new Voices(ctx, rand);
  const samples = new Samples(ctx);

  // The drone: D and the fifth above it, each two strings a hair apart, breathing slowly. Every tradition
  // shares it (at its own level), so it carries across a change.
  const droneTone = ctx.createBiquadFilter();
  droneTone.type = 'lowpass';
  droneTone.frequency.value = 320;
  droneTone.Q.value = 0.4;
  const droneGain = ctx.createGain();
  droneGain.gain.value = 0;
  droneTone.connect(droneGain);
  droneGain.connect(dry);
  droneGain.connect(send);
  const breath = ctx.createOscillator();
  breath.frequency.value = 0.07;
  const breathDepth = ctx.createGain();
  breathDepth.gain.value = 0;
  breath.connect(breathDepth).connect(droneGain.gain);
  breath.start();
  for (const [hz, cents, level] of [[146.83, -4, 0.5], [146.83, 5, 0.5], [220, -3, 0.3], [220, 4, 0.3], [73.42, 0, 0.5]] as const) {
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = hz;
    o.detune.value = cents;
    const g = ctx.createGain();
    g.gain.value = level;
    o.connect(g).connect(droneTone);
    o.start();
  }

  let current: Player | null = null;
  let retiring: Player[] = [];
  let pending: string | null = null;
  let pendingSince = 0;
  let droneFor = -1;

  const setDrone = (level: number, t: number) => {
    if (level === droneFor) return;
    droneFor = level;
    droneGain.gain.setTargetAtTime(DRONE * level, t, FADE);
    breathDepth.gain.setTargetAtTime(DRONE * level * 0.3, t, FADE);
  };

  const begin = (id: string, t: number, fade: boolean, h: Hearing) => {
    if (current) {
      const old = current;
      old.retire();
      old.out.gain.setTargetAtTime(0, t + 1.5, FADE);
      retiring.push(old);
      setTimeout(() => old.out.disconnect(), (1.5 + FADE * 5) * 1000);
    }
    // The newcomer's first note comes in as the old phrase is ending.
    const at = t + (fade ? 1.2 : 0.3);
    if (h.recording) current = createRecordingPlayer(ctx, {dry, send}, samples, id, h.recording, at);
    else if (h.ensemble?.length) {
      // Load its instruments; until they arrive each plays its synthesised voice.
      for (const m of h.ensemble) if (m.sample) void samples.load(m.sample);
      current = createComposer(ctx, {dry, send}, voices, samples, id, at, rand);
    } else current = createPlayer(ctx, {dry, send}, voices, id, at, rand);
    current.out.gain.value = fade ? 0 : 1;
    if (fade) current.out.gain.setTargetAtTime(1, t + 0.6, FADE * 0.7);
  };

  return {
    out,
    fill(until, h) {
      const t = ctx.currentTime;
      const id = h.style.id;
      if (!current) begin(id, t, false, h);
      else if (id !== current.id) {
        if (pending !== id) {
          pending = id;
          pendingSince = t;
        }
        if (h.immediate || t - pendingSince >= HOLD) {
          pending = null;
          begin(id, t, true, h);
        }
      } else pending = null;
      setDrone(h.style.drone, t);
      droneTone.frequency.setTargetAtTime(280 + 520 * Math.sqrt(h.known), t, 2);
      current!.fill(until, h);
      // The outgoing players finish their phrases in their own style.
      retiring = retiring.filter(p => !p.done());
      for (const p of retiring) p.fill(until, h);
    },
    resume(time) {
      current?.resume(time);
    },
    current: () => (current ? {tradition: current.id, piece: current.piece?.() ?? null} : null),
  };
}

/** A small room: decaying noise, duller as it dies away. */
function room(ctx: BaseAudioContext, rand: () => number): AudioBuffer {
  const sr = ctx.sampleRate;
  const length = Math.floor(sr * 3.4);
  const buffer = ctx.createBuffer(2, length, sr);
  for (let ch = 0; ch < 2; ch++) {
    const out = buffer.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < length; i++) {
      const x = i / length;
      lp += (0.55 - 0.45 * x) * (rand() * 2 - 1 - lp);
      out[i] = lp * (1 - x) ** 2.6;
    }
  }
  return buffer;
}

const KEY = 'music';
const VOLUME_KEY = 'music-volume';

/** What the page says about the music now: the tradition and why it is the one playing. */
export interface NowPlaying {
  tradition: string;
  /** The piece, when one with a name is playing. */
  piece: string | null;
  why: string;
}

/** The music in the page: off until asked for, remembered between visits, silent while the tab is hidden. */
export class Music {
  enabled = false;
  volume = 0.8;
  /** A tradition the reader chose to hear, instead of the one the map calls for. */
  audition: string | null = null;
  /** Told when the music turns on or off, or another tradition begins. */
  onChange: (() => void) | null = null;
  private ctx: AudioContext | null = null;
  private score: Score | null = null;
  private master: GainNode | null = null;
  private timer = 0;
  private shown = '';
  private immediate = false;

  constructor(private hear: () => Hearing & {why: string}) {
    try {
      this.enabled = localStorage.getItem(KEY) === 'on';
      const v = Number(localStorage.getItem(VOLUME_KEY));
      if (localStorage.getItem(VOLUME_KEY) !== null && Number.isFinite(v)) this.volume = Math.max(0, Math.min(1, v));
    } catch {
      /* storage may be unavailable */
    }
    // A browser lets sound begin only from a touch or a key: if the reader left the music on, wait for one.
    if (this.enabled) {
      const begin = () => {
        removeEventListener('pointerdown', begin, true);
        removeEventListener('keydown', begin, true);
        if (this.enabled) this.start();
      };
      addEventListener('pointerdown', begin, true);
      addEventListener('keydown', begin, true);
    }
    document.addEventListener('visibilitychange', () => {
      if (!this.enabled || !this.ctx) return;
      if (document.hidden) this.quiet();
      else this.start();
    });
  }

  /** What is playing now, and why; null while the music is off. */
  now(): NowPlaying | null {
    if (!this.enabled) return null;
    const h = this.hear();
    const cur = this.score?.current();
    return {tradition: cur?.tradition ?? h.style.id, piece: cur?.tradition === h.style.id ? cur.piece : null, why: h.why};
  }

  /** Turn the music on or off. Call from a click or a key, so the browser lets it sound. */
  toggle(on = !this.enabled): boolean {
    this.enabled = on;
    try {
      localStorage.setItem(KEY, this.enabled ? 'on' : 'off');
    } catch {
      /* storage may be unavailable */
    }
    if (this.enabled) this.start();
    else this.quiet();
    this.onChange?.();
    return this.enabled;
  }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    try {
      localStorage.setItem(VOLUME_KEY, String(this.volume));
    } catch {
      /* storage may be unavailable */
    }
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.08);
  }

  /** Hear one tradition (turning the music on), or go back to following the map with null. */
  listen(id: string | null) {
    this.audition = id;
    this.immediate = true;
    if (id && !this.enabled) this.toggle(true);
    else this.onChange?.();
  }

  private start() {
    const Ctx = window.AudioContext ?? (window as unknown as {webkitAudioContext?: typeof AudioContext}).webkitAudioContext;
    if (!Ctx) return;
    if (!this.ctx) {
      this.ctx = new Ctx();
      this.score = createScore(this.ctx);
      this.master = this.ctx.createGain();
      this.master.gain.value = 0;
      this.score.out.connect(this.master).connect(this.ctx.destination);
    }
    const {ctx, score, master} = this;
    void ctx.resume();
    score!.resume(ctx.currentTime);
    master!.gain.cancelScheduledValues(ctx.currentTime);
    master!.gain.setTargetAtTime(this.volume, ctx.currentTime, 0.8);
    clearInterval(this.timer);
    this.timer = window.setInterval(() => {
      const h = this.hear();
      score!.fill(ctx.currentTime + 0.4, {...h, immediate: this.immediate || h.immediate});
      this.immediate = false;
      const cur = score!.current();
      const shown = `${cur?.tradition}|${cur?.piece}|${h.why}`;
      if (shown !== this.shown) {
        this.shown = shown;
        this.onChange?.();
      }
    }, 120);
  }

  /** Fade out, then let the audio context rest. */
  private quiet() {
    clearInterval(this.timer);
    const {ctx, master} = this;
    if (!ctx || !master) return;
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setTargetAtTime(0, ctx.currentTime, 0.25);
    window.setTimeout(() => {
      if (!this.enabled || document.hidden) void ctx.suspend();
    }, 1500);
  }
}
