(function() {
    'use strict';

    // ═══════════════════════════════════════════
    //  EMT 140 PLATE REVERB
    //
    //  The EMT 140 is characterized by:
    //  - Dense, smooth decay with metallic shimmer
    //  - Bright initial reflections that darken over time
    //  - High diffusion (no distinct echoes)
    //  - Pre-delay ~20ms (mechanical plate excitation time)
    //  - Damper control affects decay time (1-5s typical)
    //  - Bass buildup characteristic of metal plate
    //  - Slight high-frequency roll-off in the tail
    //
    //  We model this with a ConvolverNode using a
    //  synthetically generated plate impulse response,
    //  plus pre-delay, input filter, damping filter,
    //  and per-channel aux sends.
    // ═══════════════════════════════════════════

    const TRACK_COUNT = 9;

    let state = {
        decay: 0.6,       // 0-1 → maps to 1-5s plate decay
        damping: 0.5,     // 0-1 → high-frequency damping (EMT damper control)
        predelay: 0.02,   // 0-0.1s pre-delay
        brightness: 0.6,  // 0-1 → tone of the plate (dark ↔ bright)
        mix: 0.3,         // 0-1 → master wet level
        sends: null,      // per-track aux send levels, null = defaults
    };

    function defaultSends() { return Array(TRACK_COUNT).fill(0.4); }
    function getSends() { return state.sends || defaultSends(); }

    let nodes = null;
    let sendGains = [];  // per-track send gain nodes
    let irBuffer = null;

    // ═══════════════════════════════════════════
    //  SYNTHETIC PLATE IR GENERATION
    //
    //  Real plate reverbs have extremely high modal
    //  density. We simulate this with shaped noise
    //  that has the EMT 140's characteristic envelope
    //  and frequency response.
    // ═══════════════════════════════════════════
    function generatePlateIR(ctx, decayTime, damping, brightness) {
        const sampleRate = ctx.sampleRate;
        const length = Math.ceil(sampleRate * decayTime);
        const buffer = ctx.createBuffer(2, length, sampleRate);

        for (let ch = 0; ch < 2; ch++) {
            const data = buffer.getChannelData(ch);
            // Seed with different random sequences per channel for stereo width
            const seed = ch * 17 + 7;

            for (let i = 0; i < length; i++) {
                const t = i / sampleRate;
                const pos = i / length;

                // Noise source (pseudo-random, seeded per channel)
                let noise = Math.random() * 2 - 1;

                // EMT 140 envelope: fast attack, exponential decay
                // Plate has very dense early reflections (no distinct echoes)
                const earlyGain = Math.exp(-t * 8) * 0.3;  // early reflection energy
                const lateGain = Math.exp(-t * (3 / decayTime));  // main decay

                // Combine early + late (plate characteristic: smooth blend)
                const envelope = earlyGain + lateGain;

                // High-frequency damping increases over time (EMT damper simulation)
                // This is the key EMT 140 character: bright attack, darkening tail
                const dampFactor = 1 - damping * pos * 0.8;
                const hfRolloff = Math.max(0.1, dampFactor);

                // Apply crude HF damping by averaging with previous sample
                if (i > 0) {
                    const prev = data[i - 1];
                    noise = noise * hfRolloff + prev * (1 - hfRolloff) * 0.5;
                }

                // Brightness: boost or cut high-frequency content
                const brightMod = 0.5 + brightness * 0.5;

                // Plate bass buildup: slight LF emphasis in the tail
                const bassBoost = 1 + (1 - pos) * 0.15;

                data[i] = noise * envelope * brightMod * bassBoost;

                // Add subtle metallic resonances (plate modes)
                // EMT 140 has characteristic resonant frequencies
                if (i > 100) {
                    const mode1 = Math.sin(i * 0.0073 + ch) * 0.02 * envelope;
                    const mode2 = Math.sin(i * 0.0127 + ch * 3) * 0.015 * envelope;
                    const mode3 = Math.sin(i * 0.0211 + ch * 5) * 0.01 * envelope;
                    data[i] += (mode1 + mode2 + mode3) * (1 - pos);
                }
            }

            // Normalize
            let peak = 0;
            for (let i = 0; i < length; i++) peak = Math.max(peak, Math.abs(data[i]));
            if (peak > 0) {
                const norm = 0.7 / peak;
                for (let i = 0; i < length; i++) data[i] *= norm;
            }
        }

        return buffer;
    }

    // ═══════════════════════════════════════════
    //  AUDIO INIT
    // ═══════════════════════════════════════════
    function init(audioCtx) {
        const decayTime = 1 + state.decay * 4; // 1-5 seconds

        // Generate plate IR
        irBuffer = generatePlateIR(audioCtx, decayTime, state.damping, state.brightness);

        // Pre-delay line
        const predelayNode = audioCtx.createDelay(0.2);
        predelayNode.delayTime.value = state.predelay;

        // Convolver with plate IR
        const convolver = audioCtx.createConvolver();
        convolver.buffer = irBuffer;

        // Input filter: EMT 140 has a slight HPF on input (~100Hz)
        // to prevent plate from booming
        const inputHPF = audioCtx.createBiquadFilter();
        inputHPF.type = 'highpass';
        inputHPF.frequency.value = 100;
        inputHPF.Q.value = 0.5;

        // Output damping filter: adjustable LPF
        const dampFilter = audioCtx.createBiquadFilter();
        dampFilter.type = 'lowpass';
        dampFilter.frequency.value = 2000 + (1 - state.damping) * 10000;
        dampFilter.Q.value = 0.5;

        // Wet gain
        const wetGain = audioCtx.createGain();
        wetGain.gain.value = state.mix;

        // Send bus: all per-track sends merge here
        const sendBus = audioCtx.createGain();
        sendBus.gain.value = 1;

        // Create per-track send gain nodes
        // Each connects from the track's gain node to the send bus
        sendGains = [];
        const trackGainsArr = SEQ.trackGains;
        const sends = getSends();
        for (let i = 0; i < trackGainsArr.length; i++) {
            const sg = audioCtx.createGain();
            sg.gain.value = sends[i] !== undefined ? sends[i] : 0.4;
            trackGainsArr[i].connect(sg);
            sg.connect(sendBus);
            sendGains.push(sg);
        }

        // Chain: sendBus → inputHPF → predelay → convolver → dampFilter → wetGain
        sendBus.connect(inputHPF);
        inputHPF.connect(predelayNode);
        predelayNode.connect(convolver);
        convolver.connect(dampFilter);
        dampFilter.connect(wetGain);

        nodes = { sendBus, inputHPF, predelayNode, convolver, dampFilter, wetGain, ctx: audioCtx };

        // The reverb output (wetGain) needs to connect to wherever the master chain goes
        // Return pass-through for the main chain, but connect wet directly to master
        const pass = audioCtx.createGain();
        // Connect wet output to master gain (bypassing the main extension chain insert)
        wetGain.connect(SEQ.masterGain);

        // Fade out reverb tail when playback stops
        SEQ.onStop(() => {
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
    }

    function rebuildIR() {
        if (!nodes) return;
        const decayTime = 1 + state.decay * 4;
        irBuffer = generatePlateIR(nodes.ctx, decayTime, state.damping, state.brightness);
        nodes.convolver.buffer = irBuffer;
    }

    function applyState() {
        if (!nodes) return;
        nodes.predelayNode.delayTime.value = state.predelay;
        nodes.dampFilter.frequency.value = 2000 + (1 - state.damping) * 10000;
        nodes.wetGain.gain.value = state.mix;
        const sends = getSends();
        for (let i = 0; i < sendGains.length; i++) {
            sendGains[i].gain.value = sends[i] !== undefined ? sends[i] : 0.4;
        }
    }

    // ═══════════════════════════════════════════
    //  UI
    // ═══════════════════════════════════════════
    function createUI(container) {
        container.innerHTML = '';

        const title = document.createElement('div');
        title.style.cssText = 'font-size:8px;font-weight:700;letter-spacing:2px;color:#666;margin-bottom:20px;padding-bottom:8px;border-bottom:1px solid #2a2a32;';
        title.textContent = 'EMT 140 PLATE REVERB';
        container.appendChild(title);

        // Master controls
        makeSlider(container, 'DECAY', state.decay, 0, 1, 0.01,
            v => (1 + v * 4).toFixed(1) + 's',
            v => { state.decay = v; rebuildIR(); SEQ.notifyStateChange(); });

        makeSlider(container, 'DAMPING', state.damping, 0, 1, 0.01,
            v => Math.round(v * 100) + '%',
            v => { state.damping = v; applyState(); rebuildIR(); SEQ.notifyStateChange(); });

        makeSlider(container, 'PRE-DELAY', state.predelay, 0, 0.1, 0.001,
            v => Math.round(v * 1000) + 'ms',
            v => { state.predelay = v; applyState(); SEQ.notifyStateChange(); });

        makeSlider(container, 'BRIGHTNESS', state.brightness, 0, 1, 0.01,
            v => Math.round(v * 100) + '%',
            v => { state.brightness = v; rebuildIR(); SEQ.notifyStateChange(); });

        makeSlider(container, 'WET LEVEL', state.mix, 0, 1, 0.01,
            v => Math.round(v * 100) + '%',
            v => { state.mix = v; applyState(); SEQ.notifyStateChange(); });

        // Per-channel aux sends
        const auxSec = document.createElement('div');
        auxSec.style.cssText = 'margin-top:20px;padding-top:14px;border-top:1px solid #2a2a32;';

        const auxTitle = document.createElement('div');
        auxTitle.style.cssText = 'font-size:8px;font-weight:700;letter-spacing:2px;color:#666;margin-bottom:12px;';
        auxTitle.textContent = 'AUX SENDS';
        auxSec.appendChild(auxTitle);

        const sends = getSends();
        const count = SEQ.trackCount;

        for (let i = 0; i < count; i++) {
            const info = SEQ.getTrackInfo(i);
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
            slider.type = 'range'; slider.min = 0; slider.max = 1; slider.step = 0.01;
            slider.value = sends[i] !== undefined ? sends[i] : 0.4;
            slider.style.cssText = `flex:1;accent-color:#888;cursor:pointer;height:3px;`;
            const idx = i;
            const val = document.createElement('div');
            val.style.cssText = 'font-size:9px;font-weight:700;color:#777;width:20px;text-align:right;flex-shrink:0;font-variant-numeric:tabular-nums;';
            val.textContent = Math.round((sends[i] !== undefined ? sends[i] : 0.4) * 100);

            slider.oninput = () => {
                const v = parseFloat(slider.value);
                if (!state.sends) state.sends = defaultSends();
                state.sends[idx] = v;
                val.textContent = Math.round(v * 100);
                if (sendGains[idx]) sendGains[idx].gain.value = v;
                SEQ.notifyStateChange();
            };

            row.appendChild(slider);
            row.appendChild(val);
            auxSec.appendChild(row);
        }

        container.appendChild(auxSec);
    }

    function makeSlider(container, label, value, min, max, step, format, onChange) {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'margin-bottom:14px;';

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;margin-bottom:5px;';

        const lbl = document.createElement('div');
        lbl.style.cssText = 'font-size:8px;font-weight:800;letter-spacing:2px;color:#999;';
        lbl.textContent = label;

        const val = document.createElement('div');
        val.style.cssText = 'font-size:10px;font-weight:700;color:#ddd;font-variant-numeric:tabular-nums;';
        val.textContent = format(value);

        header.appendChild(lbl);
        header.appendChild(val);
        wrap.appendChild(header);

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = min; slider.max = max; slider.step = step;
        slider.value = value;
        slider.style.cssText = 'width:100%;accent-color:#888;cursor:pointer;height:4px;';
        slider.oninput = () => {
            const v = parseFloat(slider.value);
            val.textContent = format(v);
            onChange(v);
        };
        wrap.appendChild(slider);
        container.appendChild(wrap);
    }

    // ═══════════════════════════════════════════
    //  PERSISTENCE
    // ═══════════════════════════════════════════
    function getState() { return { ...state, sends: getSends() }; }

    function setState(s) {
        if (s) {
            state = { ...state, ...s };
            applyState();
            if (nodes) rebuildIR();
        }
    }

    function setEnabled(on) {
        if (!nodes) return;
        if (on) { applyState(); }
        else { nodes.wetGain.gain.value = 0; for (const sg of sendGains) sg.gain.value = 0; }
    }

    function destroy() {
        sendGains.forEach(sg => { try { sg.disconnect(); } catch(e) {} });
        sendGains = [];
        if (nodes) {
            Object.values(nodes).forEach(n => { if (n && n.disconnect) try { n.disconnect(); } catch(e) {} });
            nodes = null;
        }
    }

    // ═══════════════════════════════════════════
    //  REGISTER
    // ═══════════════════════════════════════════
    window.SEQ.register({
        id: 'reverb',
        name: 'Plate Reverb',
        icon: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 8c0-3 2-5 5-5s5 2 5 5-2 5-5 5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M5 8c0-2 1.3-3 3-3s3 1 3 3-1.3 3-3 3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" opacity="0.6"/><circle cx="8" cy="8" r="1" fill="currentColor" opacity="0.4"/></svg>',
        init,
        createUI,
        getState,
        setState,
        setEnabled,
        destroy,
    });

})();
