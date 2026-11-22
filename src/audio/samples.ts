/**
 * Sampled instruments: single notes recorded from a soundfont (see scripts/fetch_samples.py), one every
 * minor third, bent to the notes between. Loaded the first time a tradition that plays them is heard; until
 * then the music plays the synthesised voice of the same family.
 */

interface Manifest {
  credit: string;
  instruments: Record<string, {notes: number[]; held: boolean; gain: number}>;
}

const NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const noteName = (m: number) => `${NAMES[m % 12]}${Math.floor(m / 12) - 1}`;

/** Where the samples are served from: beside the data, under audio/. */
const audioUrl = (path: string) => `${import.meta.env.BASE_URL}audio/${path}`;

export interface SampleNote {
  hz: number;
  time: number;
  dur: number;
  strength: number;
  pan: number;
  /** Stop the string at the note's end (a tremolo's strokes), rather than let it ring. */
  damp?: boolean;
  /** Bow or breathe it in slowly and let it go slowly: a pad, a swell, not a struck note. */
  swell?: boolean;
}

export class Samples {
  private manifest: Promise<Manifest | null> | null = null;
  private loaded = new Map<string, {notes: number[]; buffers: AudioBuffer[]; held: boolean; gain: number}>();
  private loading = new Map<string, Promise<boolean>>();
  /** Every fetch still under way, so an offline render can wait for its instruments rather than stand in for them. */
  private pending = new Set<Promise<unknown>>();

  private track<T>(p: Promise<T>): Promise<T> {
    this.pending.add(p);
    void p.finally(() => this.pending.delete(p));
    return p;
  }

  /** Resolves once nothing is loading (including what finishing loads start). */
  async settled(): Promise<void> {
    while (this.pending.size) await Promise.allSettled([...this.pending]);
    // What a load's own .then does with it (parsing a MIDI piece) runs before this returns.
    await null;
  }

  constructor(
    private ctx: BaseAudioContext,
    private fetcher: (url: string) => Promise<ArrayBuffer> = url => fetch(url).then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(url)))),
  ) {}

  private getManifest() {
    this.manifest ??= this.fetcher(audioUrl('samples.json'))
      .then(b => JSON.parse(new TextDecoder().decode(b)) as Manifest)
      .catch(() => null);
    return this.manifest;
  }

  /** Whether an instrument's notes are ready to play. */
  ready(id: string): boolean {
    return this.loaded.has(id);
  }

  /** Start loading an instrument; resolves true when it can play. */
  load(id: string): Promise<boolean> {
    let p = this.loading.get(id);
    if (p) return p;
    p = this.getManifest().then(async m => {
      const spec = m?.instruments[id];
      if (!spec) return false;
      try {
        const buffers = await Promise.all(spec.notes.map(n => this.fetcher(audioUrl(`${id}/${noteName(n)}.mp3`)).then(b => this.ctx.decodeAudioData(b))));
        this.loaded.set(id, {notes: spec.notes, buffers, held: spec.held, gain: spec.gain});
        return true;
      } catch {
        return false;
      }
    });
    this.loading.set(id, p);
    return this.track(p);
  }

  /** Play a note on a loaded instrument; false if it is not loaded yet. */
  play(id: string, dest: AudioNode, n: SampleNote): boolean {
    const inst = this.loaded.get(id);
    if (!inst) return false;
    const ctx = this.ctx;
    const midi = 69 + 12 * Math.log2(n.hz / 440);
    let k = 0;
    for (let i = 1; i < inst.notes.length; i++) if (Math.abs(inst.notes[i] - midi) < Math.abs(inst.notes[k] - midi)) k = i;
    const buffer = inst.buffers[k];
    const rate = 2 ** ((midi - inst.notes[k]) / 12);
    const level = inst.gain * n.strength;
    const t = n.time;
    const pan = ctx.createStereoPanner();
    pan.pan.value = n.pan;
    pan.connect(dest);
    // A held instrument stops with the note; a plucked one rings on, damped a little after.
    const held = inst.held || n.damp;
    const end = held ? t + Math.max(0.08, n.dur) : t + Math.max(0.6, n.dur) + 1.2;
    const release = held ? (n.swell ? 0.5 : 0.06) : 0.35;
    // A recorded note lasts about three seconds; a longer held note is carried on by fresh copies of its
    // sustain, each faded in over the last, so a string chord can be held for a whole line.
    const usable = buffer.duration / rate - 0.35;
    const attack = n.swell ? Math.min(1.2, Math.max(0.15, n.dur * 0.35)) : 0.006;
    let at = t;
    let offset = 0;
    let first = true;
    while (at < end) {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = rate;
      const gain = ctx.createGain();
      const fadeIn = first ? attack : 0.5;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(level, at + fadeIn);
      const segEnd = held ? Math.min(end, at + usable - offset / rate) : end;
      const last = !held || segEnd >= end - 1e-3;
      if (last) gain.gain.setTargetAtTime(0, end, release);
      else {
        gain.gain.setValueAtTime(level, segEnd - 0.5);
        gain.gain.linearRampToValueAtTime(0, segEnd);
      }
      src.connect(gain).connect(pan);
      src.start(at, offset);
      src.stop(last ? end + release * 6 + 0.2 : segEnd + 0.02);
      if (last) break;
      // The next copy starts in the sustain, past the bow's or breath's attack, as this one fades.
      first = false;
      at = segEnd - 0.5;
      offset = 0.4;
    }
    return true;
  }

  /** Fetch a file served beside the samples (a MIDI piece), or null. */
  file(path: string): Promise<ArrayBuffer | null> {
    return this.track(this.fetcher(audioUrl(path)).catch(() => null));
  }

  /** Decode a whole recording (for traditions heard from a recording rather than composed). */
  async recording(path: string): Promise<AudioBuffer | null> {
    try {
      return await this.ctx.decodeAudioData(await this.fetcher(audioUrl(path)));
    } catch {
      return null;
    }
  }
}
