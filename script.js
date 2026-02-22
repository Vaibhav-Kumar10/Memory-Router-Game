/**
 * ================================================================
 *  MEMORY ROUTER — script.js  (v2 — Token Boxes + Progressive Difficulty)
 *  Network Sequence Memory Puzzle Game
 *  Architecture: Modular Vanilla JS (ES6+)
 * ================================================================
 */

'use strict';

/* ================================================================
   1. PROGRESSIVE DIFFICULTY CONFIG
   The game automatically advances through phases based on level.
   Phase 1 (Lv 1-4):  Numbers only, length 4,   timer 10s
   Phase 2 (Lv 5-8):  Numbers only, length 5-6,  timer 13s
   Phase 3 (Lv 9-14): Alphanumeric,  length 5-7,  timer 15s
   Phase 4 (Lv15-20): Hex codes (2-char tokens), len 6-8, timer 20s
   Phase 5 (Lv 21+):  Mixed full hex, length 8+, timer 25s
   ================================================================ */

/**
 * Returns the game config for the given level.
 * @param {number} level
 * @returns {{ type: string, length: number, timer: number, phase: string, label: string, isNew: boolean }}
 */
function getProgressiveConfig(level) {
    if (level <= 4) {
        return {
            type: 'numbers',
            length: 4,
            timer: 10,
            phase: 'PHASE 01',
            label: 'DECIMAL INIT',
            tokenLen: 1,
        };
    } else if (level <= 8) {
        // length grows 5,5,6,6
        const len = 5 + Math.floor((level - 5) / 2);
        return {
            type: 'numbers',
            length: len,
            timer: 13,
            phase: 'PHASE 02',
            label: 'DIGIT STREAM',
            tokenLen: 1,
        };
    } else if (level <= 14) {
        // alpha characters, length grows 5→8
        const len = 5 + Math.floor((level - 9) / 2);
        return {
            type: 'alpha',
            length: Math.min(len, 8),
            timer: 15,
            phase: 'PHASE 03',
            label: 'ALPHA ROUTE',
            tokenLen: 1,
        };
    } else if (level <= 20) {
        // 2-char hex codes, length grows 6→9
        const len = 6 + Math.floor((level - 15) / 2);
        return {
            type: 'hex',
            length: Math.min(len, 9),
            timer: 20,
            phase: 'PHASE 04',
            label: 'HEX MATRIX',
            tokenLen: 2,
        };
    } else {
        // mixed alpha+numbers, length grows from 8
        const len = Math.min(12, 8 + Math.floor((level - 21) / 3));
        return {
            type: 'mixed',
            length: len,
            timer: 25,
            phase: 'PHASE 05',
            label: 'MIXED PROTOCOL',
            tokenLen: 1,
        };
    }
}

/* ================================================================
   2. CONSTANTS
   ================================================================ */
const NODE_DISPLAY_TIME = 700;   // ms each token glows (base)
const NODE_GAP_TIME = 130;   // ms gap between tokens
const FEEDBACK_DURATION = 900;   // ms feedback overlay shows

const MULTIPLIER_THRESHOLDS = [1, 2, 4, 7, 11];
const MULTIPLIER_VALUES = [1, 2, 3, 5, 8];

const MODE_DESC = {
    normal: 'Standard gameplay. Wrong answer = game over.',
    strict: 'Instant fail on any wrong character typed.',
    speed: 'Same progression but display time is shorter.',
    practice: 'No game over. Retry endlessly. Learn the flow.',
};

/* ================================================================
   3. GAME STATE
   ================================================================ */
const GameState = {
    status: 'idle', // idle | displaying | input | feedback | over

    // Settings (overridden by Settings module)
    mode: 'normal',
    soundOn: true,

    // Round state
    level: 1,
    score: 0,
    streak: 0,
    maxStreak: 0,
    sequence: [],

    // Timer
    timerTotal: 10,
    timerLeft: 10,

    // Power-ups
    boosts: 0,
    boostActive: false,
    roundsSinceBoost: 0,

    // Track last phase to detect phase transitions
    lastPhaseLabel: '',

    init() {
        this.level = 1;
        this.score = 0;
        this.streak = 0;
        this.maxStreak = 0;
        this.sequence = [];
        this.boosts = 0;
        this.boostActive = false;
        this.roundsSinceBoost = 0;
        this.lastPhaseLabel = '';
        this.status = 'idle';
    },

    getMultiplier() {
        for (let i = MULTIPLIER_THRESHOLDS.length - 1; i >= 0; i--) {
            if (this.streak >= MULTIPLIER_THRESHOLDS[i]) return MULTIPLIER_VALUES[i];
        }
        return 1;
    },

    getMultiplierProgress() {
        for (let i = 0; i < MULTIPLIER_THRESHOLDS.length - 1; i++) {
            if (this.streak < MULTIPLIER_THRESHOLDS[i + 1]) {
                const low = MULTIPLIER_THRESHOLDS[i];
                const high = MULTIPLIER_THRESHOLDS[i + 1];
                return (this.streak - low) / (high - low);
            }
        }
        return 1;
    },

    getNodeDisplayTime() {
        const base = NODE_DISPLAY_TIME;
        // Reduce slightly per level, speed mode is extra fast
        const reduction = (this.level - 1) * 15 + (this.mode === 'speed' ? 100 : 0);
        return Math.max(300, base - reduction);
    },
};

