// Capture mode (?capture=1): the map alone, framed for a video, with a title, a large year and, for a journey,
// its sketches. The mode also drives the playback itself, so scripts/record.mjs only has to advance the clock
// one frame at a time and take a picture. Everything here is timed by the frame's dt, never by CSS
// transitions, so the video is smooth however slowly the frames are drawn.

import type {PaddingOptions} from 'maplibre-gl';
import {createScore, type Hearing} from './audio/music';
import type {AppData} from './data';
import {dataUrl, loadPictures} from './data';
import {t, tx} from './i18n';
import type {JourneyGeo} from './journey-geo';
import {legDuration, stepCount} from './journey-geo';
import type {State, Store} from './state';
import {formatYear, PRESENT, yearOf, yearParts} from './time';
import type {Depiction} from './types';
import {h} from './ui/dom';
import {scaleFor} from './ui/timeline';

export interface CaptureOptions {
  /** Seconds the time-lapse takes from `from` to `to`, holds aside. */
  seconds: number;
  /** The time-lapse's last year. */
  to: number;
  /** Seconds held on the opening frame, and on the last. */
  intro: number;
  outro: number;
  /** A journey: seconds held at a stop that has a sketch (at least: a story is held long enough to read),
   * and at one that has none. */
  sketch: number;
  pause: number;
  /** A journey: how much faster than the app's own pace the traveller moves between stops. */
  travel: number;
  /** A journey: the whole video faster (or slower) by this factor, both the holds on the sketches and the
   * travel between stops. At 1 each story is held long enough to read in full. */
  pace: number;
  /** A journey: the last stop to travel to (1-based, as in ?stop=), or the whole journey. */
  until: number | null;
  /** A journey: its sketchbook on a plate beside the map (?sketches=0 for the map alone, each stop's note
   * under its place instead, held long enough to read). */
  sketches: boolean;
  /** Under a journey's sketch: its caption (the story of the scene), the stop's one-line note, or nothing. */
  story: 'caption' | 'note' | 'none';
  /** Shown small in a corner. Empty for none. */
  credit: string;
  /** A journey followed (view=follow): the camera's zoom, in place of the app's close one. */
  zoom: number | null;
  /** The video has the atlas's music: its credit is shown at the end. */
  music: boolean;
}

export function captureOptions(): CaptureOptions | null {
  const q = new URLSearchParams(location.search);
  if (q.get('capture') !== '1') return null;
  const num = (k: string, d: number) => (q.has(k) && Number.isFinite(Number(q.get(k))) ? Number(q.get(k)) : d);
  return {
    seconds: num('seconds', 40),
    to: num('to', PRESENT),
    intro: num('intro', 1.5),
    outro: num('outro', 3.5),
    sketch: num('sketch', 2.6),
    pause: num('pause', 0.5),
    travel: num('travel', 1.6),
    pace: Math.max(0.25, num('pace', 1)),
    until: q.has('until') ? num('until', 0) : null,
    sketches: q.get('sketches') !== '0',
    story: q.get('story') === 'note' ? 'note' : q.get('story') === 'none' ? 'none' : 'caption',
    credit: q.get('credit') ?? 'greenere.github.io/the-world-we-know',
    zoom: q.has('zoom') ? num('zoom', 3) : null,
    music: q.get('music') === '1',
  };
}

export interface CaptureHost {
  data: AppData;
  store: Store;
  geo(id: string | null): JourneyGeo | null;
  /** The app's seconds to play the whole timeline at 1×. */
  playSeconds: number;
  /** What the music should play now, as the app would hear it. */
  hearing(): Hearing;
}

/** An opacity eased towards a target, frame by frame. */
class Fade {
  value = 0;
  target = 0;
  constructor(
    private el: HTMLElement,
    private rate = 4,
  ) {
    el.style.opacity = '0';
  }
  step(dt: number) {
    const v = this.value + Math.sign(this.target - this.value) * Math.min(Math.abs(this.target - this.value), dt * this.rate);
    if (v !== this.value) {
      this.value = v;
      this.el.style.opacity = v.toFixed(3);
    }
  }
}

type Phase = 'intro' | 'play' | 'hold' | 'travel' | 'outro' | 'done';

