import {cellToLatLng} from 'h3-js';
import {type Map as MlMap, MercatorCoordinate, type PaddingOptions} from 'maplibre-gl';
import type {FogField} from '../fog/field';
import type {Grid} from '../fog/grid';
import type {VpId} from '../types';

/** Charted or better, the land the fog has visibly lifted from: contact still lies under most of it, and a
 * rumour alone (Rome's Seres) would stretch the frame across Eurasia. */
const KNOWN = 3;
/** The farthest few per cent of known cells on each side stay out of the frame. */
const TRIM = 0.03;
/** Framed, the known world fills about this share of the view, so the unknown around it stays in sight… */
const FILL = 0.6;
/** …and the frame widens once the known world fills more than this, or spills out of the view. */
const OUTGROWN = 0.85;
const MAX_ZOOM = 4.5;
/** Mercator's poles would swell any frame that reached them: the Norse in Greenland would size Europe's
 * frame to the whole world centuries before the Americas. */
const LAT_LIMIT: [number, number] = [-58, 70];
/** A frame round the whole world shows the known band of latitudes, from the Arctic coasts down to the
 * southern capes (Cape Town, Sydney, Buenos Aires), with home as near its centre as that allows. */
const WORLD_NORTH = 70;
const WORLD_SOUTH = -46;
/** On a wide, short screen the band would not fit one world's width: the frame may draw back this much
 * further (zoom levels), showing a sliver of the map's next copy at each side, rather than cut the south off. */
const WORLD_SLACK = 0.4;
/** A known world with no empty stretch of longitude this wide circles the globe: it centres on home. */
const GLOBAL_GAP = 60;
const CHECK_MS = 500;
const EASE_MS = 2200;

interface Box {
  w: number;
  e: number;
  s: number;
  n: number;
  /** Known all the way round: framed on home, not on the box. */
  global?: boolean;
}

const mercY = (lat: number) => MercatorCoordinate.fromLngLat({lng: 0, lat}).y;
const latOfY = (y: number) => new MercatorCoordinate(0, y, 0).toLngLat().lat;

/**
 * The auto camera's widening frame: the camera opens on what the viewpoint knows and steps outward as that
 * grows. It never closes in until reset, so a forgotten land (Cathay after 1400) leaves the frame where it
 * was, and the fog pulling back stays visible against a still map between steps.
 */
export class WideningFrame {
  private lon: Float32Array | null = null;
  private lat: Float32Array | null = null;
  private started = false;
  private nextCheck = 0;
  /** How much of the view the framed known world fills, and how full it may grow before the frame widens. */
  fillTo = FILL;
  outgrown = OUTGROWN;

  constructor(
    private grid: Grid,
    private field: FogField,
    private map: MlMap,
  ) {}

  /** A new run: the next update frames the known world afresh. */
  reset() {
    this.started = false;
    this.nextCheck = 0;
  }

  update(vps: VpId[], year: number, home: {lon: number; lat: number}, padding: PaddingOptions, globe: boolean, now: number) {
    if (now < this.nextCheck) return;
    this.nextCheck = now + CHECK_MS;
    const box = this.knownBox(vps, year, home.lon);
    if (!box) return;
    const {map} = this;
    const zoom = map.getZoom();
    if (box.global && !globe) {
      this.frameWorld(home, padding, box);
      return;
    }
    if (this.started) {
      const fill = this.fill(box, padding);
      if (fill === null || fill <= this.outgrown) return;
    }
    const cam = map.cameraForBounds(
      [
        [box.w, box.s],
        [box.e, box.n],
      ],
      {padding},
    );
    if (!cam || cam.zoom === undefined || !cam.center) return;
    // The globe turns to the known world rather than zooming; the flat map never closes in within a run.
    // Never so far out that the flat map repeats: one world (512 px at zoom 0) spans the view at the widest.
    const widest = Math.max(map.getMinZoom(), Math.log2(map.getContainer().clientWidth / 512));
    let next = Math.min(MAX_ZOOM, Math.max(widest, cam.zoom + Math.log2(this.fillTo)));
    if (globe) next = zoom;
    else if (this.started) next = Math.min(next, zoom);
    this.started = true;
    this.nextCheck = now + EASE_MS + CHECK_MS;
    map.easeTo({center: cam.center, zoom: next, padding, duration: EASE_MS});
  }

