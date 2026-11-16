import type {Mood, Music} from '../audio/music';
import type {AppData} from '../data';
import {t, tx} from '../i18n';
import {h} from './dom';

/**
 * The controls the settings and the top bar's music popover share: which of a tradition's two themes to play
 * (Auto, Ceremonial or Folk), the reader's own pick when one is being followed, and a line saying what plays.
 */

const MOODS: {id: Mood; label: string}[] = [
  {id: 'auto', label: 'Auto'},
  {id: 'ceremonial', label: 'Ceremonial'},
  {id: 'folk', label: 'Folk'},
];

/** A three-way switch: Auto, Ceremonial, Folk. */
export function moodSwitch(music: Music): {el: HTMLElement; refresh(): void} {
  const buttons = MOODS.map(m =>
    h('button.mood-option', {type: 'button', role: 'radio', onclick: () => music.setMood(m.id)}, t(m.label)),
  );
  const el = h('div.mood-switch', {role: 'radiogroup', 'aria-label': t('Themes')}, ...buttons);
  const refresh = () =>
    buttons.forEach((b, i) => {
      const on = music.mood === MOODS[i].id;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    });
  refresh();
  return {el, refresh};
}

/** What the Themes setting means, in a sentence, for the mood chosen. */
export function moodNote(music: Music): string {
  if (music.mood === 'ceremonial') return t('Every tradition plays its ceremonial theme.');
  if (music.mood === 'folk') return t('Every tradition plays its folk theme.');
  return t('One theme carries on while the timeline plays; the two take turns while it is paused.');
}

/** Under Auto, the reader's pick for the tradition playing now, with a way back to Auto; else nothing. */
export function pickNote(data: AppData, music: Music): HTMLElement | null {
  const now = music.now();
  if (!now) return null;
  const pick = music.chosenFor(now.tradition);
  if (!pick) return null;
  const tradition = data.soundscapes.traditions.find(x => x.id === now.tradition);
  const theme = tradition?.themes?.find(x => x.id === pick);
  if (!tradition || !theme) return null;
  return h(
    'span.pick-note',
    t('Keeping to your pick: {theme}', {theme: tx.tune(theme.id, 'name', theme.name)}),
    h('button.pick-clear', {type: 'button', title: t('Back to Auto'), 'aria-label': t('Back to Auto'), onclick: () => music.unchoose(tradition.id)}, '×'),
  );
}