export class Capture {
  /** Read by the recorder after every frame. */
  done = false;
  /** Nothing moves until the recorder starts: the page loads in real time before the virtual clock takes over. */
  private started = false;
  private phase: Phase = 'intro';
  private clock = 0;
  private el: HTMLElement;
  private head: HTMLElement;
  private foot: HTMLElement;
  private yearNum = h('span.cap-year-num');
  private yearEra = h('span.cap-year-era');
  private captionEl = h('div.cap-caption');
  private captionFade: Fade;
  private captionUntil = 0;
  private headFade: Fade;
  private plate: HTMLElement | null = null;
  private plateImgs: HTMLImageElement[] = [];
  private plateFades: Fade[] = [];
  private plateTitle = h('div.cap-plate-title');
  private plateWhere = h('div.cap-plate-where');
  private plateStory = h('p.cap-plate-story');
  /** The words under the sketch dip out and back in when it changes; the next words wait meanwhile. */
  private textFade: Fade | null = null;
  private nextText: [string, string, string] | null = null;
  private plateFade: Fade | null = null;
  private scene: Depiction | null = null;
  private scenes: Depiction[] = [];
  private front = 0;
  private yearShown = '';
  private stop = 0;
  private holdLeft = 0;
  /** The sketches of the stop being held at, and the one on show (it stays up on the road to the next). */
  private pages: Depiction[] = [];
  private page = 0;
  private current: Depiction | null = null;
  private loading: Promise<unknown>;
  /** What the music should play, frame by frame, for the soundtrack rendered afterwards. */
  private heard: {t: number; h: Hearing}[] = [];
  private wav: Uint8Array | null = null;
  private musicCredit: HTMLElement | null = null;
  private musicFade: Fade | null = null;
  /** The map alone (?sketches=0): the stop's note under its place, and the note waiting to replace it. */
  private noteEl: HTMLElement | null = null;
  private noteFade: Fade | null = null;
  private nextNote: string | null = null;

  constructor(
    private host: CaptureHost,
    readonly opts: CaptureOptions,
  ) {
    document.body.classList.add('capture');
    const s = host.store.state;
    const geo = host.geo(s.journey);
    const vp = host.data.vp[s.vps[0]];
    const vpName = tx.viewpoint(vp.id, 'name', vp.name);
    const j = geo?.journey;
    const title = j ? tx.journey(j.id, 'name', j.name) : t('The world as {vp} knew it', {vp: vpName});
    const sub = j ? tx.journey(j.id, 'years', j.years) : t('Fog covers what it did not know');
    // The title card carries the site's address above the title.
    this.head = h('div.cap-head', h('div.cap-kicker', opts.credit || t('The World We Know')), h('div.cap-title', title), h('div.cap-sub', sub));
    // The music's credit fades in under the year at the end, like a closing subtitle.
    if (opts.music) {
      this.musicCredit = h('div.cap-music', t('Music: the atlas’s own, on FluidR3 GM samples (CC BY 3.0)'));
      this.musicFade = new Fade(this.musicCredit, 1.2);
    }
    if (j && !opts.sketches && opts.story !== 'none') {
      this.noteEl = h('div.cap-note');
      this.noteFade = new Fade(this.noteEl, 4);
    }
    this.foot = h('div.cap-foot', h('div.cap-year', this.yearNum, this.yearEra), this.captionEl, this.noteEl, this.musicCredit);
    this.el = h('div.cap', {style: `--vp:${vp.color}`}, this.head, this.foot);
    // The title is up from the first frame: that frame is the video's thumbnail.
    this.headFade = new Fade(this.head, 3);
    this.headFade.value = 1;
    this.head.style.opacity = '1';
    this.captionFade = new Fade(this.captionEl, 3);
    this.loading = Promise.resolve();
    if (j?.pictures && opts.sketches) {
      this.plateImgs = [h('img', {alt: ''}), h('img', {alt: ''})];
      this.plateFades = this.plateImgs.map(img => new Fade(img, 2.5));
      this.plate = h('figure.cap-plate', h('div.cap-plate-img', ...this.plateImgs), h('figcaption', this.plateTitle, this.plateWhere, opts.story === 'none' ? null : this.plateStory));
      this.textFade = new Fade(this.plate.querySelector('figcaption')!, 5);
      this.plateFade = new Fade(this.plate, 2.5);
      this.el.append(this.plate);
      this.loading = loadPictures(host.data, 'journey', j.id).then(doc => {
        // Every page of the sketchbook: a stop with several is held while each is shown in turn.
        this.scenes = doc?.scenes ?? [];
        return Promise.all(this.scenes.map(d => preload(dataUrl(d.img.full))));
      });
    }
    if (geo) this.el.classList.add('cap-journey');
    document.getElementById('app')!.append(this.el);
    this.showYear(s);
  }