/* ================================================================
   4. SEQUENCE GENERATOR
   ================================================================ */
const SequenceGenerator = {
    pools: {
        numbers: '0123456789'.split(''),
        alpha: 'ABCDEFGHJKLMNPQRSTUVWXYZ'.split(''), // no confusable I/O
        hex: '0123456789ABCDEF'.split(''),
        mixed: null, // built dynamically
    },

    getPool(type) {
        if (type === 'mixed') return [...this.pools.numbers, ...this.pools.alpha];
        return this.pools[type] || this.pools.numbers;
    },

    generate(length, type) {
        const pool = this.getPool(type);
        const seq = [];
        let last = null;

        for (let i = 0; i < length; i++) {
            let token;
            let tries = 0;
            do {
                if (type === 'hex') {
                    // 2-char hex codes
                    token = pool[Math.floor(Math.random() * pool.length)]
                        + pool[Math.floor(Math.random() * pool.length)];
                } else {
                    token = pool[Math.floor(Math.random() * pool.length)];
                }
                tries++;
            } while (token === last && pool.length > 1 && tries < 20);
            seq.push(token);
            last = token;
        }
        return seq;
    },
};

/* ================================================================
   5. SOUND ENGINE (Web Audio API — no audio files)
   ================================================================ */
const SoundEngine = {
    ctx: null, masterGain: null,

    init() {
        try {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
            this.masterGain = this.ctx.createGain();
            this.masterGain.gain.value = 0.35;
            this.masterGain.connect(this.ctx.destination);
        } catch (e) { console.warn('Web Audio not available:', e); }
    },

    resume() {
        if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    },

    beep(freq, dur = 0.12, type = 'sine', vol = 0.5, delay = 0) {
        if (!GameState.soundOn || !this.ctx) return;
        this.resume();
        const t = this.ctx.currentTime + delay;
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, t);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(vol, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        osc.connect(g); g.connect(this.masterGain);
        osc.start(t); osc.stop(t + dur + 0.05);
    },

    nodeReveal(i) {
        const freqs = [440, 494, 523, 587, 659, 698, 784, 880];
        this.beep(freqs[i % freqs.length], 0.09, 'square', 0.28);
        this.beep(freqs[i % freqs.length] * 2, 0.07, 'sine', 0.13, 0.02);
    },
    success() {
        [523, 659, 784].forEach((f, i) => this.beep(f, 0.3, 'sine', 0.4, i * 0.07));
        this.beep(1047, 0.4, 'sine', 0.3, 0.28);
    },
    fail() {
        this.beep(200, 0.2, 'sawtooth', 0.5);
        this.beep(150, 0.3, 'sawtooth', 0.4, 0.15);
        this.beep(120, 0.4, 'square', 0.3, 0.32);
    },
    tick() { this.beep(880, 0.04, 'square', 0.15); },
    wrongKey() { this.beep(180, 0.1, 'sawtooth', 0.4); },
    levelUp() { [880, 988, 1047, 1175].forEach((f, i) => this.beep(f, 0.15, 'sine', 0.4, i * 0.07)); },
    boost() { [700, 900, 1100].forEach((f, i) => this.beep(f, 0.15, 'sine', 0.45, i * 0.1)); },
};

/* ================================================================
   6. PARTICLE ENGINE
   ================================================================ */
