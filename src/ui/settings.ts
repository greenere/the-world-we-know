import type {AppData} from '../data';
import {instrumentsOf, type Tradition} from '../audio/choose';
import type {Music} from '../audio/music';
import type {Tune} from '../audio/composer';
import type {VoiceName} from '../audio/voices';
import {nameFor} from '../data';
import {t, tx} from '../i18n';
import {ERAS, formatRange, formatYear, PRESENT} from '../time';
import type {State, Store} from '../state';
import type {VpId} from '../types';
import {h} from './dom';
import {icons, livingIcons, naturalIcons} from './icons';

/** What each voice is called in the list of traditions. */
const VOICE_NAMES: Record<VoiceName, string> = {
  pluck: 'plucked strings',
  lute: 'lute',
  bow: 'bowed strings',
  flute: 'flute',
  reed: 'reed pipe',
  pipe: 'organ',
  voice: 'voice',
  bell: 'bronze bells',
  stone: 'stone chimes',
  metal: 'bronze keys and gong',
  tine: 'iron tines',
  keys: 'keyboard',
  gong: 'gong',
};

const PLAY = '<svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M3 1.8v8.4L10 6z" fill="currentColor"/></svg>';
const STOP = '<svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><rect x="2.5" y="2.5" width="7" height="7" rx="1" fill="currentColor"/></svg>';

/** What the members of a composed tradition's ensemble are called. */
const MEMBER_NAMES: Record<string, string> = {
  kithara: 'kithara',
  tibia: 'tibia',
  hydraulis: 'water organ',
  qin: 'qin',
  xiao: 'xiao',
  pipa: 'pipa',
  huqin: 'huqin',
  bianzhong: 'bronze bells',
  bells: 'bronze bells',
  se: 'se',
  dizi: 'di',
  sheng: 'sheng',
  voices: 'singers',
  bianqing: 'stone chimes',
  tezhong: 'great bell',
  drum: 'drums',
  drum2: 'drums',
  yu: 'tiger-box',
  guanzi: 'guanzi',
  yunluo: 'gong-chimes',
  clapper: 'clappers',
  woodblock: 'wood block',
  suona: 'suona',
  cymbals: 'cymbals',
  gong: 'gong',
  xun: 'xun',
  suling: 'suling',
  angklung: 'angklung',
  nekara: 'bronze drum',
  saron: 'saron',
  saron2: 'saron',
  peking: 'peking',
  bonang: 'bonang',
  gender: 'gender',
  gambang: 'gambang',
  kenong: 'kenong',
  kempul: 'kempul',
  kethuk: 'kethuk',
  kendang: 'kendang',
  rebab: 'rebab',
  sindhen: 'sindhen',
  biola: 'violin',
  keroncong: 'keroncong guitar',
  karimba: 'karimba',
  mbira: 'mbira',
  mbira2: 'mbira',
  hosho: 'hosho',
  clap: 'clapping',
  ngoma: 'ngoma',
  kudu: 'kudu horn',
  marimba: 'marimba',
  guitar: 'guitar',
  phorminx: 'phorminx',
  aulos: 'aulos',
  tympanon: 'tympanon',
  krotala: 'krotala',
  psaltes: 'chanters',
  lyra: 'lyra',
  laouto: 'laouto',
  santouri: 'santouri',
  daouli: 'daouli',
  klarino: 'klarino',
  violi: 'violin',
  bouzouki: 'bouzouki',
  pututu: 'conch trumpet',
  antara: 'antara',
  ocarina: 'ocarina',
  tinya: 'tinya',
  quena: 'quena',
  wankara: 'wankara',
  siku: 'siku',
  bombo: 'bombo',
  arpa: 'Andean harp',
  charango: 'charango',
  lur: 'lur',
  lyre: 'lyre',
  cruit: 'Celtic harp',
  crwth: 'crwth',
  carnyx: 'carnyx',
  tabor: 'tabor',
  virginals: 'virginals',
  zummara: 'reed pipe',
  daf: 'frame drum',
  barbat: 'barbat',
  chang: 'chang harp',
  ney: 'ney',
  oud: 'oud',
  qanun: 'qanun',
  riq: 'riq',
  darbuka: 'darbuka',
  zurna: 'zurna',
  davul: 'davul',
  zil: 'zils',
  kemenche: 'kemenche',
  tsuchibue: 'clay flute',
  wagon: 'wagon',
  kagurabue: 'kagura flute',
  hichiriki: 'hichiriki',
  ryuteki: 'ryūteki',
  sho: 'shō',
  gakuso: 'koto',
  biwa: 'biwa',
  kakko: 'kakko',
  odaiko: 'taiko',
  shakuhachi: 'shakuhachi',
  koto: 'koto',
  shamisen: 'shamisen',
  harmonium: 'harmonium',
  rappa: 'trumpet',
  veena: 'veena',
  venu: 'venu',
  mridangam: 'mridangam',
  nadaswaram: 'nadaswaram',
  sruti: 'drone reed',
  tavil: 'tavil',
  sitar: 'sitar',
  shehnai: 'shehnai',
  sarangi: 'sarangi',
  tabla: 'tabla',
  violin: 'violin',
  bansuri: 'bansuri',
  tanpura: 'tanpura',
  cornu: 'cornu',
  tympanum: 'frame drum',
  crotala: 'clappers',
  cantores: 'singers',
  organum: 'organ',
  campane: 'bells',
  vielle: 'vielle',
  flauto: 'recorder',
  liuto: 'lute',
  viola: 'viol',
  cembalo: 'harpsichord',
  oboe: 'oboe',
  mandolino: 'mandolin',
  tromba: 'trumpet',
  pianoforte: 'piano',
  yangqin: 'yangqin',
  strings: 'strings',
  cello: 'cellos',
  contrabass: 'double basses',
  harp: 'harp',
  horn: 'horns',
  timpani: 'timpani',
  taiko: 'great drum',
};