  /** Fonts, sketches and the map's first frame: the recorder waits for these before the first picture. */
  async ready(): Promise<void> {
    await this.loading;
    await document.fonts.ready;
  }

  start() {
    this.started = true;
  }

  /**
   * The time-lapse's frame. The title and the year sit in corners, which are nearly always fog, so the known
   * world may pass beside them: only thin bands are kept clear, or the frame would widen at half the height.
   */
  framePadding(): PaddingOptions {
    const W = innerWidth;
    const H = innerHeight;
    const v = Math.round(H * (W > H ? 0.1 : 0.2));
    return {top: v, bottom: v, left: Math.round(W * 0.04), right: Math.round(W * 0.04)};
  }

  /** Room the map's camera must leave for the title, the year and the sketch. */
  padding(): PaddingOptions {
    const W = innerWidth;
    const H = innerHeight;
    const head = this.head.getBoundingClientRect();
    const foot = this.foot.getBoundingClientRect();
    // A route's far end is kept off the frame's edge.
    const side = Math.round(W * 0.05);
    const pad = {top: Math.round(head.bottom + 12), bottom: Math.round(H - foot.top + 12), left: side, right: side};
    if (this.plate) {
      const p = this.plate.getBoundingClientRect();
      if (W > H) pad.right = Math.round(W - p.left + 16);
      else pad.bottom = Math.round(H - p.top + 12);
    }
    return pad;
  }

  /** A moment announced by the timeline (a voyage sets out, a land is lost). */
  caption(text: string, color: string) {
    this.captionEl.textContent = text;
    this.captionEl.style.color = color;
    this.captionFade.target = 1;
    this.captionUntil = this.clock + 3.4;
  }

  /** One frame: move the playback on, then the year, the captions and the sketch. */
  tick(dt: number) {
    if (!this.started) return;
    this.clock += dt;
    const {store} = this.host;
    const s = store.state;
    const geo = this.host.geo(s.journey);
    this.headFade.target = 1;
    if (geo) this.driveJourney(dt, s, geo);
    else this.driveTimeline(s);

    const now = store.state;
    this.showYear(now);
    if (this.clock > this.captionUntil) this.captionFade.target = 0;
    if (geo) this.showScene(geo);
    if (this.musicFade) this.musicFade.target = this.phase === 'outro' || this.phase === 'done' ? 1 : 0;
    // The words change once the old ones are gone (at once for the first sketch, before the plate shows).
    if (this.nextText && this.textFade && (this.textFade.value === 0 || this.plateFade?.value === 0)) {
      [this.plateTitle.textContent, this.plateWhere.textContent, this.plateStory.textContent] = this.nextText;
      this.nextText = null;
      this.textFade.target = 1;
    }
    if (this.nextNote !== null && this.noteEl && this.noteFade!.value === 0) {
      this.noteEl.textContent = this.nextNote;
      this.noteFade!.target = this.nextNote ? 1 : 0;
      this.nextNote = null;
    }
    for (const f of [this.headFade, this.captionFade, this.plateFade, this.textFade, this.musicFade, this.noteFade, ...this.plateFades]) f?.step(dt);
    // Time runs throughout a video, so one theme carries on rather than the two taking turns.
    if (this.opts.music) this.heard.push({t: this.clock, h: {...this.host.hearing(), moving: true}});
  }

