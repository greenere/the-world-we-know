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
  let pending: Event[] = [];
  let sectionEnd = start;
  let section = 0;
  let tuneIndex = 0;
  let nowPiece: string | null = null;
  let still = true;
  let retiring = false;
  let own: Hearing | null = null;
  let lastMelody = '';

  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
  const pan = () => (rand() - 0.5) * 0.6;

  /** Sound one note on a member of the ensemble: its samples once loaded, its synthesised voice until then. */
  const sound = (m: Member, cents: number, time: number, dur: number, strength: number) => {
    if (m.drum) return drum(m.drum, time, strength * (m.gain ?? 1));
    const c = cents + 1200 * (m.octave ?? 0);
    const hz = hzOf(c);
    const level = strength * (m.gain ?? 1);
    const p = pan();
    const one = (t: number, s: number, d: number, damp = false) => {
      if (m.sample && samples.play(m.sample, out, {hz, time: t, dur: d, strength: s, pan: p, damp})) return;
      voices.play(m.voice, out, {hz, time: t, dur: d, strength: s, pan: p});
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
    g.connect(out);
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
  const playMidi = (h: Hearing, piece: MidiPiece, t0: number, softly: boolean): number => {
    const stop = softly ? piece.markers.find(m => m.text === 'cadence')?.time ?? piece.length : piece.length;
    const members = new Map((h.ensemble ?? []).map(m => [m.id, m]));
    for (const tr of piece.tracks) {
      const m = members.get(tr.name);
      if (!m) continue;
      for (const n of tr.notes) {
        if (n.time >= stop) break;
        const time = t0 + n.time;
        const cents = (n.pitch - TONIC_MIDI) * 100 - 1200 * (m.octave ?? 0);
        const s = (n.velocity / 127) * (softly ? 0.6 : 1);
        at(time, () => sound(m, cents, time, n.dur, s));
      }
    }
    for (const mk of piece.markers) if (mk.time <= stop) at(t0 + mk.time, () => {}, true);
    return t0 + stop + 1;
  };
  let midiStep = 0;

  const plan = (h: Hearing, t0: number): number => {
    const tunes = h.tunes ?? [];
    const motifs = (h.motifs ?? []).map(m => parseNotes(m, 0));
    const tune = tunes.length ? tunes[tuneIndex % tunes.length] : undefined;
    if (tune?.midi) {
      // A MIDI piece is played whole, then the players improvise before the next piece.
      const piece = midiPiece(samples, tune.midi);
      // Still loading (a few kilobytes): wait a moment rather than start something else.
      if (piece === undefined) return t0 + 0.4;
      if (piece === null) {
        tuneIndex++;
        return t0 + 0.5;
      }
      if (!h.moving) {
        nowPiece = tune.id;
        return playMidi(h, piece, t0, true) + 6 + rand() * 6;
      }
      if (midiStep === 0) {
        midiStep = 1;
        nowPiece = tune.id;
        return playMidi(h, piece, t0, false);
      }
      midiStep = 0;
      tuneIndex++;
      nowPiece = null;
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
      }
      // The year has moved out of the piece's era: finish the line under way and take up the new era's music.
      if (!retiring && nowPiece && !(h.tunes ?? []).some(t => t.id === nowPiece)) {
        const cut = pending.filter(e => e.time > now + 0.05).find(e => e.cadence);
        if (cut) pending = pending.filter(e => e.time <= cut.time);
        sectionEnd = cut ? cut.time + 1.2 : Math.min(sectionEnd, now + 0.5);
        nowPiece = null;
        tuneIndex = 0;
        section = 0;
        midiStep = 0;
      }
      // A change between running and standing still is heard at the next phrase's end, not after the piece.
      if (still !== !h.moving) {
        still = !h.moving;
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
  };
}
