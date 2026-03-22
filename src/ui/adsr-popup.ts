/**
 * ADSR popup — per-track envelope controls with live visualization.
 *
 * A compact popup anchored near the ADSR button on each track header.
 * Contains 4 vertical sliders (A/D/S/R) and a canvas that draws the
 * envelope shape in real time using the track's color.
 */

import { DRUMS_CFG, MEL_CFG, TOTAL_TRACKS } from '../config';
import { drumNames, melNames, vocalName } from '../transport/song';
import { getTrackAdsr, setTrackAdsr } from '../engine/adsr';
import { el } from './helpers';

// ═══════════════════════════════════════════
//  Module state
// ═══════════════════════════════════════════

let popup: HTMLElement | null = null;
let canvas: HTMLCanvasElement | null = null;
let activeTrackIndex = -1;
let sliderEls: HTMLInputElement[] = [];
let valueEls: HTMLElement[] = [];

// Track colors for visualization (indexed by global track index)
function getTrackColor(trackIndex: number): string {
  if (trackIndex < DRUMS_CFG.length) {
    return DRUMS_CFG[trackIndex]?.color ?? '#F5C04E';
  }
  const mi = trackIndex - DRUMS_CFG.length;
  if (mi < MEL_CFG.length) {
    return MEL_CFG[mi]?.color ?? '#A0B4FF';
  }
  return '#5CDCC8'; // vocal
}

function getTrackName(trackIndex: number): string {
  if (trackIndex < DRUMS_CFG.length) {
    return drumNames[trackIndex] ?? `Drum ${trackIndex + 1}`;
  }
  const mi = trackIndex - DRUMS_CFG.length;
  if (mi < MEL_CFG.length) {
    return melNames[mi] ?? `Synth ${mi + 1}`;
  }
  return vocalName;
}

// ═══════════════════════════════════════════
//  DOM construction
// ═══════════════════════════════════════════

/** Create the shared ADSR popup DOM and append to document.body. */
export function buildAdsrPopupDOM(): void {
  popup = el('div', 'adsr-popup');
  popup.id = 'adsr-popup';

  // Header
  const header = el('div', 'adsr-header');
  const title = el('div', 'adsr-title');
  title.id = 'adsr-title';
  title.textContent = 'ENVELOPE';
  header.appendChild(title);
  const closeBtn = el('button', 'adsr-close');
  closeBtn.id = 'adsr-close';
  closeBtn.textContent = '\u00D7';
  closeBtn.onclick = closeAdsrPopup;
  header.appendChild(closeBtn);
  popup.appendChild(header);

  // Canvas visualization
  canvas = document.createElement('canvas');
  canvas.id = 'adsr-canvas';
  canvas.className = 'adsr-canvas';
  canvas.width = 240;
  canvas.height = 80;
  popup.appendChild(canvas);

  // Sliders container
  const slidersContainer = el('div', 'adsr-sliders');

  const params: { label: string; key: string; min: number; max: number; step: number }[] = [
    { label: 'A', key: 'attack', min: 0.001, max: 2.0, step: 0.001 },
    { label: 'D', key: 'decay', min: 0.001, max: 2.0, step: 0.001 },
    { label: 'S', key: 'sustain', min: 0, max: 1.0, step: 0.01 },
    { label: 'R', key: 'release', min: 0.001, max: 3.0, step: 0.001 },
  ];

  sliderEls = [];
  valueEls = [];

  for (const p of params) {
    const col = el('div', 'adsr-slider-col');

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'adsr-slider-vertical';
    slider.min = String(p.min);
    slider.max = String(p.max);
    slider.step = String(p.step);
    slider.value = String(p.key === 'sustain' ? 1.0 : 0.1);
    slider.oninput = () => {
      const v = parseFloat(slider.value);
      setTrackAdsr(activeTrackIndex, { [p.key]: v });
      updateValues();
      drawEnvelope();
    };
    col.appendChild(slider);

    const label = el('div', 'adsr-slider-label');
    label.textContent = p.label;
    col.appendChild(label);

    const val = el('div', 'adsr-slider-value');
    val.textContent = '';
    col.appendChild(val);
    valueEls.push(val);

    sliderEls.push(slider);
    slidersContainer.appendChild(col);
  }

  popup.appendChild(slidersContainer);
  document.body.appendChild(popup);

  // Close on click outside
  document.addEventListener('mousedown', (e: MouseEvent) => {
    if (
      popup?.classList.contains('open') &&
      !popup.contains(e.target as Node) &&
      !(e.target as HTMLElement).classList.contains('adsr-btn')
    ) {
      closeAdsrPopup();
    }
  });
}

