import type {AppData} from '../data';
import {instrumentsOf, type Tradition} from '../audio/choose';
import type {Music} from '../audio/music';
import type {VoiceName} from '../audio/voices';
import {nameFor} from '../data';
import {t, tx} from '../i18n';
import {formatYear} from '../time';
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
  metal: 'bronze keys and gong',
  tine: 'iron tines',
  keys: 'keyboard',
  gong: 'gong',
};

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
};

/**
 * Settings: for now, the music. Turn it on or off and set its level, see what is playing and why, and browse
 * the traditions it plays: hear any one of them, and open the instruments and places each belongs to.
 */
export class Settings {
  el: HTMLElement;
  private switchBtn: HTMLButtonElement;
  private volume: HTMLInputElement;
  private nowEl: HTMLElement;
  private rows = new Map<string, {li: HTMLElement; listen: HTMLButtonElement}>();
  private pieceRows = new Map<string, HTMLElement>();

  constructor(
    private data: AppData,
    private store: Store,
    private music: Music,
    private actions: {openLiving(id: string): void; openCity(id: string): void},
  ) {
    const close = () => store.set({panel: 'none'});
    this.switchBtn = h('button.switch', {type: 'button', role: 'switch', onclick: () => music.toggle()}, h('span.switch-knob'));
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
    const listen = h('button.sound-listen', {type: 'button', onclick: () => this.music.listen(this.music.audition === x.id ? null : x.id)}, t('Listen'));
    // Who hears it, in the order the list names them.
    const vps = [...new Set(sc.viewpoints.filter(r => r.tradition === x.id).map(r => r.vp))] as VpId[];
    const heard = vps.length ? vps.map(v => tx.viewpoint(v, 'name', this.data.vp[v].name)).join(t(', ')) : t('Everyone else, and the sea');
    const played = x.ensemble
      ? x.ensemble.members.map(m => t(MEMBER_NAMES[m.id] ?? m.id)).join(t(', '))
      : [...new Set(x.voices.map(v => v.voice))].map(v => t(VOICE_NAMES[v])).join(t(', '));
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
      'li.sound-item',
      h('div.sound-head', h('h4.sound-name', name), listen),
      h('p.sound-summary', tx.soundscape(x.id, 'summary', x.summary)),
      h('p.sound-meta', h('span', `${t('Heard by')} `, h('strong', heard)), h('span', ` · ${t('Played on')} ${played}`)),
      x.tunes?.length
        ? h(
            'ul.sound-pieces',
            x.tunes.map(tu => {
              const li = h(
                'li',
                h('strong', tx.tune(tu.id, 'name', tu.name)),
                tu.from !== undefined ? h('span.sound-piece-when', ` · ${t('from {year}', {year: formatYear(tu.from)})}`) : null,
                tu.about ? h('span.sound-piece-about', ` ${tx.tune(tu.id, 'about', tu.about)}`) : null,
                h('span.sound-piece-src', ` ${t('Notes:')} ${this.data.sources[tu.source ?? '']?.citation ?? tu.source}${tu.credit ? `. ${tu.credit}` : ''}`),
              );
              this.pieceRows.set(tu.id, li);
              return li;
            }),
          )
        : null,
      chips.length ? h('div.chips', chips) : null,
      x.source
        ? h('p.card-src', {title: this.data.sources[x.source]?.citation ?? x.source}, `${t('Source:')} ${this.data.sources[x.source]?.citation ?? x.source} · ${t('{level} confidence', {level: t(x.confidence ?? 'low')})}`)
        : null,
    );
    this.rows.set(x.id, {li, listen});
    return li;
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
    for (const [id, r] of this.rows) {
      const on = !!now && now.tradition === id;
      r.li.classList.toggle('playing', on);
      r.listen.textContent = m.audition === id ? t('Stop') : on ? t('Playing') : t('Listen');
      r.listen.classList.toggle('active', m.audition === id);
    }
    for (const [id, li] of this.pieceRows) li.classList.toggle('playing', !!now && now.piece === id);
  }

  update(s: State) {
    const was = this.el.hidden;
    this.el.hidden = s.panel !== 'settings';
    if (was && !this.el.hidden) this.refresh();
  }
}
