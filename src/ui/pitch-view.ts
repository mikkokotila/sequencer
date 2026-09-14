/** A twelve-row viewport can move through adjacent octaves without transposing the music. */
import { emit } from '../events';
import { octaves, theory, phrases, currentPhrase } from '../transport/patterns';
import { midiBase, melodyNotes } from '../transport/notes';
import { inScale, pitchClass } from '../transport/theory';
import { NOTES_DISPLAY } from '../config';

const offsets = [0, 0, 0];
let renderedKey = '';
const names = [...NOTES_DISPLAY].reverse();
export function getPitchView(track: number): number {
  const base = midiBase(octaves[track]!);
  return Math.max(-base, Math.min(116 - base, offsets[track] ?? 0));
}
export function setPitchView(track: number, offset: number): void {
  if (!Number.isInteger(track) || track < 0 || track > 2 || !Number.isInteger(offset))
    throw new Error('Invalid pitch view.');
  const base = midiBase(octaves[track]!);
  offsets[track] = Math.max(-base, Math.min(116 - base, offset));
  emit('ui:pitchViewChanged', { track });
}
export function ensurePitchVisible(track: number, note: number): void {
  const start = getPitchView(track);
  if (note < start) setPitchView(track, note);
  else if (note > start + 11) setPitchView(track, note - 11);
}
function label(note: number, track: number): string {
  return `${names[pitchClass(note)]}${octaves[track]! + Math.floor(note / 12)}`;
}
export function refreshPitchLabels(): void {
  const key = JSON.stringify([octaves, offsets, theory.root, theory.mode]);
  if (key === renderedKey) return;
  renderedKey = key;
  document
    .querySelectorAll<HTMLElement>('.melody-track[data-type="melody"]')
    .forEach((panel, track) => {
      const offset = getPitchView(track);
      const range = panel.querySelector('.pitch-view-range');
      if (range) range.textContent = `${label(offset, track)}–${label(offset + 11, track)}`;
      panel.querySelectorAll<HTMLElement>('.note-label').forEach((element, row) => {
        const note = offset + 11 - row;
        element.textContent = names[pitchClass(note)]!;
        element.title = label(note, track);
        element.classList.toggle('scale-root', pitchClass(note) === theory.root);
        element.classList.toggle('outside-scale', !inScale(note, theory));
        element.classList.toggle('sharp', [1, 3, 6, 8, 10].includes(pitchClass(note)));
      });
      panel.querySelectorAll<HTMLElement>('.melody-cell').forEach((cell) => {
        const note = offset + 11 - Number(cell.dataset.note);
        cell.classList.toggle('outside-scale', !inScale(note, theory));
        const black = [1, 3, 6, 8, 10].includes(pitchClass(note));
        cell.classList.toggle('black-key', black);
        cell.classList.toggle('white-key', !black);
        cell.title = `${label(note, track)} · step ${Number(cell.dataset.step) + 1}`;
      });
    });
}
/** Keep notes outside the twelve-row view discoverable after generation, paste or undo. */
export function refreshPitchIndicators(): void {
  document
    .querySelectorAll<HTMLElement>('.melody-track[data-type="melody"]')
    .forEach((panel, track) => {
      const start = getPitchView(track);
      const notes = Array.from({ length: 64 }, (_, step) =>
        melodyNotes(phrases[currentPhrase]!, track, step),
      ).flat();
      for (const [direction, count] of [
        ['lower', notes.filter((note) => note < start).length],
        ['higher', notes.filter((note) => note > start + 11).length],
      ] as const) {
        const button = panel.querySelector<HTMLElement>(`[aria-label="View ${direction} octave"]`);
        if (button) {
          button.textContent = `${direction === 'lower' ? '‹' : '›'}${count ? ` ${count}` : ''}`;
          button.title = `View ${direction} octave${count ? ` (${count} notes outside view)` : ''}`;
        }
      }
    });
}
export function createPitchViewControl(track: number): HTMLElement {
  const group = document.createElement('div');
  group.className = 'pitch-view-control';
  const button = (text: string, title: string, action: () => void) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.onclick = action;
    return b;
  };
  const range = document.createElement('span');
  range.className = 'pitch-view-range';
  group.append(
    button('‹', 'View lower octave', () => setPitchView(track, getPitchView(track) - 12)),
    range,
    button('›', 'View higher octave', () => setPitchView(track, getPitchView(track) + 12)),
    button('↺', 'View base octave', () => setPitchView(track, 0)),
  );
  return group;
}
export function resetPitchViews(): void {
  offsets.fill(0);
  refreshPitchLabels();
}