/**
 * Settings: for now, the music. Turn it on or off and set its level, see what is playing and why, and browse
 * the traditions it plays: hear any one of them, and open the instruments and places each belongs to.
 */
export class Settings {
  el: HTMLElement;
  private switchBtn: HTMLButtonElement;
  private orchestraBtn: HTMLButtonElement;
  private arrangedEls: HTMLElement[] = [];
  private volume: HTMLInputElement;
  private nowEl: HTMLElement;
  private rows = new Map<string, {li: HTMLDetailsElement; listen: HTMLButtonElement}>();
  private pieceRows = new Map<string, {li: HTMLElement; play: HTMLButtonElement; tradition: string; name: string}>();
  /** Each tradition's theme grid: what to say beneath it, for a piece. */
  private shownYear = NaN;
  private details = new Map<string, {show(tu: Tune | undefined): void; tunes: Tune[]; cols: {at: number; cells: HTMLElement[]}[]}>();

  constructor(
    private data: AppData,
    private store: Store,
    private music: Music,
    private actions: {openLiving(id: string): void; openCity(id: string): void},
  ) {
    const close = () => store.set({panel: 'none'});
    this.switchBtn = h('button.switch', {type: 'button', role: 'switch', onclick: () => music.toggle()}, h('span.switch-knob'));
    this.orchestraBtn = h('button.switch', {type: 'button', role: 'switch', onclick: () => music.setOrchestral(!music.orchestral)}, h('span.switch-knob'));
    this.volume = h('input.volume', {
      type: 'range',
      min: '0',
      max: '1',
      step: '0.05',
      value: String(music.volume),
      'aria-label': t('Volume'),
      oninput: (e: Event) => music.setVolume(Number((e.target as HTMLInputElement).value)),
    });
    this.nowEl = h('p.sound-now');
    const sc = data.soundscapes;
    this.el = h(
      'div.modal-overlay',
      {onclick: (e: Event) => e.target === this.el && close()},
      h(
        'article.modal.panel.settings',
        {role: 'dialog', 'aria-label': t('Settings')},
        h('button.card-close', {type: 'button', 'aria-label': t('Close'), onclick: close, html: icons.close}),
        h('div.card-kicker', t('Settings')),
        h('h2.modal-title', t('Music')),
        h(
          'p.modal-lede',
          t('The music is made in your browser as you listen. It follows the viewpoint and the year, and when you follow a journey, the land the traveller is passing through. Each tradition is evoked from its scales, instruments and manner of playing; none is a reconstruction of what was heard.'),
        ),
        h('div.sound-controls', h('label.sound-switch', this.switchBtn, h('span', t('Music'))), h('label.sound-volume', h('span', t('Volume')), this.volume)),
        h(
          'div.sound-arrangement',
          h('label.sound-switch', this.orchestraBtn, h('span', t('Orchestral arrangement'))),
          h('p.sound-arrangement-note', t('Strings, harp, horns and timpani beneath the instruments of the time, as a game\'s score sets a folk tune: for the feeling of a place and an age, not its exact sound. Turn it off to hear only the historical instruments.')),
        ),
        this.nowEl,
        h('h3.card-h', t('The traditions')),
        h('ul.sound-list', sc.traditions.map(x => this.row(x))),
        h('p.card-src.sound-credit', t('Instrument samples: the FluidR3 GM soundfont by Frank Wen, rendered by the MIDI.js soundfonts project, CC BY 3.0. Where a tradition has no samples yet, its instruments are synthesised.')),
      ),
    );
    this.el.hidden = true;
    this.refresh();
  }