  /**
   * The soundtrack, rendered offline from what was heard on each frame: the same score the app plays, paused
   * every 0.12 s (the app's own pace) to be told what to play next, so it lines up with the frames exactly.
   * Kept as a 16-bit WAV for the recorder to fetch with wavChunk().
   */
  async soundtrack(): Promise<number> {
    const rate = 48000;
    const end = this.clock;
    const ctx = new OfflineAudioContext(2, Math.ceil(end * rate), rate);
    const score = createScore(ctx, seeded(20261121));
    const master = ctx.createGain();
    score.out.connect(master).connect(ctx.destination);
    const level = 0.85;
    const fadeOut = Math.min(this.opts.outro, 3);
    master.gain.setValueAtTime(0, 0);
    master.gain.linearRampToValueAtTime(level, 1.2);
    master.gain.setValueAtTime(level, end - fadeOut);
    master.gain.linearRampToValueAtTime(0, end);
    const heard = this.heard;
    let i = 0;
    const at = (t: number) => {
      while (i + 1 < heard.length && heard[i + 1].t <= t) i++;
      return heard[i].h;
    };
    // Every instrument and piece the video will call for, loaded before the first note.
    const seen = new Set<string>();
    for (const {h} of heard) {
      const key = `${h.style.id}|${h.year === undefined ? '' : Math.round(h.year / 50)}`;
      if (!seen.has(key)) {
        seen.add(key);
        score.preload(h);
      }
    }
    await score.settled();
    const STEP = 0.12;
    const fill = async (t: number) => {
      score.fill(t + 0.4, {...at(t), orchestral: true});
      // Anything the score asked for just now is loaded before the render goes on.
      await score.settled();
    };
    await fill(0);
    const next = (t: number) => {
      if (t >= end) return;
      void ctx.suspend(t).then(async () => {
        await fill(t);
        next(t + STEP);
        void ctx.resume();
      });
    };
    next(STEP);
    const buffer = await ctx.startRendering();
    this.wav = encodeWav(buffer);
    return Math.ceil(this.wav.length / WAV_CHUNK);
  }

  /** One piece of the rendered WAV, base64-encoded. */
  wavChunk(n: number): string {
    const part = this.wav!.subarray(n * WAV_CHUNK, (n + 1) * WAV_CHUNK);
    let s = '';
    for (let k = 0; k < part.length; k += 0x8000) s += String.fromCharCode(...part.subarray(k, k + 0x8000));
    return btoa(s);
  }

  private driveTimeline(s: State) {
    const {store} = this.host;
    if (this.phase === 'intro' && this.clock >= this.opts.intro) {
      const sc = scaleFor(s);
      const to = Math.min(sc.max, this.opts.to);
      const span = sc.toX(to) - sc.toX(s.year);
      this.phase = 'play';
      store.set({playing: true, speed: (this.host.playSeconds * span) / Math.max(1, this.opts.seconds)});
    } else if (this.phase === 'play') {
      const to = Math.min(scaleFor(s).max, this.opts.to);
      if (s.year >= to || !s.playing) {
        store.set({playing: false, year: to});
        this.outro();
      }
    } else if (this.phase === 'outro' && this.clock >= this.holdLeft) {
      this.phase = 'done';
      this.done = true;
    }
  }

  private driveJourney(dt: number, s: State, geo: JourneyGeo) {
    const {store} = this.host;
    const last = Math.min(stepCount(geo) - 1, this.opts.until ? this.opts.until - 1 : Infinity);
    switch (this.phase) {
      case 'intro':
        // From the stop the link opens at (?stop=), or the first.
        if (this.clock >= this.opts.intro) this.arrive(Math.floor(s.progress + 1e-6));
        break;
      case 'hold':
        this.holdLeft -= dt;
        if (this.holdLeft > 0) break;
        if (this.page + 1 < this.pages.length) {
          this.page++;
          this.current = this.pages[this.page];
          this.holdLeft = this.holdFor(this.current);
        } else if (this.stop >= last) this.outro();
        else this.phase = 'travel';
        break;
      case 'travel': {
        const k = this.stop;
        const dur = k >= geo.stops.length - 1 ? 2.4 : legDuration(geo.legs[k]);
        const next = s.progress + (dt * this.opts.travel * this.opts.pace) / dur;
        if (next >= k + 1) {
          store.set({progress: k + 1});
          this.arrive(k + 1);
        } else store.set({progress: next});
        break;
      }
      case 'outro':
        if (this.clock >= this.holdLeft) {
          this.phase = 'done';
          this.done = true;
        }
        break;
    }
  }

  private arrive(k: number) {
    this.stop = k;
    this.phase = 'hold';
    this.pages = this.scenes.filter(d => (d.stop ?? 0) === k);
    this.page = 0;
    if (this.pages.length) this.current = this.pages[0];
    this.holdLeft = this.pages.length ? this.holdFor(this.pages[0]) : this.opts.pause / this.opts.pace;
    if (this.noteEl) {
      // The map alone: the stop's note is what there is to read, so the stop is held for it.
      const geo = this.host.geo(this.host.store.state.journey)!;
      const note = geo.stops[k]?.stop.note ? tx.stop(geo.journey.id, k, 'note', geo.stops[k].stop.note!) : '';
      this.nextNote = note;
      this.noteFade!.target = 0;
      if (note) this.holdLeft = this.holdText(note);
    }
  }