const ParticleEngine = {
    canvas: null, ctx: null, particles: [],

    init() {
        this.canvas = document.getElementById('particle-canvas');
        this.ctx = this.canvas.getContext('2d');
        this.resize();
        window.addEventListener('resize', () => this.resize());
        for (let i = 0; i < 60; i++) this.particles.push(this.makeAmbient());
        this.loop();
    },

    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    },

    makeAmbient() {
        return {
            x: Math.random() * window.innerWidth,
            y: Math.random() * window.innerHeight,
            vx: (Math.random() - 0.5) * 0.3,
            vy: -Math.random() * 0.5 - 0.1,
            r: Math.random() * 1.5 + 0.5,
            alpha: Math.random() * 0.4 + 0.1,
            color: ['#00ffff', '#00ff9f', '#ff00ff'][Math.floor(Math.random() * 3)],
            life: 1, ambient: true,
        };
    },

    burst(x, y, count, color) {
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = Math.random() * 4 + 1;
            this.particles.push({
                x, y,
                vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 2,
                r: Math.random() * 3 + 1, alpha: 1, color, life: 1,
                decay: Math.random() * 0.025 + 0.015, ambient: false,
            });
        }
    },

    burstSuccess() {
        const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
        this.burst(cx, cy, 40, '#00ff9f');
        this.burst(cx - 120, cy, 15, '#00ffff');
        this.burst(cx + 120, cy, 15, '#00ffff');
    },

    loop() {
        const { ctx, canvas } = this;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        this.particles = this.particles.filter(p => p.life > 0.01);
        for (const p of this.particles) {
            ctx.save();
            ctx.globalAlpha = p.alpha * p.life;
            ctx.fillStyle = ctx.shadowColor = p.color;
            ctx.shadowBlur = p.r * 4;
            ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
            p.x += p.vx; p.y += p.vy;
            if (p.ambient) { if (p.y < -10) Object.assign(p, this.makeAmbient(), { y: canvas.height + 10 }); }
            else { p.vy += 0.1; p.life -= p.decay; }
        }
        while (this.particles.filter(p => p.ambient).length < 60) this.particles.push(this.makeAmbient());
        requestAnimationFrame(() => this.loop());
    },
};

/* ================================================================
   7. STORAGE ENGINE
   ================================================================ */
const StorageEngine = {
    KEY_SCORES: 'memoryrouter_v2_scores',
    KEY_BEST: 'memoryrouter_v2_best',

    getScores() {
        try { return JSON.parse(localStorage.getItem(this.KEY_SCORES)) || []; } catch { return []; }
    },

    saveScore(entry) {
        const scores = this.getScores();
        scores.push(entry);
        scores.sort((a, b) => b.score - a.score);
        localStorage.setItem(this.KEY_SCORES, JSON.stringify(scores.slice(0, 10)));
        if (entry.score > this.getBest()) localStorage.setItem(this.KEY_BEST, String(entry.score));
    },

    getBest() { return parseInt(localStorage.getItem(this.KEY_BEST)) || 0; },
};

/* ================================================================
   8. INPUT BOX ENGINE
   Individual per-token input boxes: one box per sequence token.
   Auto-advances focus, auto-submits on last token filled.
   ================================================================ */
const InputBoxEngine = {
    boxes: [],

    /** Build one input box per token of the current sequence. */
    build(sequence) {
        const container = document.getElementById('token-inputs');
        container.innerHTML = '';
        this.boxes = [];

        sequence.forEach((token, i) => {
            const inp = document.createElement('input');
            inp.type = 'text';
            inp.maxLength = token.length; // 1 for numbers/alpha, 2 for hex
            inp.dataset.index = i;
            inp.dataset.expected = token.toUpperCase();
            inp.autocomplete = 'off';
            inp.autocorrect = 'off';
            inp.spellcheck = false;
            inp.setAttribute('aria-label', `Token ${i + 1} of ${sequence.length}`);

            // Wider box for 2-char tokens (hex)
            inp.className = 'token-input' + (token.length > 1 ? ' wide' : '');

            inp.addEventListener('input', (e) => this.handleInput(e, i, sequence));
            inp.addEventListener('keydown', (e) => this.handleKeydown(e, i));
            inp.addEventListener('paste', (e) => e.preventDefault()); // no paste allowed

            container.appendChild(inp);
            this.boxes.push(inp);
        });
    },

    handleInput(e, i, sequence) {
        const inp = e.target;
        const val = inp.value.toUpperCase().replace(/\s/g, '');
        const expected = inp.dataset.expected;
        inp.value = val; // uppercase + no spaces

        // Live prefix colour feedback
        inp.classList.remove('prefix-match', 'prefix-wrong', 'filled-correct', 'filled-wrong');
        if (val.length > 0) {
            const prefixOk = expected.startsWith(val);
            inp.classList.add(prefixOk ? 'prefix-match' : 'prefix-wrong');

            // Strict mode: wrong prefix → instant fail
            if (!prefixOk && GameState.mode === 'strict') {
                SoundEngine.wrongKey();
                TimerEngine.clear();
                Game.handleWrong();
                return;
            }
        }

        // Box fully filled
        if (val.length >= expected.length) {
            const correct = (val === expected);
            inp.classList.remove('prefix-match', 'prefix-wrong');
            inp.classList.add(correct ? 'filled-correct' : 'filled-wrong');
            inp.value = val.slice(0, expected.length);

            if (i < this.boxes.length - 1) {
                // Auto-advance to next box
                setTimeout(() => this.boxes[i + 1].focus(), 40);
            } else {
                // Last box — auto-submit
                setTimeout(() => Game.submitBoxes(), 120);
            }
        }
    },

    handleKeydown(e, i) {
        // Backspace on empty box → go back to previous
        if (e.key === 'Backspace' && this.boxes[i].value === '' && i > 0) {
            e.preventDefault();
            const prev = this.boxes[i - 1];
            prev.value = '';
            prev.classList.remove('filled-correct', 'filled-wrong', 'prefix-match', 'prefix-wrong');
            prev.focus();
        }
        // Enter anywhere → submit
        if (e.key === 'Enter') {
            e.preventDefault();
            Game.submitBoxes();
        }
    },

    /** Get all typed values as uppercase strings. */
    getValues() {
        return this.boxes.map(b => b.value.toUpperCase());
    },

    /** Focus the first empty box (or first box if all empty). */
    focusFirst() {
        const empty = this.boxes.find(b => b.value === '');
        (empty || this.boxes[0])?.focus();
    },

    /** Reset all boxes to empty state. */
    clear() {
        this.boxes.forEach(b => {
            b.value = '';
            b.classList.remove('filled-correct', 'filled-wrong', 'prefix-match', 'prefix-wrong');
        });
        this.focusFirst();
    },
};

