/** Compact song-building controls attached to the existing phrase pane. */
import { on } from '../events';
import {
  phrases,
  currentPhrase,
  switchToPhrase,
  sections,
  variationLocks,
} from '../transport/patterns';
import { drumNames, melNames, vocalName, bpm } from '../transport/song';
import { undo, redo, getHistoryState } from '../transport/history';
import {
  copyRegion,
  pasteRegion,
  clearRegion,
  nudgeRegion,
  transposeRegion,
  repeatRegion,
  previewVariation,
  applyVariation,
  setVariationLock,
  nameSection,
  removeSection,
  duplicateSection,
  moveSection,
  resizeSection,
  sectionDuration,
  type EditRegion,
  type PatternClip,
  type VariationKind,
  type VariationPreview,
} from '../transport/composer';
import { getAudioContext } from '../engine/audio';
import { stopPlayback } from '../engine/scheduler';
import { renderSongToBuffer } from '../transport/render-song';

type Mode = 'edit' | 'sections' | 'vary';
let from = 0,
  to = 0,
  startBar = 0,
  endBar = 3;
let explicitRange = false;
let rangeAnchor = 0;
const selectedTracks = new Set(Array.from({ length: 9 }, (_, i) => i));
let clipboard: PatternClip | undefined;
let preview: VariationPreview | undefined;
let audition: AudioBufferSourceNode | undefined;
let renderController: AbortController | undefined;
let dialog: HTMLDialogElement;
let content: HTMLElement;
let status: HTMLElement;
let toolbar: HTMLElement;
let sectionStrip: HTMLElement;
let undoButton: HTMLButtonElement;
let redoButton: HTMLButtonElement;
let dialogUndoButton: HTMLButtonElement;
let dialogRedoButton: HTMLButtonElement;
let summary: HTMLElement;
let previewPanel: HTMLElement | undefined;
let previewApply: HTMLButtonElement | undefined;
let mode: Mode = 'edit';
let initialized = false;

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text = '',
  cls = '',
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.textContent = text;
  element.className = cls;
  return element;
}
function button(text: string, action: () => void, title = text): HTMLButtonElement {
  const element = node('button', text, 'composer-button');
  element.type = 'button';
  element.title = title;
  element.onclick = () => {
    try {
      status.textContent = '';
      action();
    } catch (error) {
      showError(error);
    }
  };
  return element;
}
function showError(error: unknown): void {
  status.textContent = error instanceof Error ? error.message : String(error);
}
function duration(seconds: number): string {
  const rounded = Math.round(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`;
}
function trackNames(): string[] {
  return [...drumNames, ...melNames, vocalName];
}
function region(): EditRegion {
  return {
    from,
    to,
    startStep: startBar * 16,
    endStep: endBar * 16 + 15,
    tracks: [...selectedTracks],
  };
}
function group(parent: HTMLElement, name: string): HTMLElement {
  const field = node('fieldset', '', 'composer-group');
  field.append(node('legend', name));
  parent.append(field);
  return field;
}
function input(parent: HTMLElement, name: string, value: string, type = 'text'): HTMLInputElement {
  const label = node('label', name, 'composer-field');
  const field = node('input');
  field.type = type;
  field.value = value;
  field.setAttribute('aria-label', name);
  label.append(field);
  parent.append(label);
  return field;
}
function select(
  parent: HTMLElement,
  name: string,
  values: { value: number; label: string }[],
  value: number,
  change: (value: number) => void,
): HTMLSelectElement {
  const label = node('label', name, 'composer-field');
  const field = node('select');
  field.setAttribute('aria-label', name);
  for (const item of values) {
    const option = node('option', item.label);
    option.value = String(item.value);
    field.append(option);
  }
  field.value = String(value);
  field.onchange = () => {
    clearPreview();
    change(Number(field.value));
  };
  label.append(field);
  parent.append(label);
  return field;
}
function clearPreview(): void {
  stopAudition();
  preview = undefined;
  if (previewPanel) previewPanel.replaceChildren();
  if (previewApply) previewApply.disabled = true;
}
function stopAudition(): void {
  renderController?.abort();
  renderController = undefined;
  if (audition) {
    try {
      audition.stop();
    } catch {
      /* Already ended. */
    }
    audition.disconnect();
    audition = undefined;
  }
}
function close(): void {
  clearPreview();
  if (dialog.open) dialog.close();
}

function selectionControls(parent: HTMLElement, includeTracks: boolean): void {
  const field = group(parent, 'Selection');
  const options = phrases.map((_, i) => ({ value: i, label: String(i + 1) }));
  const first = select(field, 'First phrase', options, from, (value) => {
    from = value;
    to = Math.max(to, from);
    last.value = String(to);
    explicitRange = true;
    rangeAnchor = from;
    refreshToolbar();
  });
  const last = select(field, 'Last phrase', options, to, (value) => {
    to = value;
    from = Math.min(from, to);
    first.value = String(from);
    explicitRange = true;
    rangeAnchor = from;
    refreshToolbar();
  });
  if (includeTracks) {
    const bars = Array.from({ length: 4 }, (_, i) => ({ value: i, label: String(i + 1) }));
    const firstBar = select(field, 'First bar', bars, startBar, (value) => {
      startBar = value;
      endBar = Math.max(value, endBar);
      lastBar.value = String(endBar);
    });
    const lastBar = select(field, 'Last bar', bars, endBar, (value) => {
      endBar = value;
      startBar = Math.min(value, startBar);
      firstBar.value = String(startBar);
    });
    const tracks = group(
      parent,
      mode === 'vary' ? 'Tracks · protect keeps a track unchanged' : 'Tracks to edit',
    );
    const all = button('All tracks', () => {
      selectedTracks.clear();
      for (let i = 0; i < 9; i++) selectedTracks.add(i);
      clearPreview();
      buildContent();
    });
    const none = button('No tracks', () => {
      selectedTracks.clear();
      clearPreview();
      buildContent();
    });
    tracks.append(all, none);
    const list = node('div', '', 'composer-tracks');
    trackNames().forEach((name, track) => {
      const row = node('div', '', 'composer-track');
      const label = node('label', name || `Track ${track + 1}`);
      const chosen = node('input');
      chosen.type = 'checkbox';
      chosen.checked = selectedTracks.has(track);
      chosen.setAttribute('aria-label', `Select ${name || `track ${track + 1}`}`);
      chosen.onchange = () => {
        if (chosen.checked) selectedTracks.add(track);
        else selectedTracks.delete(track);
        clearPreview();
      };
      label.prepend(chosen);
      row.append(label);
      if (mode === 'vary') {
        const protection = node('label', 'Protect', 'composer-protect');
        const locked = node('input');
        locked.type = 'checkbox';
        locked.checked = !!variationLocks[track];
        locked.setAttribute('aria-label', `Protect ${name || `track ${track + 1}`}`);
        locked.onchange = () => {
          clearPreview();
          setVariationLock(track, locked.checked);
        };
        protection.prepend(locked);
        row.append(protection);
      }
      list.append(row);
    });
    tracks.append(list);
  }
}
function editControls(): void {
  selectionControls(content, true);
  const operations = group(content, 'Edit selected bars and tracks');
  operations.append(
    button('Copy', () => {
      clipboard = copyRegion(region());
      status.textContent = `Copied ${clipboard.phraseCount} phrase(s), ${clipboard.stepsPerPhrase / 16} bar(s) each. Choose the destination first phrase/bar, then Paste copied tracks.`;
    }),
    button('Cut', () => {
      clipboard = copyRegion(region());
      clearRegion(region());
      status.textContent = 'Cut selection. Undo restores it.';
    }),
    button('Paste copied tracks', () => {
      if (!clipboard) throw new Error('Copy some notes first.');
      pasteRegion(clipboard, from, startBar * 16);
      status.textContent = 'Pasted into the copied track positions.';
    }),
    button('Clear notes', () => clearRegion(region())),
    button('Repeat to phrase end', () => repeatRegion(region())),
    button(
      'Nudge ←',
      () => nudgeRegion(region(), -1),
      'Move notes one step earlier, wrapping within the selected bars',
    ),
    button(
      'Nudge →',
      () => nudgeRegion(region(), 1),
      'Move notes one step later, wrapping within the selected bars',
    ),
    button(
      'Transpose −',
      () => transposeRegion(region(), -1),
      'Move synth notes down one semitone',
    ),
    button('Transpose +', () => transposeRegion(region(), 1), 'Move synth notes up one semitone'),
  );
  operations.append(
    node(
      'p',
      'Each operation is one undoable edit. Paste replaces the copied tracks in the destination bars; other tracks stay unchanged.',
      'composer-help',
    ),
  );
}
function sectionControls(): void {
  selectionControls(content, false);
  const naming = group(content, 'Name the selected phrases');
  const existing = sections.find(
    (section) => section.start === from && section.length === to - from + 1,
  );
  const name = input(naming, 'Section name', existing?.name ?? '');
  name.maxLength = 32;
  name.placeholder = 'Intro, Main, Break…';
  naming.append(
    button(existing ? 'Rename section' : 'Create section', () => {
      const match = sections.find(
        (section) => section.start === from && section.length === to - from + 1,
      );
      nameSection(from, to - from + 1, name.value, match?.id);
      buildContent();
    }),
  );
  const list = group(content, 'Song sections');
  if (!sections.length)
    list.append(node('p', 'Select phrases, then give them a name.', 'composer-help'));
  sections.forEach((section, i) => {
    const row = node('div', '', 'composer-section-row');
    const time = sectionDuration(section);
    row.append(
      button(`${section.name} · ${time.bars} bars · ${duration(time.seconds)}`, () => {
        from = section.start;
        rangeAnchor = from;
        to = from + section.length - 1;
        switchToPhrase(from);
        explicitRange = true;
        refreshToolbar();
        buildContent();
      }),
    );
    row.append(
      button(
        'Duplicate',
        () => {
          const copy = duplicateSection(section.id);
          from = copy.start;
          to = from + copy.length - 1;
          buildContent();
        },
        `Duplicate ${section.name}`,
      ),
    );
    const earlier = button(
      'Earlier',
      () => {
        moveSection(section.id, sections[i - 1]!.start);
        buildContent();
      },
      `Move ${section.name} earlier`,
    );
    earlier.disabled = i === 0;
    const later = button(
      'Later',
      () => {
        const next = sections[i + 1]!;
        moveSection(section.id, next.start + next.length);
        buildContent();
      },
      `Move ${section.name} later`,
    );
    later.disabled = i === sections.length - 1;
    row.append(earlier, later);
    const length = input(row, `${section.name} phrases`, String(section.length), 'number');
    length.min = '1';
    length.max = '48';
    row.append(
      button(
        'Resize',
        () => {
          resizeSection(section.id, length.valueAsNumber);
          buildContent();
        },
        `Resize ${section.name}`,
      ),
    );
    row.append(
      button(
        'Remove name',
        () => {
          removeSection(section.id);
          buildContent();
        },
        `Remove ${section.name} name`,
      ),
    );
    list.append(row);
  });
  list.append(
    node(
      'p',
      'Longer sections repeat their material; shorter sections trim their ending. Undo restores the original. Times reflect playback: empty phrases are skipped.',
      'composer-help',
    ),
  );
}
async function auditionPreview(variant: boolean, phraseIndex: number): Promise<void> {
  if (!preview) return;
  stopAudition();
  stopPlayback();
  const controller = new AbortController();
  renderController = controller;
  const captured = preview;
  const sourcePhrase = (variant ? captured.result : captured.original)[phraseIndex];
  if (!sourcePhrase) return;
  const ctx = getAudioContext();
  if (!ctx) throw new Error('The audio engine is not ready.');
  await ctx.resume();
  status.textContent = `Rendering ${variant ? 'variation' : 'original'} with the current mix…`;
  try {
    const rendered = await renderSongToBuffer({
      phraseOverride: [sourcePhrase],
      signal: controller.signal,
    });
    if (controller.signal.aborted || preview !== captured || !dialog.open) return;
    const source = ctx.createBufferSource();
    source.buffer = rendered.buffer;
    source.connect(ctx.destination);
    audition = source;
    source.addEventListener(
      'ended',
      () => {
        source.disconnect();
        if (audition === source) {
          audition = undefined;
          status.textContent = 'Audition finished.';
        }
      },
      { once: true },
    );
    source.start();
    status.textContent = `Playing ${variant ? 'variation' : 'original'} · phrase ${captured.region.from + phraseIndex + 1}`;
  } catch (error) {
    if (!controller.signal.aborted) showError(error);
  } finally {
    if (renderController === controller) renderController = undefined;
  }
}
function showPreview(kind: VariationKind): void {
  clearPreview();
  preview = previewVariation(region(), kind);
  const captured = preview;
  const panel = previewPanel!;
  panel.append(
    node(
      'p',
      `${kind.toUpperCase()} · ${captured.added} notes added · ${captured.removed} removed`,
      'composer-preview-summary',
    ),
  );
  if (captured.protectedTracks.length)
    panel.append(
      node(
        'p',
        `Protected: ${captured.protectedTracks.map((track) => trackNames()[track]).join(', ')}`,
        'composer-help',
      ),
    );
  if (!captured.added && !captured.removed)
    panel.append(
      node(
        'p',
        'No notes changed. Try another variation or a different selection.',
        'composer-help',
      ),
    );
  let auditionPhrase = 0;
  // Changing this selector only chooses what to hear; it must not clear the preview.
  const label = node('label', 'Audition phrase', 'composer-field');
  const chooser = node('select');
  chooser.setAttribute('aria-label', 'Audition phrase');
  captured.original.forEach((_, index) => {
    const option = node('option', String(captured.region.from + index + 1));
    option.value = String(index);
    chooser.append(option);
  });
  chooser.onchange = () => {
    stopAudition();
    auditionPhrase = Number(chooser.value);
  };
  label.append(chooser);
  panel.append(label);
  panel.append(
    button('Hear original', () => {
      void auditionPreview(false, auditionPhrase).catch(showError);
    }),
    button('Hear variation', () => {
      void auditionPreview(true, auditionPhrase).catch(showError);
    }),
    button('Stop audition', stopAudition),
  );
  previewApply = button('Apply variation', () => {
    if (!preview) return;
    applyVariation(preview);
    clearPreview();
    status.textContent = 'Variation applied. Undo restores the original.';
  });
  previewApply.disabled = !captured.added && !captured.removed;
  panel.append(
    previewApply,
    button('Discard variation', () => {
      clearPreview();
      status.textContent = 'Preview discarded. Song notes were not changed.';
    }),
  );
}
function variationControls(): void {
  selectionControls(content, true);
  const variations = group(content, 'Choose a variation');
  const descriptions: [VariationKind, string, string][] = [
    ['sparse', 'Sparse', 'Keep alternating note events; preserve the first hit.'],
    ['driving', 'Driving', 'Add a pulse two steps after existing hits where there is space.'],
    ['syncopated', 'Syncopated', 'Move on-beat hits to free offbeats.'],
    ['answer', 'Answer', 'Keep the first half; echo it two steps late in the second half.'],
  ];
  for (const [kind, title, description] of descriptions)
    variations.append(button(title, () => showPreview(kind), description));
  variations.append(
    node(
      'p',
      'Only selected, unprotected tracks change. Existing pitches are reused. Audition uses the current samples and effects; Apply commits the notes.',
      'composer-help',
    ),
  );
  previewPanel = node('div', '', 'composer-preview');
  variations.append(previewPanel);
}
function buildContent(): void {
  refreshToolbar();
  content.replaceChildren();
  previewPanel = undefined;
  previewApply = undefined;
  if (mode === 'edit') editControls();
  else if (mode === 'sections') sectionControls();
  else variationControls();
}
function open(which: Mode): void {
  clearPreview();
  mode = which;
  if (!explicitRange) from = to = currentPhrase;
  from = Math.min(from, phrases.length - 1);
  to = Math.max(from, Math.min(to, phrases.length - 1));
  status.textContent = '';
  dialog.setAttribute(
    'aria-label',
    which === 'edit'
      ? 'Bulk editing'
      : which === 'sections'
        ? 'Named sections'
        : 'Controlled variations',
  );
  dialog.querySelector('h2')!.textContent =
    which === 'edit'
      ? 'EDIT PATTERNS'
      : which === 'sections'
        ? 'SONG SECTIONS'
        : 'CREATE A VARIATION';
  buildContent();
  if (!dialog.open) dialog.showModal();
  refreshToolbar();
}
function refreshToolbar(): void {
  if (!initialized) return;
  from = Math.min(from, phrases.length - 1);
  to = Math.min(Math.max(from, to), phrases.length - 1);
  const history = getHistoryState();
  undoButton.disabled = !history.canUndo;
  dialogUndoButton.disabled = !history.canUndo;
  dialogRedoButton.disabled = !history.canRedo;
  redoButton.disabled = !history.canRedo;
  undoButton.title = history.canUndo ? `Undo: ${history.undoLabel} (⌘/Ctrl+Z)` : 'Undo (⌘/Ctrl+Z)';
  redoButton.title = history.canRedo
    ? `Redo: ${history.redoLabel} (⌘/Ctrl+Shift+Z)`
    : 'Redo (⌘/Ctrl+Shift+Z)';
  const playable = phrases.filter(
    (phrase) =>
      phrase.drumPat.some((row) => row.some(Boolean)) ||
      phrase.melPat.some((track) => track.some((notes) => notes.some(Boolean))) ||
      phrase.vocalPat.some(Boolean),
  ).length;
  summary.textContent = `${explicitRange ? `Selected ${from + 1}–${to + 1} · ` : ''}${playable * 4} bars · ${duration((playable * 16 * 60) / bpm)}`;
  sectionStrip.replaceChildren();
  for (const section of sections) {
    const time = sectionDuration(section);
    const chip = button(
      `${section.name} · ${time.bars}b`,
      () => {
        from = section.start;
        rangeAnchor = from;
        to = from + section.length - 1;
        explicitRange = true;
        switchToPhrase(from);
        refreshToolbar();
      },
      `${section.name}: phrases ${section.start + 1}–${section.start + section.length}, ${duration(time.seconds)}`,
    );
    chip.classList.add('section-chip');
    sectionStrip.append(chip);
  }
  sectionStrip.hidden = !sections.length;
  document.querySelectorAll<HTMLElement>('.phrase-slot').forEach((slot, i) => {
    slot.classList.toggle('edit-selected', explicitRange && i >= from && i <= to);
    const section = sections.find((item) => i >= item.start && i < item.start + item.length);
    slot.title = `Phrase ${i + 1}${section ? ` · ${section.name}` : ''}. Shift-click to select a range.`;
    let label = slot.querySelector<HTMLElement>('.phrase-section-name');
    if (!label) {
      label = node('span', '', 'phrase-section-name');
      slot.append(label);
    }
    label.textContent = section?.start === i ? section.name : '';
  });
}
export function initComposerTools(): void {
  if (initialized) return;
  initialized = true;
  dialog = node('dialog', '', 'composer-dialog');
  dialog.id = 'composer-dialog';
  dialog.setAttribute('aria-modal', 'true');
  const header = node('div', '', 'composer-heading');
  header.append(node('h2'));
  status = node('div', '', 'composer-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  dialogUndoButton = button('Undo', () => {
    clearPreview();
    undo();
    buildContent();
  });
  dialogRedoButton = button('Redo', () => {
    clearPreview();
    redo();
    buildContent();
  });
  header.append(dialogUndoButton, dialogRedoButton, button('Close', close));
  content = node('div', '', 'composer-content');
  dialog.append(header, content, status);
  document.body.append(dialog);
  dialog.addEventListener('cancel', () => clearPreview());
  dialog.addEventListener('close', () => clearPreview());
  toolbar = node('div', '', 'composer-toolbar');
  undoButton = button('Undo', () => {
    undo();
  });
  undoButton.id = 'undo-btn';
  redoButton = button('Redo', () => {
    redo();
  });
  redoButton.id = 'redo-btn';
  summary = node('span', '', 'composer-song-summary');
  toolbar.append(
    undoButton,
    redoButton,
    button('Edit', () => open('edit'), 'Bulk editing'),
    button('Sections', () => open('sections'), 'Named sections'),
    button('Vary', () => open('vary'), 'Controlled variations'),
    summary,
  );
  const controls = document.querySelector('.phrase-controls');
  controls?.append(toolbar);
  sectionStrip = node('div', '', 'composer-section-strip');
  document.querySelector('.phrase-grid')?.before(sectionStrip);
  document.querySelectorAll<HTMLElement>('.phrase-slot').forEach((slot, index) => {
    slot.addEventListener(
      'click',
      (event) => {
        if ((event.target as Element).closest('.phrase-fill-btn')) return;
        if (event.shiftKey) {
          event.preventDefault();
          event.stopImmediatePropagation();
          const anchor = explicitRange ? rangeAnchor : currentPhrase;
          rangeAnchor = anchor;
          from = Math.min(anchor, index);
          to = Math.max(anchor, index);
          explicitRange = true;
        } else {
          from = to = index;
          rangeAnchor = index;
          explicitRange = false;
        }
        refreshToolbar();
      },
      true,
    );
  });
  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || !(event.metaKey || event.ctrlKey) || event.altKey) return;
    if (
      event.target instanceof Element &&
      event.target.closest('input,textarea,select,[contenteditable="true"]')
    )
      return;
    const key = event.key.toLowerCase();
    if (key === 'z' || key === 'y') {
      event.preventDefault();
      clearPreview();
      if (key === 'y' || event.shiftKey) redo();
      else undo();
      if (dialog.open) buildContent();
    }
  });
  on('editor:historyChanged', (state) => {
    if (preview && preview.revision !== state.revision) {
      clearPreview();
      status.textContent = 'Song changed. Choose a variation again for a fresh preview.';
    }
    refreshToolbar();
  });
  on('editor:beforeRestore', stopAudition);
  on('editor:documentChanged', refreshToolbar);
  on('transport:phraseChanged', refreshToolbar);
  on('transport:phraseCountChanged', refreshToolbar);
  on('persistence:beforeLoad', close);
  on('transport:songLoaded', () => {
    clipboard = undefined;
    explicitRange = false;
    from = to = currentPhrase;
    refreshToolbar();
  });
  refreshToolbar();
}
