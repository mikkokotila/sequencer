/**
 * UI helper utilities — DOM creation, color conversion, text truncation.
 * No dependencies on state or config.
 */

/** Create a DOM element with optional class name */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

/** Convert hex color (#RRGGBB) to rgba string */
export function hexToRgba(hex: string, a: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

/** Convert display row index (0=B, 11=C) to semitone (0=C, 11=B) */
export function displayToSemitone(d: number): number {
  return 11 - d;
}

/** Generate a short unique ID */
export function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/** Truncate a filename for display */
export function truncName(n: string): string {
  return n.length > 6 ? n.slice(0, 5) + '\u2026' : n;
}

/** Format a 0-1 value as percentage string */
export function formatPct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

/** Format a dB value */
export function formatDb(v: number): string {
  return `${v.toFixed(0)} dB`;
}

/**
 * Make a DOM element's text editable on double-click.
 * Commits on Enter/blur, cancels on Escape.
 */
export function makeEditable(
  nameEl: HTMLElement,
  getName: () => string,
  setName: (v: string) => void,
  onCommit?: () => void,
): void {
  nameEl.addEventListener('dblclick', () => {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'track-name-input';
    input.value = getName();
    nameEl.replaceWith(input);
    input.focus();
    input.select();

    const commit = (): void => {
      const val = input.value.trim() || getName();
      setName(val);
      const newEl = el('div', 'track-name');
      newEl.textContent = val;
      newEl.title = val;
      input.replaceWith(newEl);
      makeEditable(newEl, getName, setName, onCommit);
      onCommit?.();
    };

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') input.blur();
      if (e.key === 'Escape') {
        input.value = getName();
        input.blur();
      }
    });
  });
}

/**
 * Create a labeled slider control for extension panels.
 * Returns the container div.
 */
export function makeSlider(
  container: HTMLElement,
  label: string,
  value: number,
  min: number,
  max: number,
  step: number,
  formatFn: (v: number) => string,
  onChange: (v: number) => void,
): HTMLInputElement {
  const row = el('div', '');
  row.style.cssText = 'margin-bottom:12px;';

  const top = el('div', '');
  top.style.cssText = 'display:flex;justify-content:space-between;margin-bottom:4px;';

  const lbl = el('span', '');
  lbl.style.cssText = 'font-size:9px;font-weight:700;letter-spacing:1.5px;color:#999;';
  lbl.textContent = label;

  const val = el('span', '');
  val.style.cssText = 'font-size:9px;font-weight:600;color:#ddd;';
  val.textContent = formatFn(value);

  top.appendChild(lbl);
  top.appendChild(val);

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = String(min);
  slider.max = String(max);
  slider.step = String(step);
  slider.value = String(value);
  slider.style.cssText = 'width:100%;accent-color:#888;cursor:pointer;height:4px;';

  slider.oninput = () => {
    const v = Number(slider.value);
    val.textContent = formatFn(v);
    onChange(v);
  };

  row.appendChild(top);
  row.appendChild(slider);
  container.appendChild(row);

  return slider;
}
