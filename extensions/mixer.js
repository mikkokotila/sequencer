(function() {
    'use strict';

    const TRACK_COUNT = 9;
    let state = { levels: null };
    let analysers = [];
    let meterRAF = null;
    let meterBars = [];

    function defaults() { return Array(TRACK_COUNT).fill(0.8); }
    function getLevels() { return state.levels || defaults(); }

    function init(audioCtx) {
        const gains = SEQ.trackGains;
        analysers = [];
        for (let i = 0; i < gains.length; i++) {
            const a = audioCtx.createAnalyser();
            a.fftSize = 256;
            a.smoothingTimeConstant = 0.7;
            gains[i].connect(a);
            analysers.push(a);
        }
        applyLevels();
        const pass = audioCtx.createGain();
        return { input: pass, output: pass };
    }

    function applyLevels() {
        const gains = SEQ.trackGains;
        const lvls = getLevels();
        for (let i = 0; i < gains.length; i++) {
            gains[i].gain.value = lvls[i] !== undefined ? lvls[i] : 0.8;
        }
    }

    function createUI(container) {
        container.innerHTML = '';
        meterBars = [];

        const title = document.createElement('div');
        title.style.cssText = 'font-size:8px;font-weight:700;letter-spacing:2px;color:#505478;margin-bottom:16px;padding-bottom:8px;border-bottom:1px solid #1e2036;';
        title.textContent = 'CHANNEL LEVELS';
        container.appendChild(title);

        const lvls = getLevels();
        const count = SEQ.trackCount;

        for (let i = 0; i < count; i++) {
            const info = SEQ.getTrackInfo(i);
            makeChannelRow(container, info, lvls[i] !== undefined ? lvls[i] : 0.8, i, false);
        }

        // Master section
        const sep = document.createElement('div');
        sep.style.cssText = 'margin-top:14px;padding-top:12px;border-top:1px solid #1e2036;';
        container.appendChild(sep);

        const masterInfo = { name: 'MASTER', color: '#388bff' };
        const masterLvl = SEQ.masterGain ? SEQ.masterGain.gain.value : 1;

        const row = document.createElement('div');
        row.style.cssText = 'margin-bottom:8px;';

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:4px;';

        const dot = document.createElement('div');
        dot.style.cssText = 'width:4px;height:12px;border-radius:2px;flex-shrink:0;background:linear-gradient(180deg,#ff3b5c,#388bff);';
        header.appendChild(dot);

        const name = document.createElement('div');
        name.style.cssText = 'font-size:9px;font-weight:800;color:#e0e0ee;letter-spacing:1px;flex:1;';
        name.textContent = 'MASTER';
        header.appendChild(name);

        const val = document.createElement('div');
        val.style.cssText = 'font-size:10px;font-weight:700;color:#e0e0ee;font-variant-numeric:tabular-nums;';
        val.textContent = Math.round(masterLvl * 100) + '%';
        header.appendChild(val);

        row.appendChild(header);

        const slider = document.createElement('input');
        slider.type = 'range'; slider.min = 0; slider.max = 1.5; slider.step = 0.01;
        slider.value = masterLvl;
        slider.style.cssText = 'width:100%;accent-color:#388bff;cursor:pointer;height:4px;';
        slider.oninput = () => {
            const v = parseFloat(slider.value);
            if (SEQ.masterGain) SEQ.masterGain.gain.value = v;
            val.textContent = Math.round(v * 100) + '%';
        };
        row.appendChild(slider);
        sep.appendChild(row);

        startMeters();
    }

    function makeChannelRow(container, info, level, idx, isMaster) {
        const row = document.createElement('div');
        row.style.cssText = 'margin-bottom:8px;';

        // Header: dot + name + meter + value
        const header = document.createElement('div');
        header.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:3px;';

        const dot = document.createElement('div');
        dot.style.cssText = `width:4px;height:12px;border-radius:2px;flex-shrink:0;background:${info.color};`;
        header.appendChild(dot);

        const name = document.createElement('div');
        name.style.cssText = 'font-size:9px;font-weight:700;color:#7e82a0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
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
        val.style.cssText = 'font-size:10px;font-weight:700;color:#e0e0ee;min-width:28px;text-align:right;flex-shrink:0;font-variant-numeric:tabular-nums;';
        val.textContent = Math.round(level * 100) + '%';
        header.appendChild(val);

        row.appendChild(header);

        // Slider on its own line, full width
        const slider = document.createElement('input');
        slider.type = 'range'; slider.min = 0; slider.max = 1; slider.step = 0.01;
        slider.value = level;
        slider.style.cssText = `width:100%;accent-color:${info.color};cursor:pointer;height:3px;`;
        slider.oninput = () => {
            const v = parseFloat(slider.value);
            if (!state.levels) state.levels = defaults();
            state.levels[idx] = v;
            val.textContent = Math.round(v * 100) + '%';
            SEQ.trackGains[idx].gain.value = v;
            SEQ.notifyStateChange();
        };
        row.appendChild(slider);

        container.appendChild(row);
    }

    function startMeters() {
        if (meterRAF) cancelAnimationFrame(meterRAF);
        const buf = new Uint8Array(128);
        function tick() {
            for (let i = 0; i < analysers.length; i++) {
                if (!meterBars[i]) continue;
                analysers[i].getByteFrequencyData(buf);
                let sum = 0;
                for (let j = 0; j < buf.length; j++) sum += buf[j];
                const avg = sum / buf.length / 255;
                meterBars[i].style.width = Math.min(100, avg * 300) + '%';
            }
            meterRAF = requestAnimationFrame(tick);
        }
        tick();
    }

    function getState() { return { levels: getLevels() }; }

    function setState(s) {
        if (s && s.levels) {
            state.levels = [...s.levels];
            applyLevels();
        }
    }

    function setEnabled(on) {
        const gains = SEQ.trackGains;
        if (on) { applyLevels(); }
        else { for (let i = 0; i < gains.length; i++) gains[i].gain.value = 1; if (SEQ.masterGain) SEQ.masterGain.gain.value = 1; }
    }

    function destroy() {
        if (meterRAF) cancelAnimationFrame(meterRAF);
        analysers.forEach(a => { try { a.disconnect(); } catch(e) {} });
        analysers = [];
    }

    window.SEQ.register({
        id: 'mixer',
        name: 'Mixer',
        icon: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="1" y="7" width="2" height="7" rx="1" fill="currentColor"/><rect x="5" y="3" width="2" height="11" rx="1" fill="currentColor"/><rect x="9" y="5" width="2" height="9" rx="1" fill="currentColor"/><rect x="13" y="1" width="2" height="13" rx="1" fill="currentColor"/></svg>',
        init,
        createUI,
        getState,
        setState,
        setEnabled,
        destroy,
    });

})();