  /**
   * The whole world, with home at the centre: on its own longitude, and on its own latitude as far as the
   * view allows without passing Cape Horn or the Arctic coasts (a Mercator world centred on the equator
   * would push Europe to the top edge and spend a third of the picture on the Southern Ocean).
   */
  private frameWorld(home: {lon: number; lat: number}, padding: PaddingOptions, box: Box) {
    const {map} = this;
    const el = map.getContainer();
    const h = el.clientHeight;
    const top = padding.top ?? 0;
    const bottom = padding.bottom ?? 0;
    const room = Math.max(40, h - top - bottom);
    // The band to show: what is known, from the Arctic coasts to the southern capes.
    const yN = mercY(Math.min(box.n, WORLD_NORTH));
    const yS = mercY(Math.max(box.s, WORLD_SOUTH));
    // One world across the width, or a little further out if the band would not fit the height.
    const across = Math.log2(el.clientWidth / 512);
    const fits = Math.log2(room / (512 * (yS - yN)));
    const zoom = Math.max(map.getMinZoom(), across - WORLD_SLACK, Math.min(across, fits));
    const world = 512 * 2 ** zoom;
    // Home at the centre, moved only as far as keeps the band inside the padded view; a band taller than
    // the view loses as much at the top as at the bottom.
    const half = room / 2 / world;
    const lo = yN + half;
    const hi = yS - half;
    const y = lo <= hi ? Math.max(lo, Math.min(hi, mercY(home.lat))) : (lo + hi) / 2;
    const center: [number, number] = [home.lon, latOfY(y)];
    const c = map.getCenter();
    if (this.started && Math.abs(zoom - map.getZoom()) < 0.01 && Math.abs(((c.lng - center[0] + 540) % 360) - 180) < 0.5 && Math.abs(c.lat - center[1]) < 0.5) return;
    this.started = true;
    this.nextCheck = performance.now() + EASE_MS + CHECK_MS;
    map.easeTo({center, zoom, padding, duration: EASE_MS});
  }

  /** How much of the padded view the box fills (1 = edge to edge), or Infinity once any of it spills out. */
  private fill(box: Box, padding: PaddingOptions): number | null {
    const {map} = this;
    const shift = Math.round((map.getCenter().lng - (box.w + box.e) / 2) / 360) * 360;
    const a = map.project([box.w + shift, box.n]);
    const b = map.project([box.e + shift, box.s]);
    if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) return null;
    const el = map.getContainer();
    const left = padding.left ?? 0;
    const right = el.clientWidth - (padding.right ?? 0);
    const top = padding.top ?? 0;
    const bottom = el.clientHeight - (padding.bottom ?? 0);
    if (right - left < 40 || bottom - top < 40) return null;
    const [x0, x1, y0, y1] = [Math.min(a.x, b.x), Math.max(a.x, b.x), Math.min(a.y, b.y), Math.max(a.y, b.y)];
    if (x0 < left || x1 > right || y0 < top || y1 > bottom) return Infinity;
    return Math.max((x1 - x0) / (right - left), (y1 - y0) / (bottom - top));
  }

  /** The trimmed bounds of every cell the viewpoints know at contact or better, unwrapped across 180°. */
  private knownBox(vps: VpId[], year: number, home: number): Box | null {
    this.centres();
    const lon = this.lon!;
    const lat = this.lat!;
    const levels = vps.map(vp => this.field.levelsFor(vp, year).level);
    const xs: number[] = [];
    const ys: number[] = [];
    for (let c = 0; c < this.grid.count; c++) {
      if (!levels.some(l => l[c] >= KNOWN)) continue;
      xs.push(lon[c]);
      ys.push(Math.max(LAT_LIMIT[0], Math.min(LAT_LIMIT[1], lat[c])));
    }
    if (xs.length < 3) return null;
    // Cut the circle of longitudes at its widest empty stretch, so the Pacific is one span, not two.
    xs.sort((a, b) => a - b);
    let cut = xs[0] + 360 - xs[xs.length - 1];
    let start = 0;
    for (let i = 1; i < xs.length; i++) {
      if (xs[i] - xs[i - 1] > cut) {
        cut = xs[i] - xs[i - 1];
        start = i;
      }
    }
    ys.sort((a, b) => a - b);
    const q = (v: number[], f: number) => v[Math.min(v.length - 1, Math.max(0, Math.round(f * (v.length - 1))))];
    const [s, n] = [q(ys, TRIM), q(ys, 1 - TRIM)];
    if (cut < GLOBAL_GAP) return {w: home - 180, e: home + 180, s, n, global: true};
    const unwrapped = xs.map((x, i) => (i < start ? x + 360 : x)).sort((a, b) => a - b);
    return {w: q(unwrapped, TRIM), e: q(unwrapped, 1 - TRIM), s, n};
  }

  private centres() {
    if (this.lon) return;
    const n = this.grid.count;
    this.lon = new Float32Array(n);
    this.lat = new Float32Array(n);
    for (let c = 0; c < n; c++) {
      const [la, lo] = cellToLatLng(this.grid.cells[c]);
      this.lat[c] = la;
      this.lon[c] = lo;
    }
  }
}
