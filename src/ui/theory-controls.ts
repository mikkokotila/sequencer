/** Song-level key/mode and a shared progression for every generated synth voice. */
import { on } from '../events';
import { theory, phrases } from '../transport/patterns';
import { setSongTheory, fitSongToScale } from '../transport/composer';
import {
  MODES,
  NOTE_NAMES,
  PROGRESSIONS,
  chordLabel,
  inScale,
  suggestProgression,
  type Mode,
} from '../transport/theory';
import { melodyNotes } from '../transport/notes';
import { reportPersistenceError } from '../transport/persistence';

export function initTheoryControls(): void {
  let progressionIdea = 1;
  const dialogStatus = document.createElement('p');
  dialogStatus.className = 'theory-status';
  dialogStatus.setAttribute('role', 'status');
  const bar = document.createElement('div');
  bar.className = 'song-theory-controls';
  const root = document.createElement('select');
  root.setAttribute('aria-label', 'Song root');
  NOTE_NAMES.forEach((name, i) => root.add(new Option(name, String(i))));
  const mode = document.createElement('select');
  mode.setAttribute('aria-label', 'Song mode');
  Object.entries(MODES).forEach(([id, definition]) => mode.add(new Option(definition.name, id)));
  const lock = document.createElement('input');
  lock.type = 'checkbox';
  lock.setAttribute('aria-label', 'Scale Lock');
  const lockLabel = document.createElement('label');
  lockLabel.append(lock, document.createTextNode('Scale Lock'));
  lockLabel.title =
    'Snap new and moved pitches to the nearest scale note. Equal distances choose the lower pitch.';
  const button = (text: string, action: () => void) => {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'composer-button';
    element.textContent = text;
    element.onclick = () => {
      try {
        action();
      } catch (error) {
        if (dialog.open)
          dialogStatus.textContent = error instanceof Error ? error.message : String(error);
        else reportPersistenceError(error);
      }
    };
    return element;
  };
  const dialog = document.createElement('dialog');
  dialog.className = 'composer-dialog';
  dialog.setAttribute('aria-label', 'Song harmony');
  const heading = document.createElement('div');
  heading.className = 'composer-heading';
  const title = document.createElement('h2');
  title.textContent = 'SONG HARMONY';
  heading.append(
    title,
    button('Close', () => dialog.close()),
  );
  const description = document.createElement('p');
  description.className = 'composer-help';
  description.textContent =
    'One chord per bar, repeating across the song. Bass, chords, melody and arpeggios share this progression.';
  const preset = document.createElement('select');
  preset.setAttribute('aria-label', 'Progression preset');
  preset.add(new Option('Custom progression', 'custom'));
  PROGRESSIONS.forEach((item, i) => preset.add(new Option(item.name, String(i))));
  const degrees = document.createElement('input');
  degrees.type = 'text';
  degrees.setAttribute('aria-label', 'Progression degrees');
  degrees.placeholder = '1 5 6 4';
  const field = document.createElement('div');
  field.className = 'theory-progression';
  field.append(
    preset,
    degrees,
    button('Use progression', () => {
      const text = degrees.value.trim();
      if (!/^[1-7](?:[ ,-]+[1-7])*$/.test(text))
        throw new Error('Enter scale degrees 1–7 separated by spaces (up to 16 bars).');
      setSongTheory({ ...theory, progression: text.split(/[ ,-]+/).map(Number) });
    }),
  );
  field.append(
    button('New progression', () =>
      setSongTheory({ ...theory, progression: suggestProgression(theory.mode, progressionIdea++) }),
    ),
  );
  const chords = document.createElement('p');
  chords.className = 'theory-chords';
  const scale = document.createElement('p');
  scale.className = 'composer-help';
  const outside = document.createElement('p');
  outside.className = 'composer-help';
  const fit = button('Fit existing song notes to scale', () => fitSongToScale());
  const help = document.createElement('p');
  help.className = 'composer-help';
  help.textContent =
    'Scale Lock affects new and moved notes. Fit existing notes converts all synth parts as one undoable edit. It keeps event timing and leaves percussion alone.';
  dialog.append(heading, description, field, chords, scale, outside, fit, help, dialogStatus);
  document.body.append(dialog);
  const refresh = () => {
    dialogStatus.textContent = '';
    root.value = String(theory.root);
    mode.value = theory.mode;
    lock.checked = theory.locked;
    degrees.value = theory.progression.join(' ');
    const index = PROGRESSIONS.findIndex(
      (item) => item.degrees.join(',') === theory.progression.join(','),
    );
    preset.value = index < 0 ? 'custom' : String(index);
    chords.textContent = theory.progression
      .map((degree, i) => `${i + 1}: ${chordLabel(degree, theory)}`)
      .join('  ·  ');
    scale.textContent = `${NOTE_NAMES[theory.root]} ${MODES[theory.mode].name} · ${Array.from(
      { length: 12 },
      (_, i) => i,
    )
      .filter((note) => inScale(note, theory))
      .map((note) => NOTE_NAMES[note])
      .join(' · ')}`;
    if (dialog.open) {
      let count = 0;
      for (const phrase of phrases)
        for (let track = 0; track < 3; track++)
          for (let step = 0; step < 64; step++)
            count += melodyNotes(phrase, track, step).filter(
              (note) => !inScale(note, theory),
            ).length;
      outside.textContent = `${count} existing note${count === 1 ? '' : 's'} outside this scale.`;
      fit.disabled = count === 0;
    }
  };
  const change = () => {
    try {
      setSongTheory({
        ...theory,
        root: Number(root.value),
        mode: mode.value as Mode,
        locked: lock.checked,
      });
    } catch (error) {
      reportPersistenceError(error);
      refresh();
    }
  };
  root.onchange = mode.onchange = lock.onchange = change;
  preset.onchange = () => {
    if (preset.value === 'custom') return;
    setSongTheory({ ...theory, progression: [...PROGRESSIONS[Number(preset.value)]!.degrees] });
  };
  bar.append(
    root,
    mode,
    lockLabel,
    button('Harmony', () => {
      dialog.showModal();
      refresh();
    }),
  );
  document.querySelector('.transport')?.append(bar);
  on('editor:documentChanged', refresh);
  on('transport:songLoaded', refresh);
  on('persistence:beforeLoad', () => dialog.close());
  refresh();
}
