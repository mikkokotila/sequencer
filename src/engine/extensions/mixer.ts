/**
 * Mixer — Per-channel level controls with metering.
 *
 * Converts the original IIFE to an ES module factory
 * that returns an Extension conforming to types.ts.
 */

import type { Extension, ExtensionState, NodePair } from '../../types';

// ═══════════════════════════════════════════
//  Internal types
// ═══════════════════════════════════════════

interface MixerState {
    levels: number[] | null;
}

const TRACK_COUNT = 9;

// ═══════════════════════════════════════════
//  Factory
// ═══════════════════════════════════════════

export function createMixer(): Extension {
    let state: MixerState = { levels: null };
    let analysers: AnalyserNode[] = [];
    let meterRAF: number | null = null;
    let meterBars: HTMLElement[] = [];

    function defaults(): number[] { return Array(TRACK_COUNT).fill(0.8) as number[]; }
    function getLevels(): number[] { return state.levels ?? defaults(); }

    function applyLevels(): void {
        const gains = window.SEQ.trackGains;
        const lvls = getLevels();
        for (let i = 0; i < gains.length; i++) {
            const g = gains[i];
            if (g) g.gain.value = lvls[i] ?? 0.8;
        }
    }

    function startMeters(): void {
        if (meterRAF !== null) cancelAnimationFrame(meterRAF);
        const buf = new Uint8Array(128);
        function tick(): void {
            for (let i = 0; i < analysers.length; i++) {
                const bar = meterBars[i];
                const analyser = analysers[i];
                if (!bar || !analyser) continue;
                analyser.getByteFrequencyData(buf);
                let sum = 0;
                for (let j = 0; j < buf.length; j++) sum += buf[j]!;
                const avg = sum / buf.length / 255;
                bar.style.width = Math.min(100, avg * 300) + '%';
            }
            meterRAF = requestAnimationFrame(tick);
        }
        tick();
    }

    function makeChannelRow(container: HTMLElement, info: { name: string; color: string }, level: number, idx: number): void {
        const row = document.createElement('div');
        row.style.cssText = 'margin-bottom:8px;';

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:3px;';

        const dot = document.createElement('div');
        dot.style.cssText = `width:4px;height:12px;border-radius:2px;flex-shrink:0;background:${info.color};`;
        header.appendChild(dot);

        const name = document.createElement('div');
        name.style.cssText = 'font-size:9px;font-weight:700;color:#999;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        name.textContent = info.name;
        name.title = info.name;
        header.appendChild(name);

        // Small meter bar
        const meterWrap = document.createElement('div');
        meterWrap.style.cssText = 'width:32px;height:3px;background:#111320;border-radius:2px;overflow:hidden;flex-shrink:0;';
        const meterFill = document.createElement('div');
        meterFill.style.cssText = `height:100%;width:0%;border-radius:2px;background:${info.color};transition:width 0.06s linear;`;
        meterWrap.appendChild(meterFill);
        header.appendChild(meterWrap);
        meterBars.push(meterFill);

        const val = document.createElement('div');
        val.style.cssText = 'font-size:10px;font-weight:700;color:#ddd;min-width:28px;text-align:right;flex-shrink:0;font-variant-numeric:tabular-nums;';
        val.textContent = Math.round(level * 100) + '%';
        header.appendChild(val);

        row.appendChild(header);

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = '0';
        slider.max = '1';
        slider.step = '0.01';
        slider.value = String(level);
        slider.style.cssText = 'width:100%;accent-color:#888;cursor:pointer;height:3px;';
        slider.oninput = () => {
            const v = parseFloat(slider.value);
            if (!state.levels) state.levels = defaults();
            state.levels[idx] = v;
            val.textContent = Math.round(v * 100) + '%';
            const g = window.SEQ.trackGains[idx];
            if (g) g.gain.value = v;
            window.SEQ.notifyStateChange();
        };
        row.appendChild(slider);

        container.appendChild(row);
    }

    return {
        id: 'mixer',
        name: 'Mixer',
        icon: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="1" y="7" width="2" height="7" rx="1" fill="currentColor"/><rect x="5" y="3" width="2" height="11" rx="1" fill="currentColor"/><rect x="9" y="5" width="2" height="9" rx="1" fill="currentColor"/><rect x="13" y="1" width="2" height="13" rx="1" fill="currentColor"/></svg>',

        init(ctx: AudioContext): NodePair {
            const gains = window.SEQ.trackGains;
            analysers = [];
            for (let i = 0; i < gains.length; i++) {
                const g = gains[i];
                if (!g) continue;
                const a = ctx.createAnalyser();
                a.fftSize = 256;
                a.smoothingTimeConstant = 0.7;
                g.connect(a);
                analysers.push(a);
            }
            applyLevels();
            const pass = ctx.createGain();
            return { input: pass, output: pass };
        },

        createUI(container: HTMLElement): void {
            container.innerHTML = '';
            meterBars = [];

            const title = document.createElement('div');
            title.style.cssText = 'font-size:8px;font-weight:700;letter-spacing:2px;color:#666;margin-bottom:16px;padding-bottom:8px;border-bottom:1px solid #2a2a32;';
            title.textContent = 'CHANNEL LEVELS';
            container.appendChild(title);

            const lvls = getLevels();
            const count = window.SEQ.trackCount;

            for (let i = 0; i < count; i++) {
                const info = window.SEQ.getTrackInfo(i);
                makeChannelRow(container, info, lvls[i] ?? 0.8, i);
            }

            // Master section
            const sep = document.createElement('div');
            sep.style.cssText = 'margin-top:14px;padding-top:12px;border-top:1px solid #2a2a32;';
            container.appendChild(sep);

            const masterGain = window.SEQ.masterGain;
            const masterLvl = masterGain ? masterGain.gain.value : 1;

            const row = document.createElement('div');
            row.style.cssText = 'margin-bottom:8px;';

            const header = document.createElement('div');
            header.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:4px;';

            const dot = document.createElement('div');
            dot.style.cssText = 'width:4px;height:12px;border-radius:2px;flex-shrink:0;background:linear-gradient(180deg,#ff3b5c,#388bff);';
            header.appendChild(dot);

            const name = document.createElement('div');
            name.style.cssText = 'font-size:9px;font-weight:800;color:#999;letter-spacing:1px;flex:1;';
            name.textContent = 'MASTER';
            header.appendChild(name);

            const val = document.createElement('div');
            val.style.cssText = 'font-size:10px;font-weight:700;color:#ddd;font-variant-numeric:tabular-nums;';
            val.textContent = Math.round(masterLvl * 100) + '%';
            header.appendChild(val);

            row.appendChild(header);

            const slider = document.createElement('input');
            slider.type = 'range';
            slider.min = '0';
            slider.max = '1.0';
            slider.step = '0.01';
            slider.value = String(masterLvl);
            slider.style.cssText = 'width:100%;accent-color:#888;cursor:pointer;height:4px;';
            slider.oninput = () => {
                const v = parseFloat(slider.value);
                const mg = window.SEQ.masterGain;
                if (mg) mg.gain.value = v;
                val.textContent = Math.round(v * 100) + '%';
            };
            row.appendChild(slider);
            sep.appendChild(row);

            startMeters();
        },

        getState(): ExtensionState {
            return { levels: getLevels() };
        },

        setState(s: ExtensionState): void {
            if (s && Array.isArray(s['levels'])) {
                state.levels = [...(s['levels'] as number[])];
                applyLevels();
            }
        },

        setEnabled(on: boolean): void {
            const gains = window.SEQ.trackGains;
            if (on) {
                applyLevels();
            } else {
                for (let i = 0; i < gains.length; i++) {
                    const g = gains[i];
                    if (g) g.gain.value = 1;
                }
                const mg = window.SEQ.masterGain;
                if (mg) mg.gain.value = 1;
            }
        },

        destroy(): void {
            if (meterRAF !== null) cancelAnimationFrame(meterRAF);
            analysers.forEach(a => { try { a.disconnect(); } catch (_e) { /* already disconnected */ } });
            analysers = [];
        },
    };
}