/* ================================================================
   9. UI HELPERS
   ================================================================ */
const UI = {
    els: {},

    cache() {
        [
            'score-display', 'level-display', 'streak-display', 'best-display',
            'mode-badge', 'phase-label', 'phase-sub',
            'timer-ring', 'timer-display',
            'sequence-grid', 'start-overlay', 'input-zone',
            'token-inputs', 'btn-submit', 'expected-length', 'input-warning',
            'feedback-overlay', 'feedback-text',
            'game-over-screen', 'go-score', 'go-level', 'go-streak', 'go-sequence', 'go-new-best',
            'settings-modal', 'mode-selector', 'type-selector', 'diff-selector',
            'mode-desc', 'sound-icon', 'sound-label', 'btn-sound-toggle',
            'btn-settings', 'btn-close-settings', 'btn-apply-settings',
            'btn-start', 'btn-restart', 'btn-main-menu',
            'levelup-flash',
            'multiplier-display', 'multiplier-fill',
            'leaderboard-list', 'history-list',
            'powerup-block', 'btn-powerup', 'powerup-count',
        ].forEach(id => { this.els[id] = document.getElementById(id); });
    },

    updateHUD() {
        const cfg = getProgressiveConfig(GameState.level);
        this.els['score-display'].textContent = GameState.score.toLocaleString();
        this.els['level-display'].textContent = String(GameState.level).padStart(2, '0');
        this.els['streak-display'].textContent = `×${GameState.getMultiplier()}`;
        this.els['best-display'].textContent = StorageEngine.getBest().toLocaleString();
        this.els['mode-badge'].textContent = `${cfg.phase} · ${GameState.mode.toUpperCase()}`;

        this.els['multiplier-display'].textContent = `×${GameState.getMultiplier()}`;
        this.els['multiplier-fill'].style.width = `${GameState.getMultiplierProgress() * 100}%`;
    },

    updateTimer(seconds, total) {
        const circumference = 138.2;
        const offset = circumference * (1 - seconds / total);
        const ring = this.els['timer-ring'];
        ring.style.strokeDashoffset = offset;
        ring.style.stroke = seconds / total > 0.5 ? '#00ffff' : seconds / total > 0.25 ? '#ffdd00' : '#ff2244';
        this.els['timer-display'].textContent = seconds;
    },

    setPhase(label, sub = '') {
        this.els['phase-label'].textContent = label;
        this.els['phase-sub'].textContent = sub;
    },

    showInputZone(show) {
        const zone = this.els['input-zone'];
        if (show) {
            zone.style.opacity = '1';
            zone.style.pointerEvents = 'auto';
            setTimeout(() => InputBoxEngine.focusFirst(), 60);
        } else {
            zone.style.opacity = '0';
            zone.style.pointerEvents = 'none';
        }
    },

    showFeedback(type) {
        const overlay = this.els['feedback-overlay'];
        const text = this.els['feedback-text'];
        overlay.className = 'absolute inset-0 z-30 pointer-events-none flex items-center justify-center';
        text.className = '';
        if (type === 'granted') {
            overlay.classList.add('show-granted');
            text.classList.add('text-granted', 'font-orbitron', 'font-black');
            text.textContent = 'ACCESS GRANTED';
        } else {
            overlay.classList.add('show-denied');
            text.classList.add('text-denied', 'font-orbitron', 'font-black', 'access-denied-glitch');
            text.textContent = 'ACCESS DENIED';
        }
        setTimeout(() => {
            overlay.className = 'absolute inset-0 z-30 pointer-events-none hidden flex items-center justify-center';
        }, FEEDBACK_DURATION);
    },

    shakeInputZone() {
        const zone = this.els['input-zone'];
        zone.classList.remove('shake'); // uses the existing input-shake keyframe
        void zone.offsetWidth;
        zone.style.animation = 'none';
        zone.style.borderColor = 'var(--red)';
        zone.style.boxShadow = 'var(--glow-red)';
        // Flash each box red
        InputBoxEngine.boxes.forEach(b => { b.style.borderColor = 'var(--red)'; b.style.boxShadow = 'var(--glow-red)'; });
        setTimeout(() => {
            zone.style.borderColor = '';
            zone.style.boxShadow = '';
            InputBoxEngine.boxes.forEach(b => { b.style.borderColor = ''; b.style.boxShadow = ''; });
        }, 500);
    },

    showLevelUp() {
        const el = this.els['levelup-flash'];
        const div = el.querySelector('div');
        el.classList.remove('hidden');
        div.classList.remove('levelup-text');
        void el.offsetWidth;
        div.classList.add('levelup-text');
        setTimeout(() => el.classList.add('hidden'), 1000);
    },

    showPhaseBanner(phase, label) {
        const old = document.querySelector('.phase-banner');
        if (old) old.remove();
        const el = document.createElement('div');
        el.className = 'phase-banner';
        el.innerHTML = `${phase}<br><span style="font-size:0.7rem;letter-spacing:0.2em;color:#fff;opacity:0.7">${label}</span>`;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 1900);
    },

    showGameOver() {
        const gs = GameState;
        this.els['go-score'].textContent = gs.score.toLocaleString();
        this.els['go-level'].textContent = gs.level;
        this.els['go-streak'].textContent = gs.maxStreak;

        const seqEl = this.els['go-sequence'];
        seqEl.innerHTML = '';
        gs.sequence.forEach(token => {
            const chip = document.createElement('span');
            chip.className = 'font-mono text-sm px-2 py-1 rounded border';
            chip.style.cssText = 'background:rgba(0,255,159,0.06);border-color:rgba(0,255,159,0.3)';
            chip.textContent = token;
            seqEl.appendChild(chip);
        });

        const prevBest = StorageEngine.getBest();
        this.els['go-new-best'].classList.toggle('hidden', gs.score <= prevBest || gs.score === 0);
        this.els['game-over-screen'].classList.remove('hidden');
        this.els['game-over-screen'].style.display = 'flex';
    },

    hideGameOver() {
        this.els['game-over-screen'].classList.add('hidden');
        this.els['game-over-screen'].style.display = '';
    },

    buildSequenceGrid(sequence) {
        const grid = this.els['sequence-grid'];
        grid.innerHTML = '';
        sequence.forEach((token, i) => {
            const node = document.createElement('div');
            node.className = 'sequence-node';
            node.id = `node-${i}`;
            node.textContent = token;
            node.dataset.token = token;
            grid.appendChild(node);
        });
    },

    renderLeaderboard() {
        const list = this.els['leaderboard-list'];
        const scores = StorageEngine.getScores();
        list.innerHTML = '';
        if (!scores.length) {
            list.innerHTML = '<li class="text-gray-600 text-xs italic px-2 py-1">No scores yet</li>';
            return;
        }
        scores.slice(0, 8).forEach((entry, i) => {
            const li = document.createElement('li');
            li.className = `rank-${i + 1}`;
            li.innerHTML = `<span class="text-gray-500">${i + 1}.</span>
                      <span class="text-white font-bold ml-1 mr-auto truncate w-20 text-xs">${entry.name || 'GUEST'}</span>
                      <span class="text-cyber-cyan font-mono">${entry.score.toLocaleString()}</span>
                      <span class="text-gray-600 text-xs ml-2">Lv${entry.level}</span>`;
            list.appendChild(li);
        });
    },

    addHistoryEntry(level, result, score) {
        const list = this.els['history-list'];
        const li = document.createElement('li');
        const color = result === 'correct' ? 'text-cyber-green' : 'text-cyber-red';
        const cfg = getProgressiveConfig(level);
        li.className = 'flex items-center justify-between py-1 border-b border-gray-800/50';
        li.innerHTML = `<span class="text-gray-600">Lv${String(level).padStart(2, '0')}</span>
                    <span class="text-gray-700 text-xs">${cfg.label}</span>
                    <span class="${color} text-xs">${result === 'correct' ? '✓' : '✗'}</span>
                    <span class="text-gray-500 font-mono">+${score}</span>`;
        list.insertBefore(li, list.firstChild);
        while (list.children.length > 20) list.removeChild(list.lastChild);
    },

    updatePowerupDisplay() {
        const block = this.els['powerup-block'];
        const btn = this.els['btn-powerup'];
        this.els['powerup-count'].textContent = GameState.boosts;
        block.style.opacity = GameState.status === 'input' ? '1' : '0';
        btn.disabled = GameState.boosts === 0 || GameState.status !== 'input';
    },
};

