/**
 * A small reader for Standard MIDI Files: the notes of each named track, in seconds, and the markers.
 * Enough for the atlas's pieces (scripts/make_midi.py) and for files made in any notation program.
 */

export interface MidiNote {
  time: number;
  dur: number;
  pitch: number;
  velocity: number;
}

export interface MidiPiece {
  tracks: {name: string; notes: MidiNote[]}[];
  markers: {time: number; text: string}[];
  /** Seconds to the last event. */
  length: number;
}

export function parseMidi(buf: ArrayBuffer): MidiPiece {
  const b = new DataView(buf);
  const text = (o: number, n: number) => new TextDecoder().decode(new Uint8Array(buf, o, n));
  if (text(0, 4) !== 'MThd') throw new Error('not a MIDI file');
  const ntracks = b.getUint16(10);
  const tpq = b.getUint16(12);
  let i = 8 + b.getUint32(4);
  // First pass: every event with its tick, so the tempo map (often on its own track) applies to all.
  type Raw = {tick: number; track: number; kind: 'on' | 'off' | 'tempo' | 'marker' | 'name'; a: number; b: number; s?: string};
  const raw: Raw[] = [];
  for (let tr = 0; tr < ntracks; tr++) {
    if (text(i, 4) !== 'MTrk') throw new Error('bad track');
    const end = i + 8 + b.getUint32(i + 4);
    let j = i + 8;
    let tick = 0;
    let status = 0;
    const vlq = () => {
      let v = 0;
      for (;;) {
        const c = b.getUint8(j++);
        v = (v << 7) | (c & 0x7f);
        if (!(c & 0x80)) return v;
      }
    };
    while (j < end) {
      tick += vlq();
      let st = b.getUint8(j);
      if (st & 0x80) j++;
      else st = status;
      if (st === 0xff) {
        const type = b.getUint8(j++);
        const len = vlq();
        if (type === 0x51) raw.push({tick, track: tr, kind: 'tempo', a: (b.getUint8(j) << 16) | (b.getUint8(j + 1) << 8) | b.getUint8(j + 2), b: 0});
        else if (type === 0x03) raw.push({tick, track: tr, kind: 'name', a: 0, b: 0, s: text(j, len)});
        else if (type === 0x06 || type === 0x01) raw.push({tick, track: tr, kind: 'marker', a: 0, b: 0, s: text(j, len)});
        j += len;
      } else if (st === 0xf0 || st === 0xf7) {
        j += vlq();
      } else {
        status = st;
        const hi = st & 0xf0;
        const d1 = b.getUint8(j++);
        const d2 = hi === 0xc0 || hi === 0xd0 ? 0 : b.getUint8(j++);
        if (hi === 0x90 && d2 > 0) raw.push({tick, track: tr, kind: 'on', a: d1, b: d2});
        else if (hi === 0x80 || (hi === 0x90 && d2 === 0)) raw.push({tick, track: tr, kind: 'off', a: d1, b: 0});
      }
    }
    i = end;
  }
  // Ticks to seconds through the tempo map.
  const tempos = raw.filter(e => e.kind === 'tempo').sort((x, y) => x.tick - y.tick);
  const seconds = (tick: number) => {
    let t = 0;
    let last = 0;
    let us = 500000;
    for (const e of tempos) {
      if (e.tick >= tick) break;
      t += ((e.tick - last) / tpq) * (us / 1e6);
      last = e.tick;
      us = e.a;
    }
    return t + ((tick - last) / tpq) * (us / 1e6);
  };
  const tracks: MidiPiece['tracks'] = Array.from({length: ntracks}, (_, k) => ({name: raw.find(e => e.track === k && e.kind === 'name')?.s ?? `track ${k}`, notes: []}));
  const open = new Map<string, {time: number; velocity: number}[]>();
  let length = 0;
  const markers: MidiPiece['markers'] = [];
  for (const e of [...raw].sort((x, y) => x.tick - y.tick || (x.kind === 'off' ? -1 : 1))) {
    const t = seconds(e.tick);
    length = Math.max(length, t);
    if (e.kind === 'marker') markers.push({time: t, text: e.s ?? ''});
    else if (e.kind === 'on') {
      const key = `${e.track}:${e.a}`;
      if (!open.has(key)) open.set(key, []);
      open.get(key)!.push({time: t, velocity: e.b});
    } else if (e.kind === 'off') {
      const on = open.get(`${e.track}:${e.a}`)?.shift();
      if (on) tracks[e.track].notes.push({time: on.time, dur: Math.max(0.02, t - on.time), pitch: e.a, velocity: on.velocity});
    }
  }
  for (const tr of tracks) tr.notes.sort((x, y) => x.time - y.time);
  return {tracks: tracks.filter(t => t.notes.length), markers, length};
}
