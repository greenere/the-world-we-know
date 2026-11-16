/**
 * The composer: plays a tradition's pieces as its musicians would. A piece is stated plainly by one
 * instrument, then taken up by the ensemble and varied: passing notes fill its leaps, long notes are
 * ornamented or (on a pipa) trembled, a second instrument shadows it an octave down on the beats, and a drum
 * keeps its metre. Between pieces the players improvise on the piece's own motifs, moving them up and down
 * the scale before coming home to a cadence. Where a tradition has no surviving piece for the year, the
 * improvisation draws on its idiomatic motifs instead.
 *
 * The ensemble grows with the known world: one player where little is known, all of them where much is.
 */

import {type MidiPiece, parseMidi} from './midi';
import type {Hearing, Player} from './music';
import type {Samples} from './samples';
import {type VoiceName, Voices} from './voices';

/** A piece, as authored: notes as `pitch:beats`, `r:beats` for a rest, `/` after a phrase, `|` between bars. */
export interface Tune {
  id: string;
  name: string;
  /** Its notes, in the notation below; or else `midi`. */
  notes?: string;
  /** A MIDI file under public/audio/ whose tracks are named for the ensemble's members who play them. */
  midi?: string;
  /** Semitones to move it so its final or tonic falls on the shared tonic, D. */
  transpose?: number;
  /** Seconds per beat (a quarter note). */
  beat: number;
  /** Beats in a bar. */
  meter: number;
  /** Beats before the first bar line. */
  pickup?: number;
  from?: number;
  until?: number;
  /** Where the notes come from. */
  source?: string;
  confidence?: string;
  /** What it is, in a sentence. */
  about?: string;
  /** Who made the transcription the notes are taken from, as its licence asks. */
  credit?: string;
  /** One of a tradition's arrangements of its theme, one for each age: the music moves between them at
   * the end of a phrase and carries on with the next phrase, rather than starting again. */
  theme?: string;
  /** Heard only when chosen in the settings, not as the timeline plays. */
  extra?: boolean;
}

export interface Member {
  id: string;
  /** A sampled instrument (public/audio/samples.json), played once loaded. */
  sample?: string;
  /** The synthesised voice of the same family, until then (or for good). */
  voice: VoiceName;
  /** `melody` takes the tune, `accompany` shadows it, `accent` marks the phrases (bells); a `part` plays only
   * its own track in a MIDI piece. */
  role: 'melody' | 'accompany' | 'both' | 'accent' | 'part';
  /** A drum rather than a pitched instrument: D low, B a deeper drum, t rim, k clapper, b wood block,
   * c cymbal, s a scraper. */
  drum?: string;
  /** Plucked notes held by trembling the string, as on the pipa. */
  tremolo?: boolean;
  /** Octaves to move it by. */
  octave?: number;
  gain?: number;
  /** An instrument on the Music shelf: this member joins once the viewpoint knows it. */
  instrument?: string;
  /** One of the atlas's own orchestra, arranging the piece for a modern ear rather than playing it as it was
   * played: always present, unless the reader asks for the Historical arrangement. */
  modern?: boolean;
  /** Where it sits, from -1 (left) to 1 (right); left to chance if not given. */
  seat?: number;
  /** Bowed or breathed in slowly and let go slowly (a string pad, a horn swell). */
  swell?: boolean;
  from?: number;
  until?: number;
}

export interface Ensemble {
  members: Member[];
  /** Drum patterns by beats in the bar, one character per eighth: D a low stroke, t a high one, k a clapper,
   * b a wood block, c a cymbal, . nothing. */
  percussion?: Record<string, string>;
  /** Short idiomatic motifs in the tune notation, for improvising where no piece survives. */
  motifs?: string[];
}

interface Note {
  cents: number;
  beats: number;
  /** The last note of a phrase. */
  end?: boolean;
}

interface Event {
  time: number;
  play: () => void;
  /** A phrase ends here: a place the music can stop. */
  cadence?: boolean;
}

const TONIC_MIDI = 62;
const TONIC = 293.66;
const hzOf = (cents: number) => TONIC * 2 ** (cents / 1200);
const LETTERS: Record<string, number> = {C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11};