  /** Long enough to read the story under a sketch, at about four and a half words a second. */
  private holdFor(d: Depiction): number {
    return this.holdText(this.story(d));
  }

  private holdText(story: string): number {
    const words = story ? story.split(/\s+/).length : 0;
    return Math.max(this.opts.sketch, Math.min(12, 1.2 + words / 4.5)) / this.opts.pace;
  }

  /** What the plate says under a scene: its caption, or its stop's note. */
  private story(d: Depiction): string {
    const s = this.host.store.state;
    const j = this.host.geo(s.journey)?.journey;
    if (!j || this.opts.story === 'none') return '';
    const k = d.stop ?? 0;
    if (this.opts.story === 'note') return tx.stop(j.id, k, 'note', this.host.geo(j.id)!.stops[k]?.stop.note ?? '');
    const vp = s.vps[0];
    return tx.depiction(`journey/${j.id}`, d.id, 'caption', d.captions?.[vp] ?? d.caption, vp);
  }

  private outro() {
    this.phase = 'outro';
    this.holdLeft = this.clock + this.opts.outro;
  }

  private showYear(s: State) {
    const geo = this.host.geo(s.journey);
    const y = yearOf(s.year);
    let where = '';
    if (geo) {
      const k = Math.min(geo.stops.length - 1, Math.floor(s.progress + 1e-6));
      const st = geo.stops[k];
      where = shortPlace(tx.stop(geo.journey.id, k, 'place', st.stop.place ?? ''));
    }
    const key = `${y}|${where}`;
    if (key === this.yearShown) return;
    this.yearShown = key;
    const p = yearParts(y);
    this.yearNum.textContent = p.num;
    this.yearEra.textContent = p.era;
    this.el.classList.toggle('cap-era-pre', !!p.pre);
    this.yearEra.hidden = !p.era;
    if (geo) {
      this.captionEl.textContent = where;
      this.captionEl.style.color = '';
      this.captionFade.target = where ? 1 : 0;
      this.captionUntil = Infinity;
    }
  }

  /** The sketch on show, cross-faded when it changes. */
  private showScene(geo: JourneyGeo) {
    const d = this.current;
    if (!this.plate || !d) return;
    this.plateFade!.target = 1;
    if (d === this.scene) return;
    this.scene = d;
    this.front = 1 - this.front;
    const img = this.plateImgs[this.front];
    img.src = dataUrl(d.img.full);
    this.plateFades[this.front].target = 1;
    this.plateFades[1 - this.front].target = 0;
    // The newer picture sits on top while it fades in.
    img.style.zIndex = '2';
    this.plateImgs[1 - this.front].style.zIndex = '1';
    const j = geo.journey;
    const k = d.stop ?? 0;
    const st = geo.stops[k];
    const date = st?.stop.date ? tx.stop(j.id, k, 'date', st.stop.date) : formatYear(st?.year ?? 0);
    this.nextText = [tx.depiction(`journey/${j.id}`, d.id, 'title', d.title), `${shortPlace(tx.stop(j.id, k, 'place', d.place ?? ''))} · ${date}`, this.story(d)];
    this.textFade!.target = 0;
  }
}

const WAV_CHUNK = 1 << 21;

/** A repeatable random sequence (mulberry32), so a video renders with the same music each time. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function encodeWav(b: AudioBuffer): Uint8Array {
  const ch = b.numberOfChannels;
  const n = b.length;
  const out = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const str = (o: number, s: string) => [...s].forEach((c, k) => out.setUint8(o + k, c.charCodeAt(0)));
  str(0, 'RIFF');
  out.setUint32(4, 36 + n * ch * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, ch, true);
  out.setUint32(24, b.sampleRate, true);
  out.setUint32(28, b.sampleRate * ch * 2, true);
  out.setUint16(32, ch * 2, true);
  out.setUint16(34, 16, true);
  str(36, 'data');
  out.setUint32(40, n * ch * 2, true);
  const data = [...Array(ch)].map((_, c) => b.getChannelData(c));
  let o = 44;
  for (let k = 0; k < n; k++) {
    for (let c = 0; c < ch; c++) {
      const v = Math.max(-1, Math.min(1, data[c][k]));
      out.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      o += 2;
    }
  }
  return new Uint8Array(out.buffer);
}

const shortPlace = (p: string) => p.replace(/\s*[(（].*[)）]$/, '');

function preload(src: string): Promise<void> {
  const img = new Image();
  img.src = src;
  return img.decode().catch(() => undefined);
}
