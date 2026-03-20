(function() {
    'use strict';

    // ═══════════════════════════════════════════
    //  PULTEC EQP-1A PROGRAM EQUALIZER
    //
    //  The Pultec is characterized by:
    //  - Passive LC filter network with tube makeup amp
    //  - Famous "low-frequency trick": boost AND cut at
    //    the same frequency creates a unique shelf shape
    //    (boost, then dip just above, then flat)
    //  - Very broad, musical curves (low Q)
    //  - Tube amplifier adds warmth and subtle saturation
    //  - Controls: Low Boost, Low Atten, Low Freq select,
    //    High Boost, High Atten (shelf), High Freq select,
    //    Bandwidth (high boost Q)
    //
    //  We model this with BiquadFilter nodes:
    //  - Low shelf (boost) + Low shelf (cut) at same freq
    //  - High peaking (boost) at selected freq + bandwidth
    //  - High shelf (cut) for the atten
    //  - WaveShaperNode for tube amplifier coloration
    // ═══════════════════════════════════════════

    let state = {
        lowBoost: 0,       // 0-10 (dB boost)
        lowAtten: 0,       // 0-10 (dB cut)
        lowFreq: 60,       // Hz: 20, 30, 60, 100
        highBoost: 0,      // 0-10 (dB boost)
        highBandwidth: 0.5,// 0-1 → Q from broad to sharp
        highAtten: 0,      // 0-10 (dB cut)
        highBoostFreq: 5000, // Hz: 3k, 4k, 5k, 8k, 10k, 12k, 16k
        highAttenFreq: 10000, // Hz: 5k, 10k, 20k
        tubeColor: 0.2,    // 0-1 → tube saturation amount
    };

    let nodes = null;

    // Tube amplifier saturation (subtle even harmonics)
    function makeTubeCurve(amount) {
        const k = amount * 15 + 1;
        const n = 4096;
        const curve = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            const x = (i * 2) / n - 1;
            curve[i] = (Math.PI + k) * x / (Math.PI + k * Math.abs(x));
            curve[i] += 0.015 * amount * (x * x - Math.abs(x)); // even harmonics
        }
        return curve;
    }

    // ═══════════════════════════════════════════
    //  AUDIO
    // ═══════════════════════════════════════════
    function init(audioCtx) {
        // Low shelf boost
        const lowBoostFilter = audioCtx.createBiquadFilter();
        lowBoostFilter.type = 'lowshelf';
        lowBoostFilter.frequency.value = state.lowFreq;
        lowBoostFilter.gain.value = state.lowBoost;

        // Low shelf cut (same frequency — the Pultec trick!)
        const lowAttenFilter = audioCtx.createBiquadFilter();
        lowAttenFilter.type = 'lowshelf';
        lowAttenFilter.frequency.value = state.lowFreq;
        lowAttenFilter.gain.value = -state.lowAtten;

        // High boost (peaking filter)
        const highBoostFilter = audioCtx.createBiquadFilter();
        highBoostFilter.type = 'peaking';
        highBoostFilter.frequency.value = state.highBoostFreq;
        highBoostFilter.gain.value = state.highBoost;
        highBoostFilter.Q.value = 0.5 + state.highBandwidth * 3; // 0.5 to 3.5

        // High atten (high shelf cut)
        const highAttenFilter = audioCtx.createBiquadFilter();
        highAttenFilter.type = 'highshelf';
        highAttenFilter.frequency.value = state.highAttenFreq;
        highAttenFilter.gain.value = -state.highAtten;

        // Tube amplifier coloration
        const tubeSat = audioCtx.createWaveShaper();
        tubeSat.curve = makeTubeCurve(state.tubeColor);
        tubeSat.oversample = '2x';

        // Output gain (makeup)
        const outputGain = audioCtx.createGain();
        outputGain.gain.value = 1;

        // Chain: input → lowBoost → lowAtten → highBoost → highAtten → tubeSat → output
        lowBoostFilter.connect(lowAttenFilter);
        lowAttenFilter.connect(highBoostFilter);
        highBoostFilter.connect(highAttenFilter);
        highAttenFilter.connect(tubeSat);
        tubeSat.connect(outputGain);

        nodes = { lowBoostFilter, lowAttenFilter, highBoostFilter, highAttenFilter, tubeSat, outputGain, ctx: audioCtx };

        return { input: lowBoostFilter, output: outputGain };
    }

    function applyState() {
        if (!nodes) return;
        const { lowBoostFilter, lowAttenFilter, highBoostFilter, highAttenFilter, tubeSat } = nodes;

        lowBoostFilter.frequency.value = state.lowFreq;
        lowBoostFilter.gain.value = state.lowBoost;

        lowAttenFilter.frequency.value = state.lowFreq;
        lowAttenFilter.gain.value = -state.lowAtten;

        highBoostFilter.frequency.value = state.highBoostFreq;
        highBoostFilter.gain.value = state.highBoost;
        highBoostFilter.Q.value = 0.5 + state.highBandwidth * 3;

        highAttenFilter.frequency.value = state.highAttenFreq;
        highAttenFilter.gain.value = -state.highAtten;

        tubeSat.curve = makeTubeCurve(state.tubeColor);
    }

    // ═══════════════════════════════════════════
    //  UI
    // ═══════════════════════════════════════════
    function createUI(container) {
        container.innerHTML = '';

        const title = document.createElement('div');
        title.style.cssText = 'font-size:8px;font-weight:700;letter-spacing:2px;color:#505478;margin-bottom:20px;padding-bottom:8px;border-bottom:1px solid #1e2036;';
        title.textContent = 'PULTEC EQP-1A PROGRAM EQ';
        container.appendChild(title);

        // LOW section
        sectionLabel(container, 'LOW FREQUENCY');

        makeSlider(container, 'BOOST', state.lowBoost, 0, 10, 0.1,
            v => v.toFixed(1) + ' dB',
            v => { state.lowBoost = v; applyState(); SEQ.notifyStateChange(); });

        makeSlider(container, 'ATTEN', state.lowAtten, 0, 10, 0.1,
            v => v.toFixed(1) + ' dB',
            v => { state.lowAtten = v; applyState(); SEQ.notifyStateChange(); });

        makeSelect(container, 'FREQ', state.lowFreq,
            [{ v: 20, l: '20 Hz' }, { v: 30, l: '30 Hz' }, { v: 60, l: '60 Hz' }, { v: 100, l: '100 Hz' }],
            v => { state.lowFreq = v; applyState(); SEQ.notifyStateChange(); });

        // HIGH section
        sectionLabel(container, 'HIGH FREQUENCY');

        makeSlider(container, 'BOOST', state.highBoost, 0, 10, 0.1,
            v => v.toFixed(1) + ' dB',
            v => { state.highBoost = v; applyState(); SEQ.notifyStateChange(); });

        makeSlider(container, 'BANDWIDTH', state.highBandwidth, 0, 1, 0.01,
            v => v < 0.33 ? 'BROAD' : v < 0.66 ? 'MEDIUM' : 'SHARP',
            v => { state.highBandwidth = v; applyState(); SEQ.notifyStateChange(); });

        makeSelect(container, 'BOOST FREQ', state.highBoostFreq,
            [{ v: 3000, l: '3 kHz' }, { v: 4000, l: '4 kHz' }, { v: 5000, l: '5 kHz' },
             { v: 8000, l: '8 kHz' }, { v: 10000, l: '10 kHz' }, { v: 12000, l: '12 kHz' }, { v: 16000, l: '16 kHz' }],
            v => { state.highBoostFreq = v; applyState(); SEQ.notifyStateChange(); });

        makeSlider(container, 'ATTEN', state.highAtten, 0, 10, 0.1,
            v => v.toFixed(1) + ' dB',
            v => { state.highAtten = v; applyState(); SEQ.notifyStateChange(); });

        makeSelect(container, 'ATTEN FREQ', state.highAttenFreq,
            [{ v: 5000, l: '5 kHz' }, { v: 10000, l: '10 kHz' }, { v: 20000, l: '20 kHz' }],
            v => { state.highAttenFreq = v; applyState(); SEQ.notifyStateChange(); });

        // TUBE section
        sectionLabel(container, 'AMPLIFIER');

        makeSlider(container, 'TUBE COLOR', state.tubeColor, 0, 1, 0.01,
            v => Math.round(v * 100) + '%',
            v => { state.tubeColor = v; applyState(); SEQ.notifyStateChange(); });
    }

    function sectionLabel(container, text) {
        const s = document.createElement('div');
        s.style.cssText = 'font-size:7px;font-weight:800;letter-spacing:2px;color:#505478;margin-top:16px;margin-bottom:10px;padding-top:10px;border-top:1px solid #1e2036;';
        s.textContent = text;
        container.appendChild(s);
    }

    function makeSlider(container, label, value, min, max, step, format, onChange) {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'margin-bottom:12px;';
        const header = document.createElement('div');
        header.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px;';
        const lbl = document.createElement('div');
        lbl.style.cssText = 'font-size:8px;font-weight:800;letter-spacing:1.5px;color:#7e82a0;';
        lbl.textContent = label;
        const val = document.createElement('div');
        val.style.cssText = 'font-size:10px;font-weight:700;color:#e0e0ee;font-variant-numeric:tabular-nums;';
        val.textContent = format(value);
        header.appendChild(lbl); header.appendChild(val); wrap.appendChild(header);
        const slider = document.createElement('input');
        slider.type = 'range'; slider.min = min; slider.max = max; slider.step = step; slider.value = value;
        slider.style.cssText = 'width:100%;accent-color:#ff5070;cursor:pointer;height:4px;';
        slider.oninput = () => { const v = parseFloat(slider.value); val.textContent = format(v); onChange(v); };
        wrap.appendChild(slider); container.appendChild(wrap);
    }

    function makeSelect(container, label, currentVal, options, onChange) {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:12px;';
        const lbl = document.createElement('div');
        lbl.style.cssText = 'font-size:8px;font-weight:800;letter-spacing:1.5px;color:#7e82a0;width:70px;flex-shrink:0;';
        lbl.textContent = label;
        wrap.appendChild(lbl);
        const sel = document.createElement('select');
        sel.style.cssText = 'flex:1;background:#181a2a;border:1px solid #2e3150;border-radius:4px;color:#e0e0ee;padding:3px 6px;font-size:10px;font-family:inherit;cursor:pointer;';
        options.forEach(o => {
            const opt = document.createElement('option');
            opt.value = o.v; opt.textContent = o.l;
            if (o.v === currentVal) opt.selected = true;
            sel.appendChild(opt);
        });
        sel.onchange = () => onChange(parseFloat(sel.value));
        wrap.appendChild(sel); container.appendChild(wrap);
    }

    // ═══════════════════════════════════════════
    //  BYPASS / PERSISTENCE
    // ═══════════════════════════════════════════
    function setEnabled(on) {
        if (!nodes) return;
        if (on) { applyState(); }
        else {
            // Flatten all EQ bands
            nodes.lowBoostFilter.gain.value = 0;
            nodes.lowAttenFilter.gain.value = 0;
            nodes.highBoostFilter.gain.value = 0;
            nodes.highAttenFilter.gain.value = 0;
            nodes.tubeSat.curve = makeTubeCurve(0);
        }
    }

    function getState() { return { ...state }; }

    function setState(s) {
        if (s) { state = { ...state, ...s }; applyState(); }
    }

    function destroy() {
        if (nodes) {
            Object.values(nodes).forEach(n => { if (n && n.disconnect) try { n.disconnect(); } catch(e) {} });
            nodes = null;
        }
    }

    // ═══════════════════════════════════════════
    //  REGISTER
    // ═══════════════════════════════════════════
    window.SEQ.register({
        id: 'pultec-eq',
        name: 'Pultec EQ',
        icon: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M1 10 Q4 4 8 8 Q12 12 15 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="1" y1="13" x2="15" y2="13" stroke="currentColor" stroke-width="0.8" opacity="0.3"/></svg>',
        init,
        createUI,
        getState,
        setState,
        setEnabled,
        destroy,
    });

})();