/** Read a tune's notes into cents above the tonic. */
export function parseNotes(text: string, transpose = 0): Note[] {
  const out: Note[] = [];
  for (const tok of text.trim().split(/\s+/)) {
    if (tok === '|' || !tok) continue;
    if (tok === '/') {
      if (out.length) out[out.length - 1].end = true;
      continue;
    }
    const m = /^([A-Gr])([#b]?)(-?\d)?:([\d.]+)(\/?)$/.exec(tok);
    if (!m) throw new Error(`bad note ${tok}`);
    const beats = Number(m[4]);
    if (m[1] === 'r') out.push({cents: NaN, beats});
    else {
      const midi = 12 * (Number(m[3]) + 1) + LETTERS[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
      out.push({cents: (midi + transpose - TONIC_MIDI) * 100, beats});
    }
    if (m[5]) out[out.length - 1].end = true;
  }
  if (out.length) out[out.length - 1].end = true;
  return out;
}

/** The pitches a tune uses, laid out over several octaves, to move by steps within its own scale. */
function ladderOf(notes: Note[], fallback: number[]): number[] {
  const classes = new Set<number>();
  for (const n of notes) if (!Number.isNaN(n.cents)) classes.add(((Math.round(n.cents) % 1200) + 1200) % 1200);
  const scale = classes.size >= 4 ? [...classes].sort((a, b) => a - b) : fallback;
  const out: number[] = [];
  for (let o = -3; o <= 2; o++) for (const c of scale) out.push(c + 1200 * o);
  return out;
}

const nearestIndex = (ladder: number[], c: number) => {
  let best = 0;
  for (let i = 1; i < ladder.length; i++) if (Math.abs(ladder[i] - c) < Math.abs(ladder[best] - c)) best = i;
  return best;
};

/** A varied performance of a line: `v` from 0 (as written) to 1 (freely elaborated). */
function vary(notes: Note[], ladder: number[], v: number, rand: () => number): Note[] {
  const out: Note[] = [];
  notes.forEach((n, i) => {
    const next = notes.slice(i + 1).find(x => !Number.isNaN(x.cents));
    if (Number.isNaN(n.cents) || !next || n.end) return void out.push(n);
    const a = nearestIndex(ladder, n.cents);
    const b = nearestIndex(ladder, next.cents);
    // A leap of a third filled with the note between ("adding flowers" to a melody).
    if (Math.abs(a - b) === 2 && n.beats >= 0.5 && rand() < v * 0.6) {
      out.push({cents: n.cents, beats: n.beats / 2}, {cents: ladder[(a + b) / 2], beats: n.beats / 2});
      return;
    }
    // A long note broken into the note and a turn to its upper neighbour and back.
    if (n.beats >= 1 && rand() < v * 0.35) {
      const up = ladder[a + 1];
      out.push({cents: n.cents, beats: n.beats - 0.5}, {cents: up, beats: 0.25}, {cents: n.cents, beats: 0.25});
      return;
    }
    out.push(n);
  });
  return out;
}

/** The accompanying line: the tune's notes that fall on the beat, held until the next, an octave down. */
function skeleton(notes: Note[], pickup: number): Note[] {
  const out: Note[] = [];
  let t = -pickup;
  for (const n of notes) {
    const onBeat = Math.abs(t - Math.round(t)) < 1e-6;
    if (onBeat || !out.length) out.push({...n});
    else out[out.length - 1].beats += n.beats;
    if (n.end) out[out.length - 1].end = true;
    t += n.beats;
  }
  return out;
}

/** MIDI pieces, loaded once and shared by every player. */
const midiPieces = new Map<string, MidiPiece | null>();
const midiLoading = new Set<string>();

function midiPiece(samples: Samples, path: string): MidiPiece | null | undefined {
  if (midiPieces.has(path)) return midiPieces.get(path);
  if (!midiLoading.has(path)) {
    midiLoading.add(path);
    void samples.file(path).then(b => {
      try {
        midiPieces.set(path, b ? parseMidi(b) : null);
      } catch {
        midiPieces.set(path, null);
      }
    });
  }
  return undefined;
}

/** Start loading a tradition's MIDI pieces, so the first is ready when it is wanted. */
export function preloadMidi(samples: Samples, tunes: Tune[] | undefined) {
  for (const t of tunes ?? []) if (t.midi) midiPiece(samples, t.midi);
}

export function createComposer(
  ctx: BaseAudioContext,
  dest: {dry: AudioNode; send: AudioNode},
  voices: Voices,
  samples: Samples,
  id: string,
  start: number,
  rand: () => number,
): Player {
  const out = ctx.createGain();
  out.connect(dest.dry);
  out.connect(dest.send);
  // The players' own level: softer while time stands still, full while it runs. A change is heard at once,
  // without stopping the piece.
  const mix = ctx.createGain();
  mix.gain.value = 0.6;
  mix.connect(out);
  let pending: Event[] = [];
  let sectionEnd = start;
  let section = 0;
  let tuneIndex = 0;
  let nowPiece: string | null = null;
  let still = true;
  let stillManner = true;
  let retiring = false;
  let own: Hearing | null = null;
  let lastMelody = '';
  let orchestral = true;
  /** The next piece comes in softly, growing over its first bars (after a change of era). */
  let entering = false;
  /** The theme the piece now playing belongs to, where it began (as if from its start), and where its
   * phrases end; and the phrase to carry on from in the next age's arrangement. */
  let nowTheme: string | null = null;
  let nowStart = 0;
  let nowBegan = 0;
  let nowCadences: number[] = [];
  let resumePhrase: number | null = null;
  /** The theme playing, or next to play: kept while time runs, turned while it stands still. */
  let themeNow: string | null = null;
  let nowMidi = false;

  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
  /** Each player keeps one seat, as on a stage: from its own `seat`, or one its name gives it. */
  const seats = new Map<string, number>();
  const seatOf = (m: Member) => {
    if (m.seat !== undefined) return m.seat;
    let s = seats.get(m.id);
    if (s === undefined) {
      let h = 7;
      for (const ch of m.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      seats.set(m.id, (s = ((h % 1000) / 1000 - 0.5) * 0.9));
    }
    return s;
  };

  /** Sound one note on a member of the ensemble: its samples once loaded, its synthesised voice until then. */
  const sound = (m: Member, cents: number, time: number, dur: number, strength: number) => {
    if (m.drum) return drum(m.drum, time, strength * (m.gain ?? 1));
    // The orchestra has no synthesised stand-in: until its samples arrive it waits.
    if (m.modern && (!orchestral || (m.sample && !samples.ready(m.sample)))) return;
    const c = cents + 1200 * (m.octave ?? 0);
    const hz = hzOf(c);
    const level = strength * (m.gain ?? 1);
    const p = seatOf(m) + (rand() - 0.5) * 0.08;
    const one = (t: number, s: number, d: number, damp = false) => {
      if (m.sample && samples.play(m.sample, mix, {hz, time: t, dur: d, strength: s, pan: p, damp, swell: m.swell})) return;
      voices.play(m.voice, mix, {hz, time: t, dur: d, strength: s, pan: p});
    };
    if (m.tremolo && dur >= 0.45) {
      // The pipa's lun: a held note made of quick strokes.
      for (let t = 0, k = 0; t < dur - 0.06; t += 0.085, k++) {
        const last = t + 0.085 >= dur - 0.06;
        one(time + t, level * (k % 2 ? 0.4 : 0.5) * (1 - (0.3 * t) / dur), last ? 0.6 : 0.1, !last);
      }
    } else one(time, level, dur);
  };

  const drum = (kind: string, time: number, strength: number) => {
    const g = ctx.createGain();
    g.connect(mix);
    const noise = () => {
      const src = ctx.createBufferSource();
      const len = Math.floor(ctx.sampleRate * 0.6);
      const b = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = rand() * 2 - 1;
      src.buffer = b;
      return src;
    };
    const decay = (to: AudioParam, peak: number, tau: number) => {
      to.setValueAtTime(peak, time);
      to.setTargetAtTime(0, time + 0.003, tau);
    };
    if (kind === 'D' || kind === 'B') {
      // A drum's low stroke: a falling thump; B is a great barrel drum, deeper and longer.
      const big = kind === 'B';
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(big ? 80 : 110, time);
      o.frequency.exponentialRampToValueAtTime(big ? 38 : 58, time + (big ? 0.4 : 0.18));
      o.connect(g);
      decay(g.gain, (big ? 0.75 : 0.55) * strength, big ? 0.28 : 0.09);
      o.start(time);
      o.stop(time + (big ? 1.6 : 0.6));
    } else if (kind === 's') {
      // A scraper: a stick drawn along a row of wooden teeth (the tiger-box's back).
      for (let k = 0; k < 18; k++) {
        const tt = time + 0.25 + k * 0.055;
        const o = ctx.createOscillator();
        o.frequency.value = 700 + 40 * (k % 3);
        const og = ctx.createGain();
        og.gain.setValueAtTime(0.12 * strength, tt);
        og.gain.setTargetAtTime(0, tt, 0.01);
        o.connect(og).connect(g);
        o.start(tt);
        o.stop(tt + 0.06);
      }
      // And the one stroke on its head before.
      const o = ctx.createOscillator();
      o.frequency.value = 520;
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.25 * strength, time);
      og.gain.setTargetAtTime(0, time, 0.03);
      o.connect(og).connect(g);
      o.start(time);
      o.stop(time + 0.2);
      g.gain.value = 1;
    } else if (kind === 'b') {
      // A wood block: two hollow partials, gone at once.
      for (const [f, l] of [[880, 1], [1330, 0.5]] as const) {
        const o = ctx.createOscillator();
        o.frequency.value = f;
        const og = ctx.createGain();
        og.gain.value = l;
        o.connect(og).connect(g);
        o.start(time);
        o.stop(time + 0.2);
      }
      decay(g.gain, 0.16 * strength, 0.025);
    } else {
      // t: the rim of the drum; k: a clapper; c: a small cymbal.
      const n = noise();
      const f = ctx.createBiquadFilter();
      f.type = kind === 'c' ? 'highpass' : 'bandpass';
      f.frequency.value = kind === 't' ? 1900 : kind === 'k' ? 3200 : 6500;
      f.Q.value = kind === 'c' ? 0.7 : 1.2;
      n.connect(f).connect(g);
      decay(g.gain, (kind === 'c' ? 0.07 : kind === 'k' ? 0.2 : 0.28) * strength, kind === 'c' ? 0.25 : kind === 'k' ? 0.012 : 0.03);
      n.start(time);
      n.stop(time + (kind === 'c' ? 1.2 : 0.3));
    }
  };

  const at = (time: number, play: () => void, cadence = false) => pending.push({time, play, cadence});

  /** Write a line into the queue from `t0`; returns when it ends. */
  const line = (notes: Note[], m: Member, t0: number, beat: number, strength: number, onPhrase?: (t: number) => void): number => {
    let t = t0;
    let phraseStart = true;
    for (const n of notes) {
      // A little give in the time, and a breath at the end of each phrase.
      const len = n.beats * beat * (1 + (rand() - 0.5) * 0.05) * (n.end ? 1.2 : 1);
      if (!Number.isNaN(n.cents)) {
        const c = n.cents;
        const s = strength * (phraseStart ? 1.08 : 0.92 + rand() * 0.12);
        if (phraseStart && onPhrase) onPhrase(t);
        at(t, () => sound(m, c, t, len * 0.96, s), !!n.end);
        phraseStart = false;
      }
      t += len;
      if (n.end) {
        t += beat * 0.25;
        phraseStart = true;
      }
    }
    return t;
  };

  /** The drum's pattern under a stretch of music. */
  const percussion = (pattern: string, t0: number, t1: number, beat: number, pickup: number, strength: number) => {
    const step = beat / 2;
    let i = 0;
    for (let t = t0 + pickup * beat; t < t1 - step / 2; t += step, i++) {
      const ch = pattern[i % pattern.length];
      if (ch !== '.') {
        const tt = t;
        at(tt, () => drum(ch, tt, strength * (i % pattern.length === 0 ? 1 : 0.8)));
      }
    }
  };

  /** The members playing now: as many as the known world allows, the melody players first. */
  const players = (h: Hearing) => {
    const all = (h.ensemble ?? []).filter(m => m.role !== 'part');
    const n = Math.max(1, Math.round(1 + h.known * 1.6 * (all.length - 1)));
    return all.slice(0, n);
  };

  const melodists = (ms: Member[]) => ms.filter(m => m.role === 'melody' || m.role === 'both');

  /** A statement of a piece: solo, or the ensemble with variation. */
  const statement = (h: Hearing, tune: Tune, t0: number, ensemble: boolean, v: number): number => {
    const notes = parseNotes(tune.notes ?? '', tune.transpose);
    const ladder = ladderOf(notes, h.style.scale);
    const ms = players(h);
    const mel = melodists(ms);
    const lead = ensemble ? mel.find(m => m.id !== lastMelody) ?? mel[0] : mel[0];
    if (!lead) return t0;
    lastMelody = lead.id;
    const beat = tune.beat * (ensemble ? 1 : 1.06);
    const accent = ensemble ? ms.find(m => m.role === 'accent') : undefined;
    const end = line(vary(notes, ladder, v, rand), lead, t0, beat, 0.8, accent ? t => sound(accent, notes[0].cents - 1200, t, beat * 2, 0.5) : undefined);
    if (ensemble) {
      const acc = ms.find(m => m !== lead && (m.role === 'accompany' || m.role === 'both'));
      if (acc) line(skeleton(notes, tune.pickup ?? 0).map(n => ({...n, cents: n.cents - 1200})), acc, t0 + 0.02, beat, 0.5);
      const pat = h.percussion?.[String(tune.meter)];
      if (pat && ms.length >= 2) percussion(pat, t0, end, beat, tune.pickup ?? 0, 0.8);
    }
    return end;
  };

  /** An improvisation on motifs: a few of them moved through the scale, then a cadence on the tonic. */
  const interlude = (h: Hearing, source: Note[][], t0: number, beat: number): number => {
    const ms = players(h);
    const mel = melodists(ms);
    const lead = mel.find(m => m.id !== lastMelody) ?? mel[0];
    if (!lead || !source.length) return t0;
    lastMelody = lead.id;
    const ladder = ladderOf(source.flat(), h.style.scale);
    const phrases = 2;
    let t = t0;
    for (let p = 0; p < phrases; p++) {
      const notes: Note[] = [];
      const count = 2 + Math.floor(rand() * 2);
      let shift = 0;
      for (let k = 0; k < count; k++) {
        const motif = pick(source);
        // The same motif again a step or two higher or lower: a sequence, as improvisers build them.
        if (k > 0) shift += pick([-2, -1, 1, 2]);
        const invert = rand() < 0.2;
        const base = nearestIndex(ladder, motif.find(n => !Number.isNaN(n.cents))?.cents ?? 0);
        for (const n of motif) {
          if (Number.isNaN(n.cents)) {
            notes.push({...n, end: false});
            continue;
          }
          let i = nearestIndex(ladder, n.cents) + shift;
          if (invert) i = base + shift - (i - base - shift);
          i = Math.max(0, Math.min(ladder.length - 1, i));
          // Keep within a singer's compass around the tonic.
          let c = ladder[i];
          while (c > 1400) c -= 1200;
          while (c < -900) c += 1200;
          notes.push({cents: c, beats: n.beats});
        }
      }
      // Home: the last note moves to the nearest tonic (or, ending the first phrase, the fifth) and is held.
      const last = notes[notes.length - 1];
      const goal = p === phrases - 1 ? [0, 1200, -1200] : [700, -500];
      last.cents = goal.reduce((a, b) => (Math.abs(b - last.cents) < Math.abs(a - last.cents) ? b : a));
      last.beats = 2;
      last.end = true;
      t = line(notes, lead, t, beat, 0.75);
    }
    // Beneath it, if there are players enough, a held tonic and fifth.
    const acc = ms.find(m => m !== lead && (m.role === 'accompany' || m.role === 'both'));
    if (acc && ms.length >= 2) {
      for (let tt = t0, k = 0; tt < t - beat * 2; tt += beat * 4, k++) {
        const c = k % 2 ? -500 : -1200;
        const ttt = tt;
        at(ttt, () => sound(acc, c, ttt, beat * 3.8, 0.35));
      }
    }
    return t;
  };

  /** A MIDI piece: each track played by the member of its name, from the start or (standing still) only to
   * its first cadence, softly. */
  /** Play a MIDI piece from `t0`, from `from` seconds into it (the start of a phrase) to `to`; returns
   * when it ends. */
  const playMidi = (h: Hearing, piece: MidiPiece, t0: number, enter: boolean, from = 0, to = piece.length, arrive = 0): number => {
    const members = new Map((h.ensemble ?? []).map(m => [m.id, m]));
    const begin = t0 - from;
    for (const tr of piece.tracks) {
      const m = members.get(tr.name);
      if (!m) continue;
      for (const n of tr.notes) {
        if (n.time < from - 0.02 || n.time >= to - 0.01) continue;
        // Arriving from another age (until `arrive`): the drums wait for the next phrase, and the rest come
        // in softly and grow.
        const arriving = n.time < arrive - 0.01;
        if (arriving && percussive(m)) continue;
        const time = begin + n.time;
        const cents = (n.pitch - TONIC_MIDI) * 100 - 1200 * (m.octave ?? 0);
        const grow = arriving ? 0.25 + (0.75 * (n.time - from)) / Math.max(0.1, arrive - from) : 1;
        const s = (n.velocity / 127) * grow * (enter ? Math.min(1, 0.35 + (0.65 * (n.time - from)) / 9) : 1);
        at(time, () => sound(m, cents, time, n.dur, s));
      }
    }
    nowPlaying = {piece, h};
    for (const mk of piece.markers) if (mk.time > from + 0.01 && mk.time <= to + 0.01) at(begin + mk.time, () => {}, true);
    nowStart = begin;
    nowBegan = t0;
    nowCadences = piece.markers.filter(m => m.text === 'cadence').map(m => m.time);
    return begin + to + (to >= piece.length ? 1 : 0.1);
  };
  let midiStep = 0;
  /** The piece now playing and how it was heard, so its players can fade out under the next age's. */
  let nowPlaying: {piece: MidiPiece; h: Hearing} | null = null;
  /** The players leaving at a change of age, to play one more phrase as they fade. */
  let leaving: {piece: MidiPiece; h: Hearing; phrase: number} | null = null;
  const percussive = (m: Member) => !!m.drum || m.voice === 'gong' || m.voice === 'metal' || m.sample === 'timpani' || m.sample === 'taiko';

  /**
   * The old age's players, fading through the phrase `[a, b)` of their piece while the new age's come in: the
   * phrase is fitted to the new players' `span` seconds from `t0`, so both play the tune together. Their
   * drums have already stopped.
   */
  const fadeOut = (old: {piece: MidiPiece; h: Hearing}, a: number, b: number, t0: number, span: number) => {
    const members = new Map((old.h.ensemble ?? []).map(m => [m.id, m]));
    const ratio = span / Math.max(0.1, b - a);
    for (const tr of old.piece.tracks) {
      const m = members.get(tr.name);
      if (!m || percussive(m)) continue;
      for (const n of tr.notes) {
        if (n.time < a - 0.02 || n.time >= b - 0.01) continue;
        const x = (n.time - a) / Math.max(0.1, b - a);
        const time = t0 + (n.time - a) * ratio;
        const cents = (n.pitch - TONIC_MIDI) * 100 - 1200 * (m.octave ?? 0);
        const s = (n.velocity / 127) * 0.85 * (1 - x) ** 1.3;
        if (s < 0.03) continue;
        pending.push({time, play: () => sound(m, cents, time, n.dur * ratio * (1 - 0.4 * x), s)});
      }
    }
  };
  /** For each theme, the verse to play next, each verse fuller than the one before: a theme plays on
   * verse after verse while time runs, and a tradition's themes take turns while it stands still. */
  const verses = new Map<string, number>();

  /**
   * The bridge between two eras' pieces, from `t0` where the old one closes: the orchestra holds an open D
   * (the tonic every piece shares) and swells, the harp climbs in fifths and the timpani roll the new piece
   * in; with the Historical arrangement, a held D on the ensemble's own instruments. Returns where the new
   * piece begins.
   */
  const bridge = (h: Hearing, t0: number): number => {
    const ms = new Map((h.ensemble ?? []).map(m => [m.id, m]));
    const len = 4.2;
    const play = (m: Member | undefined, cents: number, at: number, dur: number, s: number) => {
      if (m) pending.push({time: at, play: () => sound(m, cents, at, dur, s)});
    };
    const strings = orchestral ? ms.get('strings') : undefined;
    if (strings) {
      for (const [c, s] of [[-1200, 0.42], [-500, 0.36], [0, 0.34], [700, 0.22]] as const) play(strings, c, t0 - 0.4, len + 1.6, s);
      play(ms.get('cello'), -2400, t0 - 0.2, len + 1.2, 0.5);
      play(ms.get('contrabass'), -3600, t0 + 0.6, len, 0.4);
      [-1200, -500, 0, 700, 1200, 1900].forEach((c, i) => play(ms.get('harp'), c, t0 + 1.2 + i * 0.32, 2.4, 0.32 + i * 0.04));
      const timp = ms.get('timpani');
      for (let k = 0, n = 22; k < n; k++) play(timp, -2400, t0 + len - 2.4 + k * 0.11, 0.1, 0.12 + (0.38 * k) / n);
      play(timp, -2400, t0 + len, 0.6, 0.6);
    } else {
      // The ensemble's own: whoever can hold a note holds the tonic, an octave apart.
      const holders = (h.ensemble ?? []).filter(m => !m.modern && !m.drum && m.sample && m.role !== 'accent').slice(0, 2);
      holders.forEach((m, i) => play(m, i ? 0 : -1200, t0 - 0.2 + i * 0.5, len - 0.6, 0.32));
    }
    return t0 + len;
  };

  const plan = (h: Hearing, t0: number): number => {
    const tunes = h.tunes ?? [];
    const motifs = (h.motifs ?? []).map(m => parseNotes(m, 0));
    let tune = tunes.length ? tunes[tuneIndex % tunes.length] : undefined;
    const has = (th: string | null | undefined) => !!th && tunes.some(x => x.theme === th);
    if (midiStep === 1) {
      // Finishing the verse under way.
      tune = tunes.find(x => x.id === nowPiece) ?? tune;
    } else if (tunes.some(x => x.theme)) {
      // Which theme: the one carried across a change of age; else the one the reader chose to hear; else the
      // one playing (kept while time runs, turned while it stands still).
      const want = resumePhrase !== null && has(themeNow) ? themeNow : has(h.prefer) ? h.prefer : has(themeNow) ? themeNow : null;
      if (want) tune = tunes.find(x => x.theme === want);
    }
    if (tune?.midi) {
      // A MIDI piece is played whole, then the players improvise before the next piece.
      const piece = midiPiece(samples, tune.midi);
      // Still loading (a few kilobytes): wait a moment rather than start something else.
      if (piece === undefined) return t0 + 0.4;
      // And a moment for its instruments, so the first piece does not begin without them.
      if (t0 - start < 5 && (h.ensemble ?? []).some(m => m.sample && !samples.ready(m.sample))) return t0 + 0.4;
      if (piece === null) {
        tuneIndex++;
        return t0 + 0.5;
      }
      const enter = entering;
      entering = false;
      if (midiStep === 0) {
        // Carrying on from another age's arrangement: begin at the phrase it had reached.
        const cads = piece.markers.filter(m => m.text === 'cadence').map(m => m.time);
        const stanzas = piece.markers.filter(m => m.text === 'stanza').map(m => m.time);
        const resuming = resumePhrase !== null;
        const k = resumePhrase ?? 0;
        resumePhrase = null;
        let from = k > 0 && k < cads.length ? cads[k - 1] : 0;
        let to = piece.length;
        if (tune.theme && stanzas.length) {
          // A theme is played a verse at a time: its next verse, or the rest of the verse it had reached.
          if (!resuming) {
            const v = verses.get(tune.theme) ?? 0;
            from = v > 0 ? stanzas[v - 1] : 0;
          }
          const vi = stanzas.findIndex(x => x > from + 0.01);
          to = vi >= 0 ? stanzas[vi] : piece.length;
          verses.set(tune.theme, (vi >= 0 ? vi + 1 : 0) % stanzas.length);
        }
        // A change of age: the new players' first phrase is a handover, the old ones fading through it.
        let arrive = 0;
        const old = leaving;
        leaving = null;
        if (resuming) {
          const next = cads.find(c => c > from + 0.01) ?? to;
          arrive = Math.min(next, to);
          const oc = old ? old.piece.markers.filter(m => m.text === 'cadence').map(m => m.time) : [];
          if (old && k > 0 && k < oc.length) fadeOut(old, oc[k - 1], oc[k], t0, arrive - from);
        }
        midiStep = 1;
        nowPiece = tune.id;
        nowTheme = tune.theme ?? null;
        themeNow = tune.theme ?? null;
        nowMidi = true;
        return playMidi(h, piece, t0, enter, from, to, arrive);
      }
      midiStep = 0;
      // While time runs, a theme keeps going, verse after verse, so the timeline has one voice; while it
      // stands still, the tradition's themes take turns.
      if (!tune.theme) tuneIndex++;
      else if (!h.moving) {
        const themes = [...new Set(tunes.filter(x => x.theme).map(x => x.theme as string))];
        themeNow = themes[(themes.indexOf(tune.theme) + 1) % themes.length];
      }
      nowPiece = null;
      nowMidi = false;
      // Between verses, a breath (longer while time stands still).
      if (tune.theme) return t0 + (h.moving ? 0.3 : 3 + rand() * 3);
      // Then a rest while time stands still, or the players improvising on its motifs while it runs.
      if (!h.moving) return t0 + 5 + rand() * 5;
      return motifs.length ? interlude(h, motifs, t0, h.style.beat) + h.style.beat * 2 : t0 + 2;
    }
    if (!h.moving) {
      // Time stands still: one phrase on one instrument, softly, then quiet.
      const lead = melodists(players(h))[0];
      if (!lead) return t0 + 8;
      let phrase: Note[] = [];
      let beat = h.style.beat;
      if (tunes.length && rand() < 0.6) {
        const tune = tunes[tuneIndex % tunes.length];
        const notes = parseNotes(tune.notes ?? '', tune.transpose);
        const stop = notes.findIndex(n => n.end);
        phrase = notes.slice(0, stop + 1);
        beat = tune.beat * 1.15;
        nowPiece = tune.id;
      } else if (motifs.length) {
        phrase = pick(motifs).map(n => ({...n}));
        phrase[phrase.length - 1].end = true;
        nowPiece = null;
      }
      const end = line(phrase, lead, t0, beat, 0.55);
      return end + 6 + rand() * 6;
    }
    // Moving: a piece stated, then varied by the ensemble, then improvised on, then varied again.
    if (tunes.length) {
      const tune = tunes[tuneIndex % tunes.length];
      nowPiece = tune.id;
      const notes = parseNotes(tune.notes ?? '', tune.transpose);
      const step = section % 4;
      section++;
      if (step === 3) tuneIndex++;
      if (step === 0) return statement(h, tune, t0, false, 0) + tune.beat;
      if (step === 1) return statement(h, tune, t0, true, 0.35) + tune.beat;
      if (step === 2) {
        // Motifs from the piece itself: three to five notes from the start of each phrase.
        const fragments: Note[][] = [];
        let from = 0;
        notes.forEach((n, i) => {
          if (n.end) {
            const frag = notes.slice(from, Math.min(i + 1, from + 3 + Math.floor(rand() * 3))).filter(x => !Number.isNaN(x.cents));
            if (frag.length >= 3) fragments.push(frag);
            from = i + 1;
          }
        });
        return interlude(h, fragments.length ? fragments : motifs, t0, tune.beat) + tune.beat;
      }
      return statement(h, tune, t0, true, 0.7) + tune.beat * 2;
    }
    nowPiece = null;
    section++;
    return interlude(h, motifs, t0, h.style.beat) + h.style.beat * (1 + rand() * 2);
  };

  return {
    id,
    out,
    fill(until, heard) {
      if (!retiring || !own) own = heard;
      orchestral = heard.orchestral ?? true;
      const h = retiring ? {...own, known: heard.known, moving: heard.moving} : heard;
      const now = ctx.currentTime;
      // A piece chosen to hear starts now, not at the next line's end.
      const chosen = heard.immediate && h.tunes?.length === 1 ? h.tunes[0].id : null;
      if (!retiring && chosen && nowPiece !== chosen) {
        pending = pending.filter(e => e.time <= now + 0.05);
        sectionEnd = now + 0.4;
        nowPiece = null;
        tuneIndex = 0;
        section = 0;
        midiStep = 0;
        resumePhrase = null;
      }
      // The year has moved out of the piece's era: finish the line under way and take up the new era's music.
      if (!retiring && nowPiece && !(h.tunes ?? []).some(t => t.id === nowPiece)) {
        // Each age's players have at least a phrase of their own (some seconds) before the next take over,
        // however fast the years go by.
        const cut = pending.filter(e => e.time > Math.max(now + 0.05, nowBegan + 6)).find(e => e.cadence);
        if (cut) pending = pending.filter(e => e.time <= cut.time);
        const next = nowTheme ? (h.tunes ?? []).find(x => x.theme === nowTheme) : undefined;
        if (cut && next) {
          tuneIndex = (h.tunes ?? []).indexOf(next);
          themeNow = next.theme ?? null;
          // The same theme in the next age's arrangement: at the end of this phrase the new players take up
          // the following one, the melody unbroken.
          resumePhrase = nowCadences.filter(c => c <= cut.time - nowStart + 0.01).length;
          leaving = nowPlaying ? {...nowPlaying, phrase: resumePhrase} : null;
          sectionEnd = cut.time;
        } else {
          // Not a gap and a fresh start: a bridge on the shared tonic, and the new piece coming in under it.
          sectionEnd = bridge(h, cut ? cut.time : now + 0.3);
          pending.sort((a, b) => a.time - b.time);
          entering = true;
          tuneIndex = 0;
        }
        nowPiece = null;
        nowTheme = null;
        nowMidi = false;
        section = 0;
        midiStep = 0;
      }
      // A change between running and standing still is heard at the next phrase's end, not after the piece.
      if (still !== !h.moving) {
        still = !h.moving;
        mix.gain.setTargetAtTime(still ? 0.6 : 1, now, 0.8);
      }
      // A piece being played goes on whether time runs or stands; the improvised music changes its manner at
      // the next phrase's end.
      if (still !== stillManner && !nowMidi) {
        stillManner = still;
        const cut = pending.filter(e => e.time > now + 0.05).find(e => e.cadence);
        if (cut) {
          pending = pending.filter(e => e.time <= cut.time);
          sectionEnd = cut.time + (still ? 1.5 : 0.6);
        } else if (pending.length === 0 || pending[pending.length - 1].time < now) sectionEnd = Math.min(sectionEnd, now + 0.3);
      }
      if (!retiring && pending.length === 0 && sectionEnd < until + 1.5) {
        sectionEnd = plan(h, Math.max(sectionEnd, now + 0.1));
        pending.sort((a, b) => a.time - b.time);
      }
      while (pending.length && pending[0].time < until) pending.shift()!.play();
    },
    resume(time) {
      pending = [];
      sectionEnd = time + 0.3;
    },
    retire() {
      retiring = true;
      // Finish the phrase under way, and no more.
      const cut = pending.find(e => e.time > ctx.currentTime && e.cadence);
      if (cut) pending = pending.filter(e => e.time <= cut.time);
    },
    done: () => retiring && pending.length === 0,
    piece: () => nowPiece,
    busy: () => nowMidi && pending.some(e => e.time > ctx.currentTime + 1.5),
  };
}
