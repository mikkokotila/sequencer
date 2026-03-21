/**
 * Tape Delay — Echoplex EP-3 emulation with per-channel aux sends.
 *
 * Converts the original IIFE to an ES module factory
 * that returns an Extension conforming to types.ts.
 */

import type { Extension, ExtensionState, NodePair } from '../../types';
import { makeSlider } from '../../ui/helpers';

// ═══════════════════════════════════════════
//  Internal types
// ═══════════════════════════════════════════

interface DelayState {
    time: number;
    feedback: number;
    tone: number;
    saturation: number;
    wobble: number;
    mix: number;
    sends: number[] | null;
}

interface DelayNodes {
    sendBus: GainNode;
    inputSat: WaveShaperNode;
    delay: DelayNode;
    feedbackGain: GainNode;
    tapeLPF: BiquadFilterNode;
    tapeHPF: BiquadFilterNode;
    fbSat: WaveShaperNode;
    wetGain: GainNode;
    lfo: OscillatorNode;
    lfoGain: GainNode;
    lfo2: OscillatorNode;
    lfo2Gain: GainNode;
    ctx: AudioContext;
}

const TRACK_COUNT = 9;

// ═══════════════════════════════════════════
//  Factory
// ═══════════════════════════════════════════

export function createDelay(): Extension {
    let state: DelayState = {
        time: 0.375,
        feedback: 0.45,
        tone: 0.55,
        saturation: 0.3,
        wobble: 0.3,
        mix: 0.25,
        sends: null,
    };

    function defaultSends(): number[] { return Array(TRACK_COUNT).fill(0.12) as number[]; }
    function getSends(): number[] { return state.sends ?? defaultSends(); }

    let nodes: DelayNodes | null = null;
    let sendGains: GainNode[] = [];

    // ═══════════════════════════════════════════
    //  TAPE SATURATION CURVE
    // ═══════════════════════════════════════════
    function makeTapeCurve(amount: number): Float32Array {
        const n = 4096;
        const curve = new Float32Array(n);
        if (amount < 0.001) {
            for (let i = 0; i < n; i++) curve[i] = (i * 2) / n - 1;
            return curve;
        }
        const k = amount * 30 + 1;
        for (let i = 0; i < n; i++) {
            const x = (i * 2) / n - 1;
            const shaped = (Math.PI + k) * x / (Math.PI + k * Math.abs(x));
            const warmth = 0.02 * amount * Math.sin(x * Math.PI);
            curve[i] = x * (1 - amount) + (shaped + warmth) * amount;
        }
        return curve;
    }

    function applyState(): void {
        if (!nodes) return;
        nodes.delay.delayTime.setTargetAtTime(state.time, nodes.ctx.currentTime, 0.05);
        nodes.feedbackGain.gain.value = Math.min(state.feedback, 0.95);
        nodes.tapeLPF.frequency.value = 800 + state.tone * 6000;
        nodes.inputSat.curve = makeTapeCurve(state.saturation) as Float32Array<ArrayBuffer>;
        nodes.fbSat.curve = makeTapeCurve(state.saturation * 0.6) as Float32Array<ArrayBuffer>;
        nodes.lfoGain.gain.value = state.wobble * 0.003;
        nodes.lfo2Gain.gain.value = state.wobble * 0.0004;
        nodes.wetGain.gain.value = state.mix;
        const sends = getSends();
        for (let i = 0; i < sendGains.length; i++) {
            const sg = sendGains[i];
            if (sg) sg.gain.value = sends[i] ?? 0.35;
        }
    }

    return {
        id: 'delay',
        name: 'Tape Delay',
        icon: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="5" cy="8" r="3.5" stroke="currentColor" stroke-width="1.3"/><circle cx="11" cy="8" r="3.5" stroke="currentColor" stroke-width="1.3"/><line x1="5" y1="4.5" x2="11" y2="4.5" stroke="currentColor" stroke-width="1" opacity="0.4"/><line x1="5" y1="11.5" x2="11" y2="11.5" stroke="currentColor" stroke-width="1" opacity="0.4"/></svg>',

        init(ctx: AudioContext): NodePair {
            const sendBus = ctx.createGain();
            sendBus.gain.value = 1 / Math.sqrt(TRACK_COUNT);

            const inputSat = ctx.createWaveShaper();
            inputSat.curve = makeTapeCurve(state.saturation) as Float32Array<ArrayBuffer>;
            inputSat.oversample = '2x';

            const delay = ctx.createDelay(2.0);
            delay.delayTime.value = state.time;

            const feedbackGain = ctx.createGain();
            feedbackGain.gain.value = state.feedback;

            const tapeLPF = ctx.createBiquadFilter();
            tapeLPF.type = 'lowpass';
            tapeLPF.frequency.value = 800 + state.tone * 6000;
            tapeLPF.Q.value = 0.5;

            const tapeHPF = ctx.createBiquadFilter();
            tapeHPF.type = 'highpass';
            tapeHPF.frequency.value = 80;
            tapeHPF.Q.value = 0.5;

            const fbSat = ctx.createWaveShaper();
            fbSat.curve = makeTapeCurve(state.saturation * 0.6) as Float32Array<ArrayBuffer>;
            fbSat.oversample = '2x';

            const lfo = ctx.createOscillator();
            lfo.type = 'sine';
            lfo.frequency.value = 0.6;
            const lfoGain = ctx.createGain();
            lfoGain.gain.value = state.wobble * 0.003;
            lfo.connect(lfoGain);
            lfoGain.connect(delay.delayTime);
            lfo.start();

            const lfo2 = ctx.createOscillator();
            lfo2.type = 'triangle';
            lfo2.frequency.value = 3.7;
            const lfo2Gain = ctx.createGain();
            lfo2Gain.gain.value = state.wobble * 0.0004;
            lfo2.connect(lfo2Gain);
            lfo2Gain.connect(delay.delayTime);
            lfo2.start();

            const wetGain = ctx.createGain();
            wetGain.gain.value = state.mix;

            sendBus.connect(inputSat);
            inputSat.connect(delay);
            delay.connect(wetGain);

            delay.connect(fbSat);
            fbSat.connect(tapeHPF);
            tapeHPF.connect(tapeLPF);
            tapeLPF.connect(feedbackGain);
            feedbackGain.connect(delay);

            sendGains = [];
            const trackGainsArr = window.SEQ.trackGains;
            const sends = getSends();
            for (let i = 0; i < trackGainsArr.length; i++) {
                const tg = trackGainsArr[i];
                if (!tg) continue;
                const sg = ctx.createGain();
                sg.gain.value = sends[i] ?? 0.35;
                tg.connect(sg);
                sg.connect(sendBus);
                sendGains.push(sg);
            }

            const masterGain = window.SEQ.masterGain;
            if (masterGain) wetGain.connect(masterGain);

            nodes = {
                sendBus, inputSat, delay, feedbackGain,
                tapeLPF, tapeHPF, fbSat, wetGain,
                lfo, lfoGain, lfo2, lfo2Gain,
                ctx,
            };

            window.SEQ.onStop(() => {
                if (!nodes) return;
                const now = nodes.ctx.currentTime;
                nodes.feedbackGain.gain.setValueAtTime(nodes.feedbackGain.gain.value, now);
                nodes.feedbackGain.gain.linearRampToValueAtTime(0, now + 0.05);
                nodes.wetGain.gain.setValueAtTime(nodes.wetGain.gain.value, now);
                nodes.wetGain.gain.linearRampToValueAtTime(0, now + 0.15);
                setTimeout(() => {
                    if (!nodes) return;
                    nodes.feedbackGain.gain.cancelScheduledValues(0);
                    nodes.feedbackGain.gain.value = Math.min(state.feedback, 0.95);
                    nodes.wetGain.gain.cancelScheduledValues(0);
                    nodes.wetGain.gain.value = state.mix;
                }, 300);
            });

            const pass = ctx.createGain();
            return { input: pass, output: pass };
        },

        createUI(container: HTMLElement): void {
            container.innerHTML = '';

            const title = document.createElement('div');
            title.style.cssText = 'font-size:8px;font-weight:700;letter-spacing:2px;color:#666;margin-bottom:20px;padding-bottom:8px;border-bottom:1px solid #2a2a32;';
            title.textContent = 'ECHOPLEX EP-3 TAPE DELAY';
            container.appendChild(title);

            makeSlider(container, 'TIME', state.time, 0.04, 0.8, 0.001,
                v => Math.round(v * 1000) + 'ms',
                v => { state.time = v; applyState(); window.SEQ.notifyStateChange(); });

            makeSlider(container, 'FEEDBACK', state.feedback, 0, 0.95, 0.01,
                v => Math.round(v * 100) + '%',
                v => { state.feedback = v; applyState(); window.SEQ.notifyStateChange(); });

            makeSlider(container, 'TONE', state.tone, 0, 1, 0.01,
                v => { const hz = 800 + v * 6000; return hz < 1000 ? Math.round(hz) + 'Hz' : (hz / 1000).toFixed(1) + 'kHz'; },
                v => { state.tone = v; applyState(); window.SEQ.notifyStateChange(); });

            makeSlider(container, 'SATURATION', state.saturation, 0, 1, 0.01,
                v => Math.round(v * 100) + '%',
                v => { state.saturation = v; applyState(); window.SEQ.notifyStateChange(); });

            makeSlider(container, 'WOBBLE', state.wobble, 0, 1, 0.01,
                v => Math.round(v * 100) + '%',
                v => { state.wobble = v; applyState(); window.SEQ.notifyStateChange(); });

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
                slider.value = String(sends[i] ?? 0.35);
                slider.style.cssText = 'flex:1;accent-color:#888;cursor:pointer;height:3px;';
                const idx = i;
                const val = document.createElement('div');
                val.style.cssText = 'font-size:9px;font-weight:700;color:#777;width:20px;text-align:right;flex-shrink:0;font-variant-numeric:tabular-nums;';
                val.textContent = String(Math.round((sends[i] ?? 0.35) * 100));

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
                state = { ...state, ...s as Partial<DelayState> };
                applyState();
            }
        },

        setEnabled(on: boolean): void {
            if (!nodes) return;
            if (on) {
                applyState();
            } else {
                nodes.wetGain.gain.value = 0;
                nodes.feedbackGain.gain.value = 0;
                for (const sg of sendGains) sg.gain.value = 0;
            }
        },

        destroy(): void {
            sendGains.forEach(sg => { try { sg.disconnect(); } catch (_e) { /* already disconnected */ } });
            sendGains = [];
            if (nodes) {
                try { nodes.lfo.stop(); } catch (_e) { /* already stopped */ }
                try { nodes.lfo2.stop(); } catch (_e) { /* already stopped */ }
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