  private row(x: Tradition): HTMLElement {
    const sc = this.data.soundscapes;
    const name = tx.soundscape(x.id, 'name', x.name);
    const listen = h(
      'button.sound-listen',
      {
        type: 'button',
        onclick: (e: Event) => {
          // The button sits in the fold's header: hear the tradition without opening or closing it.
          e.preventDefault();
          this.music.listen(this.music.audition === x.id && !this.music.auditionPiece ? null : x.id);
        },
      },
      t('Listen'),
    );
    // Who hears it, in the order the list names them.
    const vps = [...new Set(sc.viewpoints.filter(r => r.tradition === x.id).map(r => r.vp))] as VpId[];
    const heard = vps.length ? vps.map(v => tx.viewpoint(v, 'name', this.data.vp[v].name)).join(t(', ')) : t('Everyone else, and the sea');
    const names = (ms: {id: string}[]) => [...new Set(ms.map(m => t(MEMBER_NAMES[m.id] ?? m.id)))].join(t(', '));
    const modern = x.ensemble?.members.filter(m => m.modern) ?? [];
    const arranged = modern.length ? h('span.sound-arranged', ` · ${t('Arranged for')} ${names(modern)}`) : null;
    if (arranged) this.arrangedEls.push(arranged);
    const played = x.ensemble ? names(x.ensemble.members.filter(m => !m.modern)) : [...new Set(x.voices.map(v => v.voice))].map(v => t(VOICE_NAMES[v])).join(t(', '));
    const s = this.store.state;
    const instruments = instrumentsOf(x).filter(id => this.data.livingById.has(id));
    const chips = [
      ...instruments.map(id =>
        h(
          'button.chip.living-chip.living-music',
          {type: 'button', onclick: () => this.go(() => this.actions.openLiving(id))},
          h('span.chip-icon', {html: livingIcons.music}),
          tx.living(id, 'name', this.data.livingById.get(id)!.name),
        ),
      ),
      ...x.places.map(id => {
        const c = this.data.cityById.get(id);
        if (!c) return null;
        const icon = c.kind === 'natural' ? naturalIcons[c.subtype ?? ''] ?? icons.natural : c.kind === 'built' ? icons.built : icons.city;
        return h(
          'button.chip.wonder-chip',
          {type: 'button', onclick: () => this.go(() => this.actions.openCity(id))},
          h('span.chip-icon', {html: icon}),
          tx.name(nameFor(c.names, s.vps[0], s.year, c.id)?.name ?? c.id),
        );
      }),
    ].filter(Boolean);
    const li = h(
      'details.sound-item',
      {'data-tradition': x.id},
      h(
        'summary.sound-head',
        h('span.sound-chevron', {'aria-hidden': 'true'}),
        h('span.sound-title', h('span.sound-name', name), h('span.sound-heard', heard)),
        listen,
      ),
      h(
        'div.sound-body',
        h('p.sound-summary', tx.soundscape(x.id, 'summary', x.summary)),
        ...this.themes(x),
        ...this.others(x),
        h('p.sound-meta', h('span', `${t('Played on')} ${played}`), arranged),
        chips.length ? h('div.chips', chips) : null,
        x.source
          ? h('p.card-src', {title: this.data.sources[x.source]?.citation ?? x.source}, `${t('Source:')} ${this.data.sources[x.source]?.citation ?? x.source} · ${t('{level} confidence', {level: t(x.confidence ?? 'low')})}`)
          : null,
      ),
    ) as HTMLDetailsElement;
    this.rows.set(x.id, {li, listen});
    return li;
  }

  /** A play button for a piece, kept in step with what is playing. */
  private playButton(x: Tradition, tu: Tune, cls: 'button.sound-play' | 'button.sound-cell' = 'button.sound-play'): HTMLButtonElement {
    const name = tx.tune(tu.id, 'name', tu.name);
    const play = h(cls, {
      type: 'button',
      'aria-label': t('Play {name}', {name}),
      title: t('Play {name}', {name}),
      onclick: () => this.music.listen(this.music.auditionPiece === tu.id ? null : x.id, this.music.auditionPiece === tu.id ? null : tu.id),
      html: PLAY,
    }) as HTMLButtonElement;
    return play;
  }