/* ================================================================
   10. TIMER ENGINE
   ================================================================ */
const TimerEngine = {
    interval: null,

    start(seconds, onExpire) {
        this.clear();
        GameState.timerTotal = seconds;
        GameState.timerLeft = seconds;
        UI.updateTimer(seconds, seconds);

        this.interval = setInterval(() => {
            if (GameState.boostActive) return;
            GameState.timerLeft--;
            UI.updateTimer(GameState.timerLeft, GameState.timerTotal);
            if (GameState.timerLeft <= 5 && GameState.timerLeft > 0) SoundEngine.tick();
            if (GameState.timerLeft <= 0) { this.clear(); onExpire(); }
        }, 1000);
    },

    clear() {
        if (this.interval) { clearInterval(this.interval); this.interval = null; }
    },
};

/* ================================================================
   11. DISPLAY ENGINE
   ================================================================ */
const DisplayEngine = {
    timeoutId: null,

    start(sequence, onComplete) {
        GameState.status = 'displaying';
        UI.setPhase('ROUTING SEQUENCE...', 'Watch carefully — then enter each token');
        UI.showInputZone(false);
        UI.buildSequenceGrid(sequence);
        this.revealNext(sequence, 0, onComplete);
    },

    revealNext(sequence, i, onComplete) {
        if (i >= sequence.length) {
            this.timeoutId = setTimeout(() => { this.hideAll(sequence); onComplete(); }, 200);
            return;
        }
        const node = document.getElementById(`node-${i}`);
        if (!node) return;
        node.classList.add('active');
        SoundEngine.nodeReveal(i);

        this.timeoutId = setTimeout(() => {
            node.classList.remove('active');
            node.classList.add('completed');
            setTimeout(() => {
                this.revealNext(sequence, i + 1, onComplete);
            }, NODE_GAP_TIME);
        }, GameState.getNodeDisplayTime());
    },

    hideAll(sequence) {
        sequence.forEach((_, i) => {
            const node = document.getElementById(`node-${i}`);
            if (node) { node.classList.remove('active', 'completed'); node.textContent = '?'; }
        });
    },

    cancel() { if (this.timeoutId) { clearTimeout(this.timeoutId); this.timeoutId = null; } },
};

