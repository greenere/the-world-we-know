/**
 * Which music plays: the tradition a viewpoint hears in a year, or, following a journey, the music of the
 * land the traveller is passing through. Authored in data/soundscapes.json.
 */

import type {AppData} from '../data';
import type {Grid} from '../fog/grid';
import {cellAt} from '../fog/grid';
import type {VpId} from '../types';
import type {Ensemble, Member, Tune} from './composer';
import type {Style} from './music';
import type {VoiceName} from './voices';

export interface TraditionVoice {
  voice: VoiceName;
  /** An instrument on the Music shelf: this voice joins once the viewpoint knows it. */
  instrument?: string;
  from?: number;
  until?: number;
}

/** A musical tradition as authored: how it sounds, and what on the map it belongs to. */
export interface Tradition {
  id: string;
  name: string;
  summary: string;
  /** Its scale in cents above the tonic, changing from a year where it did. */
  scales: {from?: number; cents: number[]}[];
  voices: TraditionVoice[];
  pattern: Style['pattern'];
  beat: number;
  leaps?: number;
  ornament?: number;
  glide?: boolean;
  drone?: number;
  tanpura?: boolean;
  gong?: boolean;
  /** Cities and landmarks where it was played. */
  places: string[];
  /** Other things on the Music shelf that belong to it (staff notation, for chant). */
  also?: string[];
  source?: string;
  confidence?: string;
  /** The atlas's own music, for anyone and anywhere without a tradition of their own here. */
  fallback?: boolean;
  /** A composed tradition: who plays (sampled instruments), drum patterns and idiomatic motifs. */
  ensemble?: Ensemble;
  /** Its pieces, with the years they belong to. */
  tunes?: Tune[];
  /** Its themes, each arranged for every age (the tunes with that `theme`): one ceremonial, one folk. */
  themes?: {id: string; name: string; mood: 'ceremonial' | 'folk'; about?: string; source?: string; confidence?: string; credit?: string}[];
  /** Recordings to play instead of composing, when there are some (not yet used). */
  recordings?: {file: string; name: string; source: string; license: string; from?: number; until?: number}[];
}

interface Span {
  from?: number;
  until?: number;
}

export interface Soundscapes {
  traditions: Tradition[];
  /** Which tradition a viewpoint hears, in which years. */
  viewpoints: (Span & {vp: VpId; tradition: string})[];
  /** Whose music is heard in a region, in which years. */
  lands: (Span & {regions: string[]; vp: VpId})[];
}

const within = (s: Span, year: number) => (s.from === undefined || year >= s.from) && (s.until === undefined || year < s.until);

export function fallbackOf(sc: Soundscapes): Tradition {
  return sc.traditions.find(t => t.fallback) ?? sc.traditions[0];
}

/** The tradition a viewpoint hears in a year. */
export function traditionFor(sc: Soundscapes, vp: VpId, year: number): Tradition {
  const rule = sc.viewpoints.find(r => r.vp === vp && within(r, year));
  return (rule && sc.traditions.find(t => t.id === rule.tradition)) || fallbackOf(sc);
}

/** The viewpoint that first hears a tradition: whose instruments it is played on when chosen by name. */
export function homeOf(sc: Soundscapes, id: string): VpId | null {
  return sc.viewpoints.find(r => r.tradition === id)?.vp ?? null;
}

/** Whose music is heard at a point in a year, and the region it lies in; null at sea or beyond the lands named. */
export function landAt(sc: Soundscapes, data: AppData, grid: Grid, lon: number, lat: number, year: number): {vp: VpId; region: string} | null {
  const cell = cellAt(grid, lat, lon);
  if (cell < 0) return null;
  const region = data.regions[grid.region[cell]];
  if (!region) return null;
  const ids = [region.id, ...(region.within ?? [])];
  const rule = sc.lands.find(r => within(r, year) && r.regions.some(id => ids.includes(id)));
  return rule ? {vp: rule.vp, region: region.id} : null;
}

/** Whether a viewpoint knows an instrument on the Music shelf by a year. */
function knows(data: AppData, instrument: string | undefined, vp: VpId | null, year: number): boolean {
  if (!instrument) return true;
  const x = data.livingById.get(instrument);
  const known = x && vp ? x.known[vp] : undefined;
  return known !== undefined && known <= year;
}

/** What a composed tradition can play in a year: the ensemble members `vp` has instruments for, and the
 * pieces that existed by then. */
export function ensembleFor(t: Tradition, data: AppData, vp: VpId | null, year: number): {ensemble?: Member[]; tunes?: Tune[]; motifs?: string[]; percussion?: Record<string, string>; recording?: string} {
  const rec = t.recordings?.find(r => within(r, year));
  if (rec) return {recording: rec.file};
  if (!t.ensemble) return {};
  return {
    ensemble: t.ensemble.members.filter(m => within(m, year) && knows(data, m.instrument, vp, year)),
    tunes: (t.tunes ?? []).filter(x => !x.extra && within(x, year)),
    motifs: t.ensemble.motifs,
    percussion: t.ensemble.percussion,
  };
}

/** How a tradition plays in a year, and which of its voices may play: an instrument's once `vp` knows it. */
export function styleFor(t: Tradition, data: AppData, vp: VpId | null, year: number): {style: Style; voices: VoiceName[]} {
  const scale = [...t.scales].reverse().find(s => s.from === undefined || year >= s.from) ?? t.scales[0];
  const voices = t.voices
    .filter(v => within(v, year))
    .filter(v => knows(data, v.instrument, vp, year))
    .map(v => v.voice);
  return {
    style: {
      id: t.id,
      scale: scale.cents,
      pattern: t.pattern,
      beat: t.beat,
      leaps: t.leaps ?? 0.2,
      ornament: t.ornament ?? 0,
      glide: !!t.glide,
      drone: t.drone ?? 0.6,
      tanpura: !!t.tanpura,
      gong: !!t.gong && voices.includes('metal'),
    },
    voices: voices.length ? [...new Set(voices)] : ['pluck'],
  };
}

/** The instruments on the Music shelf that belong to a tradition: those its voices are played on, and the rest. */
export function instrumentsOf(t: Tradition): string[] {
  const used = [...t.voices.map(v => v.instrument), ...(t.ensemble?.members ?? []).map(m => m.instrument)];
  return [...new Set([...used.filter((x): x is string => !!x), ...(t.also ?? [])])];
}