  /**
   * The tradition's themes as a grid: a row for each theme, a column for each age of the timeline, and in
   * each cell the play button for that age's arrangement. Beneath, what the cell pointed at (or the one
   * playing) is about, and once for each theme where its notes come from.
   */
  private themes(x: Tradition): (HTMLElement | null)[] {
    const themes = x.themes ?? [];
    const tunes = (x.tunes ?? []).filter(tu => tu.theme);
    if (!themes.length || !tunes.length) return [];
    const eras = ERAS.filter(e => e.to > -3000 && e.from < PRESENT && e.from > -5000);
    const yearOf = (e: (typeof ERAS)[number]) => (Math.max(e.from, -3000) + Math.min(e.to, PRESENT)) / 2;
    const detail = h('p.sound-detail');
    const show = (tu: Tune | undefined) => {
      if (!tu) return;
      detail.replaceChildren(
        h('strong', tx.tune(tu.id, 'name', tu.name)),
        h('span.sound-piece-when', ` · ${formatRange([tu.from ?? -3000, tu.until ?? PRESENT])}`),
        tu.about ? h('span', ` ${tx.tune(tu.id, 'about', tu.about)}`) : '',
      );
    };
    // Each age's column (its heading and cells), to mark the one whose arrangement is playing, or else the
    // age the map is in.
    const cols = eras.map(e => ({at: yearOf(e), cells: [] as HTMLElement[]}));
    const grid = h(
      'table.sound-grid',
      {onmouseleave: () => this.markEras()},
      h('thead', h('tr', h('th'), ...eras.map((e, i) => {
        const th = h('th', {scope: 'col'}, t(e.name));
        cols[i].cells.push(th);
        return th;
      }))),
      h(
        'tbody',
        themes.map(th =>
          h(
            'tr',
            h('th', {scope: 'row'}, h('span.sound-theme-name', tx.tune(th.id, 'name', th.name)), h('span.sound-mood', t(th.mood === 'folk' ? 'Folk' : 'Ceremonial'))),
            ...eras.map((e, i) => {
              const tu = tunes.find(u => u.theme === th.id && (u.from ?? -Infinity) <= yearOf(e) && yearOf(e) < (u.until ?? Infinity));
              if (!tu) {
                const td = h('td');
                cols[i].cells.push(td);
                return td;
              }
              const play = this.playButton(x, tu, 'button.sound-cell');
              play.addEventListener('mouseenter', () => show(tu));
              play.addEventListener('focus', () => show(tu));
              play.addEventListener('click', () => show(tu));
              const td = h('td', play);
              cols[i].cells.push(td);
              this.pieceRows.set(tu.id, {li: td, play, tradition: x.id, name: tx.tune(tu.id, 'name', tu.name)});
              return td;
            }),
          ),
        ),
      ),
    );
    this.details.set(x.id, {show, tunes, cols});
    const credits = themes.map(th =>
      h('span', h('em', tx.tune(th.id, 'name', th.name)), ` — ${this.data.sources[th.source ?? '']?.citation ?? th.source}${th.credit ? `. ${th.credit.replace(/\.$/, '')}` : ''}`),
    );
    return [
      h('div.sound-grid-wrap', grid),
      detail,
      h('p.sound-piece-src', `${t('Notes:')} `, ...credits.flatMap((c, i) => (i ? ['; ', c] : [c]))),
    ];
  }

  /** Other pieces, heard only when chosen: a fold of short rows. */
  private others(x: Tradition): (HTMLElement | null)[] {
    const tunes = (x.tunes ?? []).filter(tu => !tu.theme);
    if (!tunes.length) return [];
    const themed = (x.tunes ?? []).some(tu => tu.theme);
    const rows = tunes.map(tu => {
      const play = this.playButton(x, tu);
      const name = tx.tune(tu.id, 'name', tu.name);
      const li = h(
        'li',
        play,
        h('strong', name),
        !tu.extra && tu.from !== undefined ? h('span.sound-piece-when', ` · ${t('from {year}', {year: formatYear(tu.from)})}`) : null,
        !tu.extra && tu.from === undefined && tu.until !== undefined ? h('span.sound-piece-when', ` · ${t('until {year}', {year: formatYear(tu.until)})}`) : null,
        tu.about ? h('span.sound-piece-about', ` ${tx.tune(tu.id, 'about', tu.about)}`) : null,
        h('span.sound-piece-src', ` ${t('Notes:')} ${this.data.sources[tu.source ?? '']?.citation ?? tu.source}${tu.credit ? `. ${tu.credit}` : ''}`),
      );
      this.pieceRows.set(tu.id, {li, play, tradition: x.id, name});
      return li;
    });
    if (!themed) return [h('ul.sound-pieces', rows)];
    return [h('details.sound-more', h('summary', t('Other pieces, heard when chosen here'), h('span.sound-count', ` (${tunes.length})`)), h('ul.sound-pieces', rows))];
  }