/* ================================================================
   12. GAME FLOW ENGINE
   ================================================================ */
const Game = {
    submitting: false,

    start() {
        const nameInput = document.getElementById('player-name-input').value.trim().toUpperCase();
        if (!nameInput) return; // Wait for valid name

        GameState.playerName = nameInput.slice(0, 12);
        localStorage.setItem('memoryrouter_v2_last_name', GameState.playerName);

        document.getElementById('player-display').textContent = GameState.playerName;

        SoundEngine.init();
        GameState.init();
        UI.hideGameOver();
        this.hideStartOverlay();
        UI.updateHUD();
        UI.renderLeaderboard();
        document.getElementById('history-list').innerHTML = '';
        this.beginRound();
    },

    restart() {
        TimerEngine.clear();
        DisplayEngine.cancel();
        GameState.init();
        UI.hideGameOver();
        UI.showInputZone(false);
        UI.updateHUD();
        document.getElementById('history-list').innerHTML = '';
        this.beginRound();
    },

    showMainMenu() {
        TimerEngine.clear();
        DisplayEngine.cancel();
        GameState.status = 'idle';
        UI.hideGameOver();
        UI.showInputZone(false);
        UI.updateHUD();
        const overlay = document.getElementById('start-overlay');
        overlay.classList.remove('hidden');
        overlay.style.opacity = '1';
    },

    hideStartOverlay() {
        const ol = document.getElementById('start-overlay');
        ol.style.transition = 'opacity 0.4s ease';
        ol.style.opacity = '0';
        setTimeout(() => ol.classList.add('hidden'), 400);
    },

    beginRound() {
        GameState.status = 'displaying';
        const cfg = getProgressiveConfig(GameState.level);

        // Detect phase transition — show banner
        if (cfg.label !== GameState.lastPhaseLabel) {
            if (GameState.lastPhaseLabel !== '') {
                UI.showPhaseBanner(cfg.phase, cfg.label);
            }
            GameState.lastPhaseLabel = cfg.label;
        }

        // Override sequence type from progressive config
        GameState.sequence = SequenceGenerator.generate(cfg.length, cfg.type);

        UI.updateHUD();
        UI.els['expected-length'].textContent = GameState.sequence.length;
        UI.updatePowerupDisplay();

        // Brief pause then start display
        setTimeout(() => {
            DisplayEngine.start(GameState.sequence, () => this.beginInputPhase());
        }, 350);
    },

    beginInputPhase() {
        GameState.status = 'input';
        const cfg = getProgressiveConfig(GameState.level);

        UI.setPhase(
            `ENTER ${cfg.length} TOKENS`,
            `${cfg.label} · ${cfg.timer}s remaining`,
        );
        UI.showInputZone(true);

        // Build the new per-token boxes
        InputBoxEngine.build(GameState.sequence);
        UI.updatePowerupDisplay();

        const timer = GameState.mode === 'practice' ? 9999 : cfg.timer;
        TimerEngine.start(timer, () => {
            if (GameState.status === 'input') this.handleTimerExpiry();
        });
    },

    handleTimerExpiry() {
        SoundEngine.fail();
        UI.shakeInputZone();
        UI.showFeedback('denied');
        this.triggerGameOver();
    },

    /** Called by InputBoxEngine on last box fill, or btn-submit click. */
    submitBoxes() {
        if (this.submitting || GameState.status !== 'input') return;
        this.submitting = true;
        setTimeout(() => { this.submitting = false; }, 300);

        const userTokens = InputBoxEngine.getValues();
        const correctTokens = GameState.sequence.map(t => t.toUpperCase());

        // Incomplete check
        const incomplete = userTokens.some((t, i) => t.length < correctTokens[i].length);
        if (incomplete) {
            UI.els['input-warning'].classList.remove('hidden');
            setTimeout(() => UI.els['input-warning'].classList.add('hidden'), 2000);
            InputBoxEngine.focusFirst();
            this.submitting = false;
            return;
        }

        TimerEngine.clear();
        const isCorrect = userTokens.every((t, i) => t === correctTokens[i]);
        if (isCorrect) this.handleCorrect(); else this.handleWrong();
    },

    handleCorrect() {
        GameState.status = 'feedback';
        SoundEngine.success();
        ParticleEngine.burstSuccess();
        UI.showFeedback('granted');
        UI.showLevelUp();

        const cfg = getProgressiveConfig(GameState.level);
        const basePoints = 100 * GameState.level;
        const mult = GameState.getMultiplier();
        const timeBonus = GameState.timerLeft > cfg.timer / 2
            ? Math.floor(50 * (GameState.timerLeft / cfg.timer))
            : 0;
        const earned = basePoints * mult + timeBonus;
        GameState.score += earned;
        GameState.streak++;
        GameState.maxStreak = Math.max(GameState.maxStreak, GameState.streak);

        GameState.roundsSinceBoost++;
        if (GameState.roundsSinceBoost >= 5) {
            GameState.boosts++;
            GameState.roundsSinceBoost = 0;
            SoundEngine.boost();
        }

        UI.addHistoryEntry(GameState.level, 'correct', earned);
        UI.updateHUD();
        SoundEngine.levelUp();
        GameState.level++;
        UI.showInputZone(false);

        setTimeout(() => { GameState.status = 'displaying'; this.beginRound(); }, 1400);
    },

    handleWrong() {
        GameState.status = 'feedback';
        SoundEngine.fail();
        UI.showFeedback('denied');
        UI.shakeInputZone();
        UI.addHistoryEntry(GameState.level, 'wrong', 0);

        if (GameState.mode === 'practice') {
            GameState.streak = 0;
            UI.updateHUD();
            setTimeout(() => {
                GameState.status = 'input';
                InputBoxEngine.clear();
                const cfg = getProgressiveConfig(GameState.level);
                TimerEngine.start(cfg.timer, () => {
                    if (GameState.status === 'input') this.handleTimerExpiry();
                });
            }, 1200);
        } else {
            this.triggerGameOver();
        }
    },

    triggerGameOver() {
        GameState.status = 'over';
        TimerEngine.clear();
        DisplayEngine.cancel();
        UI.showInputZone(false);

        StorageEngine.saveScore({
            name: GameState.playerName || 'GUEST',
            score: GameState.score,
            level: GameState.level,
            streak: GameState.maxStreak,
            mode: GameState.mode,
            date: new Date().toISOString(),
        });

        setTimeout(() => {
            UI.updateHUD();
            UI.renderLeaderboard();
            UI.showGameOver();
        }, 600);
    },

    activateBoost() {
        if (GameState.boosts <= 0 || GameState.status !== 'input') return;
        GameState.boosts--;
        GameState.boostActive = true;
        SoundEngine.boost();
        UI.updatePowerupDisplay();
        setTimeout(() => { GameState.boostActive = false; UI.updatePowerupDisplay(); }, 8000);
    },
};

