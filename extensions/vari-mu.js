(function() {
    'use strict';

    // ═══════════════════════════════════════════
    //  STATE
    // ═══════════════════════════════════════════
    let state = {
        drive: 0.3,
        compress: -24,
        ratio: 4,
        knee: 30,
        speed: 2,
        mix: 1.0,
        output: 0.7,
    };

    const SPEED_PRESETS = [
        { attack: 0.002, release: 0.05,  label: 'FAST' },
        { attack: 0.01,  release: 0.15,  label: 'MED' },
        { attack: 0.05,  release: 0.4,   label: 'SLOW' },
        { attack: 0.1,   release: 0.8,   label: 'HOLD' },
    ];

    let nodes = null;
    let uiRefs = {};
    let grRAF = null;

    // ═══════════════════════════════════════════
    //  TUBE SATURATION CURVE
    // ═══════════════════════════════════════════
    function makeTubeCurve(amount) {
        const k = amount * 50 + 1;
        const n = 8192;
        const curve = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            const x = (i * 2) / n - 1;
            // Soft-clip with even-harmonic bias
            curve[i] = (Math.PI + k) * x / (Math.PI + k * Math.abs(x));
            // Subtle even-harmonic warmth
            curve[i] += 0.04 * amount * (x * x - Math.abs(x));
        }
        return curve;
    }

    // ═══════════════════════════════════════════
    //  AUDIO INIT
    // ═══════════════════════════════════════════
    function init(audioCtx) {
        const inputGain  = audioCtx.createGain();
        const waveshaper = audioCtx.createWaveShaper();
        const compressor = audioCtx.createDynamicsCompressor();
        const wetGain    = audioCtx.createGain();
        const dryGain    = audioCtx.createGain();
        const outputGain = audioCtx.createGain();

        // Chain: input → waveshaper → compressor → wetGain → output
        //        input → dryGain ──────────────────────────→ output
        inputGain.connect(waveshaper);
        waveshaper.connect(compressor);
        compressor.connect(wetGain);
        wetGain.connect(outputGain);

        inputGain.connect(dryGain);
        dryGain.connect(outputGain);

        waveshaper.oversample = '4x';

        nodes = { inputGain, waveshaper, compressor, wetGain, dryGain, outputGain, ctx: audioCtx };
        applyState();

        return { input: inputGain, output: outputGain };
    }

    function applyState() {
        if (!nodes) return;
        const { inputGain, waveshaper, compressor, wetGain, dryGain, outputGain } = nodes;

        inputGain.gain.value = 1 + state.drive * 3;
        waveshaper.curve = makeTubeCurve(state.drive);

        compressor.threshold.value = state.compress;
        compressor.ratio.value = state.ratio;
        compressor.knee.value = state.knee;

        const preset = SPEED_PRESETS[state.speed] || SPEED_PRESETS[2];
        compressor.attack.value = preset.attack;
        compressor.release.value = preset.release;

        wetGain.gain.value = state.mix;
        dryGain.gain.value = 1 - state.mix;

        outputGain.gain.value = state.output * 2;
    }

    // ═══════════════════════════════════════════
    //  UI
    // ═══════════════════════════════════════════
    function createUI(container) {
        container.innerHTML = '';
        uiRefs = {};

        // Subtle section header
        const title = document.createElement('div');
        title.style.cssText = 'font-size:8px;font-weight:700;letter-spacing:2px;color:#666;margin-bottom:20px;padding-bottom:8px;border-bottom:1px solid #2a2a32;';
        title.textContent = 'TUBE BUS COMPRESSOR';
        container.appendChild(title);

        makeSlider(container, 'DRIVE', state.drive, 0, 1, 0.01,
            v => formatPct(v), v => { state.drive = v; applyState(); SEQ.notifyStateChange(); });

        makeSlider(container, 'COMPRESS', state.compress, -50, 0, 1,
            v => Math.round(v) + ' dB', v => { state.compress = v; applyState(); SEQ.notifyStateChange(); });

        makeSlider(container, 'RATIO', state.ratio, 1, 20, 0.5,
            v => v.toFixed(1) + ':1', v => { state.ratio = v; applyState(); SEQ.notifyStateChange(); });

        makeSlider(container, 'KNEE', state.knee, 0, 40, 1,
            v => Math.round(v) + ' dB', v => { state.knee = v; applyState(); SEQ.notifyStateChange(); });

        makeSlider(container, 'SPEED', state.speed, 0, 3, 1,
            v => SPEED_PRESETS[Math.round(v)]?.label || '', v => { state.speed = Math.round(v); applyState(); SEQ.notifyStateChange(); });

        makeSlider(container, 'MIX', state.mix, 0, 1, 0.01,
            v => formatPct(v), v => { state.mix = v; applyState(); SEQ.notifyStateChange(); });

        makeSlider(container, 'OUTPUT', state.output, 0, 1, 0.01,
            v => formatPct(v), v => { state.output = v; applyState(); SEQ.notifyStateChange(); });

        // GR Meter
        const grSec = document.createElement('div');
        grSec.style.cssText = 'margin-top:24px;padding-top:16px;border-top:1px solid #2a2a32;';

        const grLabel = document.createElement('div');
        grLabel.style.cssText = 'font-size:8px;font-weight:800;letter-spacing:2px;color:#666;margin-bottom:8px;';
        grLabel.textContent = 'GAIN REDUCTION';
        grSec.appendChild(grLabel);

        const grTrack = document.createElement('div');
        grTrack.style.cssText = 'height:6px;background:#111320;border-radius:3px;overflow:hidden;border:1px solid #2a2a32;';
        const grFill = document.createElement('div');
        grFill.style.cssText = 'height:100%;width:0%;background:linear-gradient(90deg,#ff8c38,#ff3b5c);border-radius:3px;transition:width 0.06s linear;';
        grTrack.appendChild(grFill);
        grSec.appendChild(grTrack);

        const grVal = document.createElement('div');
        grVal.style.cssText = 'font-size:10px;font-weight:700;color:#ff8c38;margin-top:4px;text-align:right;font-variant-numeric:tabular-nums;';
        grVal.textContent = '0.0 dB';
        grSec.appendChild(grVal);
        container.appendChild(grSec);

        uiRefs.grFill = grFill;
        uiRefs.grVal = grVal;
        startGRMeter();
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
        return { slider, val };
    }

    function formatPct(v) { return Math.round(v * 100) + '%'; }

    function startGRMeter() {
        if (grRAF) cancelAnimationFrame(grRAF);
        function tick() {
            if (nodes && uiRefs.grFill) {
                const gr = nodes.compressor.reduction; // negative dB
                const pct = Math.min(100, Math.abs(gr) * 3.33);
                uiRefs.grFill.style.width = pct + '%';
                uiRefs.grVal.textContent = gr.toFixed(1) + ' dB';
            }
            grRAF = requestAnimationFrame(tick);
        }
        tick();
    }

    // ═══════════════════════════════════════════
    //  PERSISTENCE
    // ═══════════════════════════════════════════
    function getState() { return { ...state }; }

    function setState(s) {
        if (s) { state = { ...state, ...s }; applyState(); }
    }

    function setEnabled(on) {
        if (!nodes) return;
        if (on) { applyState(); }
        else { nodes.wetGain.gain.value = 0; nodes.dryGain.gain.value = 1; nodes.inputGain.gain.value = 1; }
    }

    function destroy() {
        if (grRAF) cancelAnimationFrame(grRAF);
        if (nodes) {
            Object.values(nodes).forEach(n => { if (n && n.disconnect) try { n.disconnect(); } catch(e) {} });
            nodes = null;
        }
    }

    // ═══════════════════════════════════════════
    //  REGISTER
    // ═══════════════════════════════════════════
    window.SEQ.register({
        id: 'vari-mu',
        name: 'Vari-Mu',
        icon: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 12L5 4L8 10L11 2L14 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        init,
        createUI,
        getState,
        setState,
        setEnabled,
        destroy,
    });

})();