  /** Close the settings and open a card on the map. */
  private go(open: () => void) {
    this.store.set({panel: 'none'});
    open();
  }

  /** Show the music's state: on or off, what is playing and why, and which tradition was picked to hear. */
  refresh() {
    const m = this.music;
    this.switchBtn.setAttribute('aria-checked', String(m.enabled));
    this.switchBtn.classList.toggle('on', m.enabled);
    this.volume.disabled = !m.enabled;
    this.orchestraBtn.setAttribute('aria-checked', String(m.orchestral));
    this.orchestraBtn.classList.toggle('on', m.orchestral);
    for (const el of this.arrangedEls) el.hidden = !m.orchestral;
    const now = m.now();
    const playing = now ? this.data.soundscapes.traditions.find(x => x.id === now.tradition) : undefined;
    if (!now || !playing) {
      this.nowEl.replaceChildren(t('The music is off. Turn it on here, with the note in the top bar, or with the M key.'));
    } else {
      this.nowEl.replaceChildren(
        h('span.sound-now-label', t('Now playing')),
        ' ',
        h('strong', tx.soundscape(playing.id, 'name', playing.name)),
        ...(now.piece ? [h('span', ` · `), h('em', tx.tune(now.piece, 'name', playing.tunes?.find(x => x.id === now.piece)?.name ?? now.piece))] : []),
        h('span.sound-why', ` · ${now.why}`),
        ...(m.audition ? [h('button.linkish.sound-follow', {type: 'button', onclick: () => m.listen(null)}, t('Follow the map again'))] : []),
      );
    }
    this.markEras();
    for (const [id, r] of this.rows) {
      const on = !!now && now.tradition === id;
      r.li.classList.toggle('playing', on);
      const chosen = m.audition === id && !m.auditionPiece;
      r.listen.textContent = chosen ? t('Stop') : on ? t('Playing') : t('Listen');
      r.listen.classList.toggle('active', chosen);
    }
    for (const [id, r] of this.pieceRows) {
      const chosen = m.audition === r.tradition && m.auditionPiece === id;
      r.li.classList.toggle('playing', !!now && now.tradition === r.tradition && now.piece === id);
      r.play.classList.toggle('active', chosen);
      r.play.innerHTML = chosen ? STOP : PLAY;
      const name = r.name;
      r.play.title = chosen ? t('Stop') : t('Play {name}', {name});
      r.play.setAttribute('aria-label', r.play.title);
    }
  }

  /**
   * In each theme grid, mark the age of the arrangement playing now (or else the age the map is in), and
   * describe that arrangement beneath it.
   */
  private markEras() {
    const now = this.music.now();
    const year = this.store.state.year;
    const within = (u: Tune, y: number) => (u.from ?? -Infinity) <= y && y < (u.until ?? Infinity);
    for (const [id, d] of this.details) {
      const playing = now?.tradition === id ? d.tunes.find(u => u.id === now.piece) : undefined;
      const tu = playing ?? d.tunes.find(u => within(u, year)) ?? d.tunes[0];
      for (const c of d.cols) for (const cell of c.cells) cell.classList.toggle('here', within(tu, c.at));
      d.show(tu);
    }
  }

  update(s: State) {
    const was = this.el.hidden;
    if (!this.el.hidden && s.year !== this.shownYear) this.markEras();
    this.shownYear = s.year;
    this.el.hidden = s.panel !== 'settings';
    if (was && !this.el.hidden) {
      this.refresh();
      // Open the tradition playing now (or the first with themes), and leave the others as the reader left them.
      const now = this.music.now()?.tradition ?? this.data.soundscapes.traditions.find(x => x.themes?.length)?.id;
      const row = now ? this.rows.get(now) : undefined;
      if (row && !row.li.open) row.li.open = true;
    }
  }
}