/* ================================================================
   13. SETTINGS MODULE
   ================================================================ */
const Settings = {
    tempMode: 'normal',

    open() {
        this.tempMode = GameState.mode;
        this.syncGroup('mode-selector', this.tempMode);
        document.getElementById('mode-desc').textContent = MODE_DESC[this.tempMode];
        document.getElementById('settings-modal').style.display = 'flex';
        document.getElementById('settings-modal').classList.remove('hidden');
    },

    close() {
        document.getElementById('settings-modal').classList.add('hidden');
        document.getElementById('settings-modal').style.display = '';
    },

    syncGroup(groupId, value) {
        document.getElementById(groupId).querySelectorAll('.radio-btn')
            .forEach(btn => btn.classList.toggle('active', btn.dataset.value === value));
    },

    apply() {
        GameState.mode = this.tempMode;
        this.close();
    },

    handleRadio(groupId, value) {
        if (groupId === 'mode-selector') {
            this.tempMode = value;
            document.getElementById('mode-desc').textContent = MODE_DESC[value];
        }
        this.syncGroup(groupId, value);
    },
};

/* ================================================================
   14. EVENT WIRING
   ================================================================ */
function wireEvents() {
    const btnStart = UI.els['btn-start'];
    const nameInput = document.getElementById('player-name-input');

    btnStart.addEventListener('click', () => Game.start());
    UI.els['btn-restart'].addEventListener('click', () => Game.restart());
    UI.els['btn-main-menu'].addEventListener('click', () => Game.showMainMenu());
    UI.els['btn-settings'].addEventListener('click', () => Settings.open());
    UI.els['btn-close-settings'].addEventListener('click', () => Settings.close());
    UI.els['btn-apply-settings'].addEventListener('click', () => Settings.apply());
    UI.els['btn-submit'].addEventListener('click', () => Game.submitBoxes());
    UI.els['btn-powerup'].addEventListener('click', () => Game.activateBoost());

    // Name input validation
    nameInput.addEventListener('input', (e) => {
        const val = e.target.value.trim();
        if (val.length > 0) {
            btnStart.disabled = false;
            btnStart.classList.remove('opacity-50', 'cursor-not-allowed');
        } else {
            btnStart.disabled = true;
            btnStart.classList.add('opacity-50', 'cursor-not-allowed');
        }
    });

    nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !btnStart.disabled) Game.start();
    });

    // Close settings on backdrop click
    document.getElementById('settings-modal').addEventListener('click', (e) => {
        if (e.target === document.getElementById('settings-modal')) Settings.close();
    });

    // Mode radio buttons (in settings — Sequence Type / Difficulty no longer manual; auto-progresses)
    ['mode-selector'].forEach(gid => {
        document.getElementById(gid).addEventListener('click', (e) => {
            const btn = e.target.closest('.radio-btn');
            if (btn) Settings.handleRadio(gid, btn.dataset.value);
        });
    });

    // Sound toggle
    UI.els['btn-sound-toggle'].addEventListener('click', () => {
        GameState.soundOn = !GameState.soundOn;
        UI.els['btn-sound-toggle'].classList.toggle('active', GameState.soundOn);
        UI.els['sound-icon'].textContent = GameState.soundOn ? '🔊' : '🔇';
        UI.els['sound-label'].textContent = GameState.soundOn ? 'ON' : 'OFF';
    });

    // Global keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (!document.getElementById('settings-modal').classList.contains('hidden')) Settings.close();
        }
        if ((e.key === ' ' || e.key === 'Enter') && GameState.status === 'idle') {
            const active = document.activeElement;
            const isInput = active && (active.tagName === 'INPUT' || active.tagName === 'BUTTON');
            if (!isInput && !btnStart.disabled) { e.preventDefault(); Game.start(); }
        }
    });
}

/* ================================================================
   15. INIT
   ================================================================ */
document.addEventListener('DOMContentLoaded', () => {
    UI.cache();
    ParticleEngine.init();
    UI.renderLeaderboard();
    UI.updateHUD();
    wireEvents();

    // Check if we have a previous name on load
    const savedName = localStorage.getItem('memoryrouter_v2_last_name');
    if (savedName) {
        const inp = document.getElementById('player-name-input');
        inp.value = savedName;
        inp.dispatchEvent(new Event('input')); // trigger validation to enable button
    }

    console.log('%c MEMORY ROUTER v2 ', 'background:#00ffff;color:#000;font-weight:bold;padding:4px 8px;font-size:14px;');
    console.log('%c Token Box Input + Player Tracking', 'color:#00ff9f;font-size:12px');
});
