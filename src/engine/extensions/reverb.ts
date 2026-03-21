/**
 * Plate Reverb — EMT 140 emulation with per-channel aux sends.
 *
 * Converts the original IIFE to an ES module factory
 * that returns an Extension conforming to types.ts.
 */

import type { Extension, ExtensionState, NodePair } from '../../types';
import { makeSlider } from '../../ui/helpers';

// ═══════════════════════════════════════════
//  Internal types
// ═══════════════════════════════════════════

interface ReverbState {
    decay: number;
    damping: number;
    predelay: number;
    brightness: number;
    mix: number;
    sends: number[] | null;
}

interface ReverbNodes {
    sendBus: GainNode;
    inputHPF: BiquadFilterNode;
    predelayNode: DelayNode;
    convolver: ConvolverNode;
    dampFilter: BiquadFilterNode;
    wetGain: GainNode;
    ctx: AudioContext;
}

const TRACK_COUNT = 9;

// ═══════════════════════════════════════════
//  Factory
// ═══════════════════════════════════════════

export function createReverb(): Extension {
    let state: ReverbState = {
        decay: 0.6,
        damping: 0.5,
        predelay: 0.02,
        brightness: 0.6,
        mix: 0.3,
        sends: null,
    };

    function defaultSends(): number[] { return Array(TRACK_COUNT).fill(0.15) as number[]; }
    function getSends(): number[] { return state.sends ?? defaultSends(); }

    let nodes: ReverbNodes | null = null;
    let sendGains: GainNode[] = [];
    let irBuffer: AudioBuffer | null = null;

    // ═══════════════════════════════════════════
    //  SYNTHETIC PLATE IR GENERATION
    // ═══════════════════════════════════════════
    function generatePlateIR(ctx: AudioContext, decayTime: number, damping: number, brightness: number): AudioBuffer {
        const sampleRate = ctx.sampleRate;
        const length = Math.ceil(sampleRate * decayTime);
        const buffer = ctx.createBuffer(2, length, sampleRate);

        for (let ch = 0; ch < 2; ch++) {
            const data = buffer.getChannelData(ch);

            for (let i = 0; i < length; i++) {
                const t = i / sampleRate;
                const pos = i / length;

                let noise = Math.random() * 2 - 1;

                const earlyGain = Math.exp(-t * 8) * 0.3;
                const lateGain = Math.exp(-t * (3 / decayTime));
                const envelope = earlyGain + lateGain;

                const dampFactor = 1 - damping * pos * 0.8;
                const hfRolloff = Math.max(0.1, dampFactor);

                if (i > 0) {
                    const prev = data[i - 1]!;
                    noise = noise * hfRolloff + prev * (1 - hfRolloff) * 0.5;
                }

                const brightMod = 0.5 + brightness * 0.5;
                const bassBoost = 1 + (1 - pos) * 0.15;

                data[i] = noise * envelope * brightMod * bassBoost;

                if (i > 100) {
                    const mode1 = Math.sin(i * 0.0073 + ch) * 0.02 * envelope;
                    const mode2 = Math.sin(i * 0.0127 + ch * 3) * 0.015 * envelope;
                    const mode3 = Math.sin(i * 0.0211 + ch * 5) * 0.01 * envelope;
                    data[i] = (data[i] ?? 0) + (mode1 + mode2 + mode3) * (1 - pos);
                }
            }

            // Normalize
            let peak = 0;
            for (let i = 0; i < length; i++) peak = Math.max(peak, Math.abs(data[i]!));
            if (peak > 0) {
                const norm = 0.7 / peak;
                for (let i = 0; i < length; i++) data[i] = (data[i] ?? 0) * norm;
            }
        }

        return buffer;
    }

    function rebuildIR(): void {
        if (!nodes) return;
        const decayTime = 1 + state.decay * 4;
        irBuffer = generatePlateIR(nodes.ctx, decayTime, state.damping, state.brightness);
        nodes.convolver.buffer = irBuffer;
    }

    function applyState(): void {
        if (!nodes) return;
        nodes.predelayNode.delayTime.value = state.predelay;
        nodes.dampFilter.frequency.value = 2000 + (1 - state.damping) * 10000;
        nodes.wetGain.gain.value = state.mix;
        const sends = getSends();
        for (let i = 0; i < sendGains.length; i++) {
            const sg = sendGains[i];
            if (sg) sg.gain.value = sends[i] ?? 0.4;
        }
    }

    return {
        id: 'reverb',
        name: 'Plate Reverb',
        icon: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 8c0-3 2-5 5-5s5 2 5 5-2 5-5 5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M5 8c0-2 1.3-3 3-3s3 1 3 3-1.3 3-3 3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" opacity="0.6"/><circle cx="8" cy="8" r="1" fill="currentColor" opacity="0.4"/></svg>',

        init(ctx: AudioContext): NodePair {
            const decayTime = 1 + state.decay * 4;
            irBuffer = generatePlateIR(ctx, decayTime, state.damping, state.brightness);

            const predelayNode = ctx.createDelay(0.2);
            predelayNode.delayTime.value = state.predelay;

            const convolver = ctx.createConvolver();
            convolver.buffer = irBuffer;

            const inputHPF = ctx.createBiquadFilter();
            inputHPF.type = 'highpass';
            inputHPF.frequency.value = 100;
            inputHPF.Q.value = 0.5;

            const dampFilter = ctx.createBiquadFilter();
            dampFilter.type = 'lowpass';
            dampFilter.frequency.value = 2000 + (1 - state.damping) * 10000;
            dampFilter.Q.value = 0.5;

            const wetGain = ctx.createGain();
            wetGain.gain.value = state.mix;

            const sendBus = ctx.createGain();
            sendBus.gain.value = 1 / Math.sqrt(TRACK_COUNT);

            sendGains = [];
            const trackGainsArr = window.SEQ.trackGains;
            const sends = getSends();
            for (let i = 0; i < trackGainsArr.length; i++) {
                const tg = trackGainsArr[i];
                if (!tg) continue;
                const sg = ctx.createGain();
                sg.gain.value = sends[i] ?? 0.4;
                tg.connect(sg);
                sg.connect(sendBus);
                sendGains.push(sg);
            }

            sendBus.connect(inputHPF);
            inputHPF.connect(predelayNode);
            predelayNode.connect(convolver);
            convolver.connect(dampFilter);
            dampFilter.connect(wetGain);

            nodes = { sendBus, inputHPF, predelayNode, convolver, dampFilter, wetGain, ctx };

            const pass = ctx.createGain();
            const masterGain = window.SEQ.masterGain;
            if (masterGain) wetGain.connect(masterGain);

            window.SEQ.onStop(() => {
                if (!nodes) return;
                const now = nodes.ctx.currentTime;
                nodes.wetGain.gain.setValueAtTime(nodes.wetGain.gain.value, now);
                nodes.wetGain.gain.linearRampToValueAtTime(0, now + 0.3);
                setTimeout(() => {
                    if (!nodes) return;
                    nodes.wetGain.gain.cancelScheduledValues(0);
                    nodes.wetGain.gain.value = state.mix;
                }, 500);
            });

            return { input: pass, output: pass };
        },

        createUI(container: HTMLElement): void {
            container.innerHTML = '';

            const title = document.createElement('div');
            title.style.cssText = 'font-size:8px;font-weight:700;letter-spacing:2px;color:#666;margin-bottom:20px;padding-bottom:8px;border-bottom:1px solid #2a2a32;';
            title.textContent = 'EMT 140 PLATE REVERB';
            container.appendChild(title);

            makeSlider(container, 'DECAY', state.decay, 0, 1, 0.01,
                v => (1 + v * 4).toFixed(1) + 's',
                v => { state.decay = v; rebuildIR(); window.SEQ.notifyStateChange(); });

            makeSlider(container, 'DAMPING', state.damping, 0, 1, 0.01,
                v => Math.round(v * 100) + '%',
                v => { state.damping = v; applyState(); rebuildIR(); window.SEQ.notifyStateChange(); });

            makeSlider(container, 'PRE-DELAY', state.predelay, 0, 0.1, 0.001,
                v => Math.round(v * 1000) + 'ms',
                v => { state.predelay = v; applyState(); window.SEQ.notifyStateChange(); });

            makeSlider(container, 'BRIGHTNESS', state.brightness, 0, 1, 0.01,
                v => Math.round(v * 100) + '%',
                v => { state.brightness = v; rebuildIR(); window.SEQ.notifyStateChange(); });

            makeSlider(container, 'WET LEVEL', state.mix, 0, 1, 0.01,
                v => Math.round(v * 100) + '%',
                v => { state.mix = v; applyState(); window.SEQ.notifyStateChange(); });

            // Per-channel aux sends
            const auxSec = document.createElement('div');
            auxSec.style.cssText = 'margin-top:20px;padding-top:14px;border-top:1px solid #2a2a32;';

            const auxTitle = document.createElement('div');
            auxTitle.style.cssText = 'font-size:8px;font-weight:700;letter-spacing:2px;color:#666;margin-bottom:12px;';
            auxTitle.textContent = 'AUX SENDS';
            auxSec.appendChild(auxTitle);

            const sends = getSends();
            const count = window.SEQ.trackCount;

            for (let i = 0; i < count; i++) {
                const info = window.SEQ.getTrackInfo(i);
                const row = document.createElement('div');
                row.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:8px;';

                const dot = document.createElement('div');
                dot.style.cssText = `width:4px;height:14px;border-radius:2px;flex-shrink:0;background:${info.color};`;
                row.appendChild(dot);

                const name = document.createElement('div');
                name.style.cssText = 'font-size:8px;font-weight:700;color:#999;width:52px;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;letter-spacing:0.3px;';
                name.textContent = info.name;
                name.title = info.name;
                row.appendChild(name);

                const slider = document.createElement('input');
                slider.type = 'range';
                slider.min = '0';
                slider.max = '1';
                slider.step = '0.01';
                slider.value = String(sends[i] ?? 0.4);
                slider.style.cssText = 'flex:1;accent-color:#888;cursor:pointer;height:3px;';
                const idx = i;
                const val = document.createElement('div');
                val.style.cssText = 'font-size:9px;font-weight:700;color:#777;width:20px;text-align:right;flex-shrink:0;font-variant-numeric:tabular-nums;';
                val.textContent = String(Math.round((sends[i] ?? 0.4) * 100));

                slider.oninput = () => {
                    const v = parseFloat(slider.value);
                    if (!state.sends) state.sends = defaultSends();
                    state.sends[idx] = v;
                    val.textContent = String(Math.round(v * 100));
                    const sg = sendGains[idx];
                    if (sg) sg.gain.value = v;
                    window.SEQ.notifyStateChange();
                };

                row.appendChild(slider);
                row.appendChild(val);
                auxSec.appendChild(row);
            }

            container.appendChild(auxSec);
        },

        getState(): ExtensionState {
            return { ...state, sends: getSends() };
        },

        setState(s: ExtensionState): void {
            if (s) {
                state = { ...state, ...s as Partial<ReverbState> };
                applyState();
                if (nodes) rebuildIR();
            }
        },

        setEnabled(on: boolean): void {
            if (!nodes) return;
            if (on) {
                applyState();
            } else {
                nodes.wetGain.gain.value = 0;
                for (const sg of sendGains) sg.gain.value = 0;
            }
        },

        destroy(): void {
            sendGains.forEach(sg => { try { sg.disconnect(); } catch (_e) { /* already disconnected */ } });
            sendGains = [];
            if (nodes) {
                Object.values(nodes).forEach(n => {
                    if (n && typeof n === 'object' && 'disconnect' in n) {
                        try { (n as AudioNode).disconnect(); } catch (_e) { /* already disconnected */ }
                    }
                });
                nodes = null;
            }
        },
    };
}
