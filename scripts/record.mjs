#!/usr/bin/env node
// Record the atlas in capture mode as an MP4, frame by frame.
//
//   node scripts/record.mjs "vp=europe&year=-2000" -o media/europe.mp4
//   node scripts/record.mjs "journey=polo" --size 1080x1920 -o media/polo-vertical.mp4
//   node scripts/record.mjs "vp=china&year=-2000&lang=zh" --fps 30 --size 1920x1080
//
// The page runs on a virtual clock: each frame moves time on by exactly 1/fps seconds, however long the
// software renderer takes to draw it, so the video plays smoothly at full speed. Capture options (seconds, to,
// sketch, travel, until, credit…) go in the query; see src/capture.ts.

import {spawn} from 'node:child_process';
import {mkdirSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {parseArgs} from 'node:util';
import puppeteer from 'puppeteer-core';
import {createServer} from 'vite';

const {values: opt, positionals} = parseArgs({
  allowPositionals: true,
  options: {
    out: {type: 'string', short: 'o'},
    size: {type: 'string', default: '1920x1080'},
    fps: {type: 'string', default: '30'},
    /** Device pixels per CSS pixel: the page is laid out at size/scale. */
    scale: {type: 'string', default: '1.5'},
    /** Stop after this many frames (for a quick test). */
    frames: {type: 'string'},
    /** Save one PNG of the first frame instead of a video. */
    still: {type: 'boolean', default: false},
    /** With --still: the ordinary app, no capture mode and no virtual clock (to compare against). */
    plain: {type: 'boolean', default: false},
    /** No soundtrack (the atlas's music is rendered and muxed in by default). */
    silent: {type: 'boolean', default: false},
    port: {type: 'string', default: '5199'},
    chrome: {type: 'string', default: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'},
  },
});

const query = (positionals[0] ?? 'vp=europe&year=-2000').replace(/^\?/, '');
const [W, H] = opt.size.split('x').map(Number);
const fps = Number(opt.fps);
const scale = Number(opt.scale);
const out = resolve(opt.out ?? `media/${query.replace(/[^a-z0-9-]+/gi, '_')}.${opt.still ? 'png' : 'mp4'}`);
mkdirSync(dirname(out), {recursive: true});

// Installed before any of the page's scripts: performance.now and requestAnimationFrame follow a clock the
// recorder advances. Until start() they keep real time, so the page loads normally.
function virtualClock() {
  const realRaf = window.requestAnimationFrame.bind(window);
  const realNow = performance.now.bind(performance);
  let manual = false;
  let now = 0;
  let queue = [];
  let nextId = 1;
  const cancelled = new Set();
  performance.now = () => (manual ? now : realNow());
  window.requestAnimationFrame = cb => {
    const id = nextId++;
    queue.push({id, cb});
    return id;
  };
  window.cancelAnimationFrame = id => cancelled.add(id);
  const flush = ts => {
    const q = queue;
    queue = [];
    for (const {id, cb} of q) {
      if (cancelled.delete(id)) continue;
      try {
        cb(ts);
      } catch (e) {
        console.error(e);
      }
    }
  };
  const pump = () => {
    if (!manual) flush(realNow());
    realRaf(pump);
  };
  realRaf(pump);
  window.__clock = {
    start() {
      now = realNow();
      manual = true;
    },
    async tick(ms) {
      now += ms;
      flush(now);
      // A second pass at the same moment: deck.gl draws on the frame after the map moves.
      flush(now);
      await new Promise(r => realRaf(() => realRaf(r)));
      return !!window.capture?.done;
    },
  };
}

// The dev server, in this process, on any free port. It does not watch the files: editing the app while a
// video renders must not reload the page halfway through.
const vite = await createServer({root: resolve(dirname(new URL(import.meta.url).pathname), '..'), logLevel: 'error', server: {port: Number(opt.port), watch: null, hmr: false}});
await vite.listen();
const origin = vite.resolvedUrls.local[0].replace(/\/$/, '');

const browser = await puppeteer.launch({
  executablePath: opt.chrome,
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars', '--mute-audio'],
  // Rendering the soundtrack can take a while.
  protocolTimeout: 900_000,
  defaultViewport: {width: Math.round(W / scale), height: Math.round(H / scale), deviceScaleFactor: scale},
});

let ffmpeg = null;
try {
  const page = await browser.newPage();
  page.on('pageerror', e => console.error('[page]', e.message));
  page.on('console', m => m.type() === 'error' && console.error('[console]', m.text()));
  if (!opt.plain) await page.evaluateOnNewDocument(virtualClock);
  // The language is the link's, or English: never the machine's.
  const lang = /(^|&)lang=/.test(query) ? '' : '&lang=en';
  const music = opt.silent || opt.still ? '' : '&music=1';
  const url = `${origin}/?${query}${lang}${opt.plain ? '' : `&capture=1${music}`}`;
  console.log(`Recording ${url} at ${W}×${H}, ${fps} fps → ${out}`);
  await page.goto(url, {waitUntil: 'networkidle0', timeout: 120_000});
  if (opt.plain) {
    await new Promise(r => setTimeout(r, 6000));
    await page.screenshot({path: out, type: 'png'});
    console.log(`Saved ${out}`);
    process.exit(0);
  }
  await page.waitForFunction(() => window.capture && window.atlas?.map?.loaded() && !document.getElementById('loading'), {timeout: 120_000, polling: 250});
  await page.evaluate(() => window.capture.ready());
  // Let the first frame settle: tiles, labels, the fog snapped to its year.
  await new Promise(r => setTimeout(r, 1500));
  await page.evaluate(() => (window.__clock.start(), window.capture.start()));

  if (opt.still) {
    await page.evaluate(ms => window.__clock.tick(ms), 1000 / fps);
    await page.screenshot({path: out, type: 'png'});
    console.log(`Saved ${out}`);
  } else {
    const silentOut = music ? out.replace(/\.mp4$/, '.video.mp4') : out;
    ffmpeg = spawn(
      'ffmpeg',
      ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-', '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', silentOut],
      {stdio: ['pipe', 'inherit', 'inherit']},
    );
    const limit = opt.frames ? Number(opt.frames) : Infinity;
    const t0 = Date.now();
    for (let n = 0; n < limit; n++) {
      const done = await page.evaluate(ms => window.__clock.tick(ms), 1000 / fps);
      const png = await page.screenshot({type: 'png', optimizeForSpeed: true});
      if (!ffmpeg.stdin.write(png)) await new Promise(r => ffmpeg.stdin.once('drain', r));
      if (n % fps === 0) {
        const s = await page.evaluate(() => window.atlas.store.state);
        process.stdout.write(`\r  ${(n / fps).toFixed(0)} s of video · year ${Math.round(s.year)} · ${((Date.now() - t0) / 1000 / Math.max(1, n)).toFixed(2)} s/frame   `);
      }
      if (done) break;
    }
    ffmpeg.stdin.end();
    await new Promise(r => ffmpeg.on('close', r));
    if (music) {
      process.stdout.write('\n  Rendering the soundtrack…');
      const chunks = await page.evaluate(() => window.capture.soundtrack());
      const parts = [];
      for (let n = 0; n < chunks; n++) parts.push(Buffer.from(await page.evaluate(k => window.capture.wavChunk(k), n), 'base64'));
      const wav = out.replace(/\.mp4$/, '.wav');
      writeFileSync(wav, Buffer.concat(parts));
      // The app mixes its music quietly beneath the map; a video is heard beside others, at about -16 LUFS.
      const mux = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-i', silentOut, '-i', wav, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-ar', '48000', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', out], {stdio: 'inherit'});
      const code = await new Promise(r => mux.on('close', r));
      if (code !== 0) throw new Error('ffmpeg could not add the soundtrack');
      rmSync(silentOut);
      renameSync(wav, out.replace(/\.mp4$/, '.soundtrack.wav'));
    }
    console.log(`\nSaved ${out}`);
  }
} finally {
  await browser.close();
  await vite.close();
}