// ═══════════════════════════════════════════
//  Open / Close
// ═══════════════════════════════════════════

/** Open ADSR popup for a track, anchored near the button. */
export function openAdsrPopup(trackIndex: number, anchorEl: HTMLElement): void {
  if (!popup) return;
  if (trackIndex < 0 || trackIndex >= TOTAL_TRACKS) return;

  activeTrackIndex = trackIndex;

  // Update title
  const titleEl = document.getElementById('adsr-title');
  if (titleEl) titleEl.textContent = `ENVELOPE \u2014 ${getTrackName(trackIndex)}`;

  // Sync sliders to current track ADSR
  const adsr = getTrackAdsr(trackIndex);
  if (sliderEls[0]) sliderEls[0].value = String(adsr.attack);
  if (sliderEls[1]) sliderEls[1].value = String(adsr.decay);
  if (sliderEls[2]) sliderEls[2].value = String(adsr.sustain);
  if (sliderEls[3]) sliderEls[3].value = String(adsr.release);

  updateValues();

  // Position near anchor
  const rect = anchorEl.getBoundingClientRect();
  popup.style.top = `${rect.bottom + 6}px`;
  popup.style.left = `${Math.max(8, rect.left - 80)}px`;

  popup.classList.add('open');
  drawEnvelope();
}

/** Close the ADSR popup. */
export function closeAdsrPopup(): void {
  if (!popup) return;
  popup.classList.remove('open');
  activeTrackIndex = -1;
}

/** Whether the ADSR popup is currently open. */
export function isAdsrPopupOpen(): boolean {
  return popup?.classList.contains('open') ?? false;
}

// ═══════════════════════════════════════════
//  Value display
// ═══════════════════════════════════════════

function formatTime(s: number): string {
  if (s < 0.01) return `${Math.round(s * 1000)}ms`;
  if (s < 1) return `${Math.round(s * 1000)}ms`;
  return `${s.toFixed(1)}s`;
}

function updateValues(): void {
  const adsr = getTrackAdsr(activeTrackIndex);
  if (valueEls[0]) valueEls[0].textContent = formatTime(adsr.attack);
  if (valueEls[1]) valueEls[1].textContent = formatTime(adsr.decay);
  if (valueEls[2]) valueEls[2].textContent = `${Math.round(adsr.sustain * 100)}%`;
  if (valueEls[3]) valueEls[3].textContent = formatTime(adsr.release);
}

// ═══════════════════════════════════════════
//  Canvas visualization
// ═══════════════════════════════════════════

function drawEnvelope(): void {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;
  const pad = 8;
  const drawW = w - pad * 2;
  const drawH = h - pad * 2;

  ctx.clearRect(0, 0, w, h);

  const adsr = getTrackAdsr(activeTrackIndex);
  const color = getTrackColor(activeTrackIndex);

  // Time segments (normalized to fit drawing width)
  const totalTime = adsr.attack + adsr.decay + 0.3 + adsr.release; // 0.3 = sustain hold
  const aW = (adsr.attack / totalTime) * drawW;
  const dW = (adsr.decay / totalTime) * drawW;
  const sW = (0.3 / totalTime) * drawW;
  const rW = (adsr.release / totalTime) * drawW;

  const bottom = pad + drawH;
  const top = pad;
  const sustainY = pad + drawH * (1 - adsr.sustain);

  // Draw filled area
  ctx.beginPath();
  ctx.moveTo(pad, bottom);
  ctx.lineTo(pad + aW, top); // attack
  ctx.lineTo(pad + aW + dW, sustainY); // decay
  ctx.lineTo(pad + aW + dW + sW, sustainY); // sustain hold
  ctx.lineTo(pad + aW + dW + sW + rW, bottom); // release
  ctx.lineTo(pad, bottom);
  ctx.closePath();
  ctx.fillStyle = color + '18'; // very transparent fill
  ctx.fill();

  // Draw curve outline
  ctx.beginPath();
  ctx.moveTo(pad, bottom);
  ctx.lineTo(pad + aW, top);
  ctx.lineTo(pad + aW + dW, sustainY);
  ctx.lineTo(pad + aW + dW + sW, sustainY);
  ctx.lineTo(pad + aW + dW + sW + rW, bottom);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // Dot at each inflection point
  const dots = [
    [pad, bottom],
    [pad + aW, top],
    [pad + aW + dW, sustainY],
    [pad + aW + dW + sW, sustainY],
    [pad + aW + dW + sW + rW, bottom],
  ];
  ctx.fillStyle = color;
  for (const [dx, dy] of dots) {
    if (dx === undefined || dy === undefined) continue;
    ctx.beginPath();
    ctx.arc(dx, dy, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}
