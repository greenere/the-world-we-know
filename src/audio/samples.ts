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
}

export class Samples {
  private manifest: Promise<Manifest | null> | null = null;
  private loaded = new Map<string, {notes: number[]; buffers: AudioBuffer[]; held: boolean; gain: number}>();
  private loading = new Map<string, Promise<boolean>>();

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
    return p;
  }

  /** Play a note on a loaded instrument; false if it is not loaded yet. */
  play(id: string, dest: AudioNode, n: SampleNote): boolean {
    const inst = this.loaded.get(id);
    if (!inst) return false;
    const ctx = this.ctx;
    const midi = 69 + 12 * Math.log2(n.hz / 440);
    let k = 0;
    for (let i = 1; i < inst.notes.length; i++) if (Math.abs(inst.notes[i] - midi) < Math.abs(inst.notes[k] - midi)) k = i;
    const src = ctx.createBufferSource();
    src.buffer = inst.buffers[k];
    src.playbackRate.value = 2 ** ((midi - inst.notes[k]) / 12);
    const gain = ctx.createGain();
    const level = inst.gain * n.strength;
    const t = n.time;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(level, t + 0.006);
    // A held instrument stops with the note; a plucked one rings on, damped a little after.
    const end = inst.held || n.damp ? t + Math.max(0.08, n.dur) : t + Math.max(0.6, n.dur) + 1.2;
    gain.gain.setTargetAtTime(0, end, inst.held || n.damp ? 0.06 : 0.35);
    const pan = ctx.createStereoPanner();
    pan.pan.value = n.pan;
    src.connect(gain).connect(pan).connect(dest);
    src.start(t);
    src.stop(end + 1.5);
    return true;
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
