(function() {
    'use strict';

    // ═══════════════════════════════════════════
    //  ECHOPLEX EP-3 TAPE DELAY
    //
    //  The EP-3 is characterized by:
    //  - Warm, saturated repeats that degrade naturally
    //  - Each repeat loses high-frequency content (tape head loss)
    //  - Slight pitch wobble from tape transport irregularities
    //  - Input preamp adds harmonic saturation (FET circuit)
    //  - Bass thickening on repeats (head bump)
    //  - Delay time ~40ms to 800ms (variable speed motor)
    //  - Sound-on-sound capability (high feedback = infinite hold)
    //  - The repeats sit "behind" the dry signal, never harsh
    //
    //  We model this with:
    //  - DelayNode for the delay line
    //  - BiquadFilter (LPF) in the feedback loop for tape darkening
    //  - BiquadFilter (HPF) to prevent bass mud buildup
    //  - WaveShaperNode for tape/preamp saturation
    //  - LFO (OscillatorNode → GainNode) modulating delay time
    //    for tape wobble / chorus effect
    //  - Per-channel aux sends
    // ═══════════════════════════════════════════

    const TRACK_COUNT = 9;

    let state = {
        time: 0.375,      // delay time in seconds (synced feel at 120bpm = 3/16 note)
        feedback: 0.45,    // 0-0.95 feedback amount
        tone: 0.55,        // 0-1 → feedback LPF cutoff (tape darkening)
        saturation: 0.3,   // 0-1 → tape/preamp drive
        wobble: 0.3,       // 0-1 → LFO depth (tape irregularity)
        mix: 0.25,         // 0-1 → master wet level
        sends: null,       // per-track aux send levels
    };

    function defaultSends() { return Array(TRACK_COUNT).fill(0.12); }
    function getSends() { return state.sends || defaultSends(); }

    let nodes = null;
    let sendGains = [];

    // ═══════════════════════════════════════════
    //  TAPE SATURATION CURVE
    //  EP-3's FET preamp adds warm even harmonics
    //  with soft asymmetric clipping
    // ═══════════════════════════════════════════
    function makeTapeCurve(amount) {
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
            // DC-balanced asymmetry via even harmonics (no raw offset)
            const warmth = 0.02 * amount * Math.sin(x * Math.PI);
            curve[i] = x * (1 - amount) + (shaped + warmth) * amount;
        }
        return curve;
    }

    // ═══════════════════════════════════════════
    //  AUDIO INIT
    // ═══════════════════════════════════════════
    function init(audioCtx) {
        // Send bus: all per-track sends merge here
        const sendBus = audioCtx.createGain();
        sendBus.gain.value = 1 / Math.sqrt(TRACK_COUNT); // normalize summing

        // Input saturation (EP-3 preamp)
        const inputSat = audioCtx.createWaveShaper();
        inputSat.curve = makeTapeCurve(state.saturation);
        inputSat.oversample = '2x';

        // Main delay line
        const delay = audioCtx.createDelay(2.0);
        delay.delayTime.value = state.time;

        // Feedback loop nodes
        const feedbackGain = audioCtx.createGain();
        feedbackGain.gain.value = state.feedback;

        // Tape head loss: LPF in feedback (each repeat gets darker)
        const tapeLPF = audioCtx.createBiquadFilter();
        tapeLPF.type = 'lowpass';
        tapeLPF.frequency.value = 800 + state.tone * 6000; // 800Hz - 6800Hz
        tapeLPF.Q.value = 0.5;

        // Prevent bass mud: HPF in feedback
        const tapeHPF = audioCtx.createBiquadFilter();
        tapeHPF.type = 'highpass';
        tapeHPF.frequency.value = 80; // remove sub-bass buildup
        tapeHPF.Q.value = 0.5;

        // Feedback saturation (tape re-recording degradation)
        const fbSat = audioCtx.createWaveShaper();
        fbSat.curve = makeTapeCurve(state.saturation * 0.6);
        fbSat.oversample = '2x';

        // LFO for tape wobble (transport speed irregularity)
        const lfo = audioCtx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = 0.6; // slow wobble ~0.6Hz
        const lfoGain = audioCtx.createGain();
        lfoGain.gain.value = state.wobble * 0.003; // very subtle pitch modulation
        lfo.connect(lfoGain);
        lfoGain.connect(delay.delayTime);
        lfo.start();

        // Secondary LFO for more complex wow (EP-3 had irregular motor)
        const lfo2 = audioCtx.createOscillator();
        lfo2.type = 'triangle';
        lfo2.frequency.value = 3.7; // flutter
        const lfo2Gain = audioCtx.createGain();
        lfo2Gain.gain.value = state.wobble * 0.0004; // very subtle flutter
        lfo2.connect(lfo2Gain);
        lfo2Gain.connect(delay.delayTime);
        lfo2.start();

        // Wet output gain
        const wetGain = audioCtx.createGain();
        wetGain.gain.value = state.mix;

        // Chain: sendBus → inputSat → delay → wetGain → (output to master)
        //                              ↑    ↓
        //                    feedbackGain ← tapeLPF ← tapeHPF ← fbSat ← delay
        sendBus.connect(inputSat);
        inputSat.connect(delay);
        delay.connect(wetGain);

        // Feedback loop
        delay.connect(fbSat);
        fbSat.connect(tapeHPF);
        tapeHPF.connect(tapeLPF);
        tapeLPF.connect(feedbackGain);
        feedbackGain.connect(delay);

        // Per-track send gains
        sendGains = [];
        const trackGainsArr = SEQ.trackGains;
        const sends = getSends();
        for (let i = 0; i < trackGainsArr.length; i++) {
            const sg = audioCtx.createGain();
            sg.gain.value = sends[i] !== undefined ? sends[i] : 0.35;
            trackGainsArr[i].connect(sg);
            sg.connect(sendBus);
            sendGains.push(sg);
        }

        // Connect wet output to master gain
        wetGain.connect(SEQ.masterGain);

        nodes = {
            sendBus, inputSat, delay, feedbackGain,
            tapeLPF, tapeHPF, fbSat, wetGain,
            lfo, lfoGain, lfo2, lfo2Gain,
            ctx: audioCtx
        };

        // Kill feedback tails when playback stops
        SEQ.onStop(() => {
            if (!nodes) return;
            // Rapidly fade feedback to zero, then restore after silence
            const now = nodes.ctx.currentTime;
            nodes.feedbackGain.gain.setValueAtTime(nodes.feedbackGain.gain.value, now);
            nodes.feedbackGain.gain.linearRampToValueAtTime(0, now + 0.05);
            nodes.wetGain.gain.setValueAtTime(nodes.wetGain.gain.value, now);
            nodes.wetGain.gain.linearRampToValueAtTime(0, now + 0.15);
            // Restore values after tail dies
            setTimeout(() => {
                if (!nodes) return;
                nodes.feedbackGain.gain.cancelScheduledValues(0);
                nodes.feedbackGain.gain.value = Math.min(state.feedback, 0.95);
                nodes.wetGain.gain.cancelScheduledValues(0);
                nodes.wetGain.gain.value = state.mix;
            }, 300);
        });

        // Pass-through for the main extension chain (delay is an aux effect)
        const pass = audioCtx.createGain();
        return { input: pass, output: pass };
    }

    function applyState() {
        if (!nodes) return;
        nodes.delay.delayTime.setTargetAtTime(state.time, nodes.ctx.currentTime, 0.05);
        nodes.feedbackGain.gain.value = Math.min(state.feedback, 0.95);
        nodes.tapeLPF.frequency.value = 800 + state.tone * 6000;
        nodes.inputSat.curve = makeTapeCurve(state.saturation);
        nodes.fbSat.curve = makeTapeCurve(state.saturation * 0.6);
        nodes.lfoGain.gain.value = state.wobble * 0.003;
        nodes.lfo2Gain.gain.value = state.wobble * 0.0004;
        nodes.wetGain.gain.value = state.mix;
        const sends = getSends();
        for (let i = 0; i < sendGains.length; i++) {
            sendGains[i].gain.value = sends[i] !== undefined ? sends[i] : 0.35;
        }
    }

    // ═══════════════════════════════════════════
    //  UI
    // ═══════════════════════════════════════════
    function createUI(container) {
        container.innerHTML = '';

        const title = document.createElement('div');
        title.style.cssText = 'font-size:8px;font-weight:700;letter-spacing:2px;color:#666;margin-bottom:20px;padding-bottom:8px;border-bottom:1px solid #2a2a32;';
        title.textContent = 'ECHOPLEX EP-3 TAPE DELAY';
        container.appendChild(title);

        makeSlider(container, 'TIME', state.time, 0.04, 0.8, 0.001,
            v => Math.round(v * 1000) + 'ms',
            v => { state.time = v; applyState(); SEQ.notifyStateChange(); });

        makeSlider(container, 'FEEDBACK', state.feedback, 0, 0.95, 0.01,
            v => Math.round(v * 100) + '%',
            v => { state.feedback = v; applyState(); SEQ.notifyStateChange(); });

        makeSlider(container, 'TONE', state.tone, 0, 1, 0.01,
            v => { const hz = 800 + v * 6000; return hz < 1000 ? Math.round(hz) + 'Hz' : (hz/1000).toFixed(1) + 'kHz'; },
            v => { state.tone = v; applyState(); SEQ.notifyStateChange(); });

        makeSlider(container, 'SATURATION', state.saturation, 0, 1, 0.01,
            v => Math.round(v * 100) + '%',
            v => { state.saturation = v; applyState(); SEQ.notifyStateChange(); });

        makeSlider(container, 'WOBBLE', state.wobble, 0, 1, 0.01,
            v => Math.round(v * 100) + '%',
            v => { state.wobble = v; applyState(); SEQ.notifyStateChange(); });

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
            slider.value = sends[i] !== undefined ? sends[i] : 0.35;
            slider.style.cssText = `flex:1;accent-color:#888;cursor:pointer;height:3px;`;
            const idx = i;
            const val = document.createElement('div');
            val.style.cssText = 'font-size:9px;font-weight:700;color:#777;width:20px;text-align:right;flex-shrink:0;font-variant-numeric:tabular-nums;';
            val.textContent = Math.round((sends[i] !== undefined ? sends[i] : 0.35) * 100);

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
        if (s) { state = { ...state, ...s }; applyState(); }
    }

    function setEnabled(on) {
        if (!nodes) return;
        if (on) { applyState(); }
        else { nodes.wetGain.gain.value = 0; nodes.feedbackGain.gain.value = 0; for (const sg of sendGains) sg.gain.value = 0; }
    }

    function destroy() {
        sendGains.forEach(sg => { try { sg.disconnect(); } catch(e) {} });
        sendGains = [];
        if (nodes) {
            try { nodes.lfo.stop(); } catch(e) {}
            try { nodes.lfo2.stop(); } catch(e) {}
            Object.values(nodes).forEach(n => { if (n && n.disconnect) try { n.disconnect(); } catch(e) {} });
            nodes = null;
        }
    }

    // ═══════════════════════════════════════════
    //  REGISTER
    // ═══════════════════════════════════════════
    window.SEQ.register({
        id: 'delay',
        name: 'Tape Delay',
        icon: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="5" cy="8" r="3.5" stroke="currentColor" stroke-width="1.3"/><circle cx="11" cy="8" r="3.5" stroke="currentColor" stroke-width="1.3"/><line x1="5" y1="4.5" x2="11" y2="4.5" stroke="currentColor" stroke-width="1" opacity="0.4"/><line x1="5" y1="11.5" x2="11" y2="11.5" stroke="currentColor" stroke-width="1" opacity="0.4"/></svg>',
        init,
        createUI,
        setEnabled,
        getState,
        setState,
        destroy,
    });

})();
