// =====================================================
// audio.js
// BGM / SE 管理モジュール。
//
// 外部の音声ファイルを一切使わず、Web Audio API でその場で波形を
// 合成して再生する（＝アセット不要で軽量、オフラインPWAとも相性が良い）。
//
// ・音量は BGM/SE それぞれ「OFF・小・中・大」の4段階。初期値はどちらも OFF。
// ・設定は localStorage に保存され、次回起動時も復元される。
// ・画面遷移（changeScreen）・戦闘演出（showEffect）・通知（showToast）を
//   ラップして自動的に適切な音を鳴らす。個々の画面のコードは変更不要。
//
// 他の game_*.js / masmon_*.js より後、かつそれらが定義する
// changeScreen / showEffect / showToast をラップするため
// index.html の <script> 読み込み順は「最後」に置くこと。
// =====================================================

const AudioManager = (() => {

    const STORAGE_KEY = 'mfload_audio_settings';
    const LEVELS = ['off', 'small', 'mid', 'large'];
    const LEVEL_LABEL = { off: 'OFF', small: '小', mid: '中', large: '大' };
    const BGM_GAIN = { off: 0, small: 0.14, mid: 0.28, large: 0.5 };
    const SE_GAIN = { off: 0, small: 0.22, mid: 0.45, large: 0.8 };

    let settings = { bgm: 'off', se: 'off' };

    let ctx = null;
    let masterBgmGain = null;
    let masterSeGain = null;
    let noiseBuffer = null;

    let currentTrackName = null;
    let bgmTimerId = null;
    let bgmToken = 0;

    // ---------------------------------------------------
    // 設定の読み書き（LocalStorage）
    // ---------------------------------------------------
    function loadSettings() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return;
            const saved = JSON.parse(raw);
            if (saved && LEVELS.includes(saved.bgm) && LEVELS.includes(saved.se)) {
                settings = saved;
            }
        } catch (e) { /* 読み込み失敗時は初期値(OFF)のまま */ }
    }

    function saveSettings() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
        } catch (e) { /* プライベートブラウズ等で失敗しても無視 */ }
    }

    // ---------------------------------------------------
    // AudioContext 初期化・再開
    // ---------------------------------------------------
    function ensureContext() {
        if (ctx) return ctx;
        try {
            const Ctor = window.AudioContext || window.webkitAudioContext;
            if (!Ctor) return null;
            ctx = new Ctor();
            masterBgmGain = ctx.createGain();
            masterBgmGain.gain.value = BGM_GAIN[settings.bgm];
            masterBgmGain.connect(ctx.destination);

            masterSeGain = ctx.createGain();
            masterSeGain.gain.value = SE_GAIN[settings.se];
            masterSeGain.connect(ctx.destination);
        } catch (e) {
            console.warn('[AudioManager] Web Audio API が利用できません:', e);
            ctx = null;
        }
        return ctx;
    }

    function resume() {
        const c = ensureContext();
        if (c && c.state === 'suspended') {
            c.resume().catch(() => {});
        }
    }

    // 初回のユーザー操作でAudioContextのロックを解除する（ブラウザの自動再生制限対策）
    function installUnlockListener() {
        const unlock = () => {
            resume();
            document.removeEventListener('pointerdown', unlock, true);
            document.removeEventListener('keydown', unlock, true);
        };
        document.addEventListener('pointerdown', unlock, true);
        document.addEventListener('keydown', unlock, true);
    }

    // ---------------------------------------------------
    // 音名 → 周波数
    // ---------------------------------------------------
    const NOTE_INDEX = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
    function noteFreq(note) {
        if (!note) return null;
        const m = /^([A-G]#?)(\d)$/.exec(note);
        if (!m) return null;
        const semitoneFromA4 = (parseInt(m[2], 10) - 4) * 12 + (NOTE_INDEX[m[1]] - NOTE_INDEX['A']);
        return 440 * Math.pow(2, semitoneFromA4 / 12);
    }

    // ---------------------------------------------------
    // 単音の合成・再生
    // ---------------------------------------------------
    function tone({ freq, freqEnd = null, duration = 0.15, type = 'square', when = 0, volume = 1, gainNode }) {
        const c = ensureContext();
        if (!c || !freq) return;
        const osc = c.createOscillator();
        osc.type = type;
        const startAt = c.currentTime + when;
        osc.frequency.setValueAtTime(freq, startAt);
        if (freqEnd) {
            osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), startAt + duration);
        }
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, startAt);
        g.gain.linearRampToValueAtTime(volume, startAt + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
        osc.connect(g);
        g.connect(gainNode);
        osc.start(startAt);
        osc.stop(startAt + duration + 0.03);
    }

    function getNoiseBuffer() {
        const c = ensureContext();
        if (!c) return null;
        if (noiseBuffer) return noiseBuffer;
        const len = c.sampleRate * 0.5;
        noiseBuffer = c.createBuffer(1, len, c.sampleRate);
        const data = noiseBuffer.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
        return noiseBuffer;
    }

    function noiseBurst({ duration = 0.12, when = 0, volume = 1, filterFreq = 1200, gainNode }) {
        const c = ensureContext();
        const buf = getNoiseBuffer();
        if (!c || !buf) return;
        const src = c.createBufferSource();
        src.buffer = buf;
        const filter = c.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = filterFreq;
        const g = c.createGain();
        const startAt = c.currentTime + when;
        g.gain.setValueAtTime(volume, startAt);
        g.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
        src.connect(filter);
        filter.connect(g);
        g.connect(gainNode);
        src.start(startAt);
        src.stop(startAt + duration + 0.03);
    }

    // ---------------------------------------------------
    // SE（効果音）定義
    // ---------------------------------------------------
    const SE_DEFS = {
        click: () => tone({ freq: 720, duration: 0.05, type: 'square', volume: 0.5, gainNode: masterSeGain }),
        decide: () => {
            tone({ freq: 523, duration: 0.07, type: 'square', volume: 0.5, gainNode: masterSeGain });
            tone({ freq: 784, duration: 0.09, type: 'square', when: 0.06, volume: 0.5, gainNode: masterSeGain });
        },
        cancel: () => {
            tone({ freq: 392, duration: 0.09, type: 'triangle', volume: 0.45, gainNode: masterSeGain });
            tone({ freq: 294, duration: 0.1, type: 'triangle', when: 0.06, volume: 0.4, gainNode: masterSeGain });
        },
        hit: () => {
            noiseBurst({ duration: 0.09, volume: 0.55, filterFreq: 1800, gainNode: masterSeGain });
            tone({ freq: 180, freqEnd: 90, duration: 0.1, type: 'square', volume: 0.5, gainNode: masterSeGain });
        },
        critical: () => {
            noiseBurst({ duration: 0.1, volume: 0.7, filterFreq: 2600, gainNode: masterSeGain });
            tone({ freq: 220, freqEnd: 70, duration: 0.14, type: 'sawtooth', volume: 0.6, gainNode: masterSeGain });
            tone({ freq: 880, duration: 0.08, type: 'square', when: 0.08, volume: 0.4, gainNode: masterSeGain });
        },
        miss: () => tone({ freq: 500, freqEnd: 150, duration: 0.22, type: 'sine', volume: 0.4, gainNode: masterSeGain }),
        defend: () => tone({ freq: 150, freqEnd: 100, duration: 0.18, type: 'triangle', volume: 0.55, gainNode: masterSeGain }),
        heal: () => {
            ['C5', 'E5', 'G5', 'C6'].forEach((n, i) => {
                tone({ freq: noteFreq(n), duration: 0.16, type: 'triangle', when: i * 0.07, volume: 0.4, gainNode: masterSeGain });
            });
        },
        buff: () => {
            ['C5', 'F5', 'A5'].forEach((n, i) => {
                tone({ freq: noteFreq(n), duration: 0.12, type: 'square', when: i * 0.05, volume: 0.35, gainNode: masterSeGain });
            });
        },
        debuff: () => {
            ['A4', 'F4', 'D4'].forEach((n, i) => {
                tone({ freq: noteFreq(n), duration: 0.14, type: 'sawtooth', when: i * 0.06, volume: 0.35, gainNode: masterSeGain });
            });
        },
        status: () => tone({ freq: 300, freqEnd: 600, duration: 0.3, type: 'sine', volume: 0.3, gainNode: masterSeGain }),
        win: () => {
            ['C5', 'E5', 'G5', 'C6', 'G5', 'C6'].forEach((n, i) => {
                tone({ freq: noteFreq(n), duration: 0.18, type: 'square', when: i * 0.11, volume: 0.5, gainNode: masterSeGain });
            });
        },
        lose: () => {
            ['A4', 'G4', 'F4', 'D4'].forEach((n, i) => {
                tone({ freq: noteFreq(n), duration: 0.28, type: 'triangle', when: i * 0.16, volume: 0.4, gainNode: masterSeGain });
            });
        },
        item: () => {
            tone({ freq: noteFreq('E6'), duration: 0.06, type: 'square', volume: 0.4, gainNode: masterSeGain });
            tone({ freq: noteFreq('B6'), duration: 0.14, type: 'square', when: 0.06, volume: 0.4, gainNode: masterSeGain });
        },
        notify: () => tone({ freq: 660, duration: 0.09, type: 'sine', volume: 0.4, gainNode: masterSeGain }),
        error: () => {
            tone({ freq: 220, duration: 0.14, type: 'sawtooth', volume: 0.4, gainNode: masterSeGain });
            tone({ freq: 165, duration: 0.18, type: 'sawtooth', when: 0.1, volume: 0.4, gainNode: masterSeGain });
        },
        toggle: () => tone({ freq: 900, duration: 0.05, type: 'sine', volume: 0.4, gainNode: masterSeGain }),
    };

    function playSE(name) {
        if (settings.se === 'off') return;
        const c = ensureContext();
        if (!c) return;
        resume();
        const fn = SE_DEFS[name];
        if (fn) fn();
    }

    // ---------------------------------------------------
    // BGM（ループ楽曲）定義：メロディ + ベースの2声チップチューン
    // 各音符は [音名 or null(休符), 拍数] の配列
    // ---------------------------------------------------
    const BGM_TRACKS = {
        title: {
            tempo: 100, leadType: 'triangle', bassType: 'sine',
            lead: [['C4',1],['E4',1],['G4',1],['C5',1],['B4',1],['G4',1],['E4',1],['D4',1],
                   ['C4',1],['F4',1],['A4',1],['C5',1],['G4',1],['E4',1],['D4',1],['C4',2]],
            bass: [['C3',2],['G3',2],['A3',2],['E3',2],['F3',2],['C3',2],['G3',2],['C3',2]],
        },
        adventure: {
            tempo: 118, leadType: 'triangle', bassType: 'sine',
            lead: [['E4',0.5],['G4',0.5],['A4',1],['G4',0.5],['E4',0.5],['D4',1],
                   ['E4',0.5],['G4',0.5],['C5',1],['B4',0.5],['G4',0.5],['A4',1],
                   [null,0.5],['E4',0.5],['D4',0.5],['C4',0.5],['D4',2]],
            bass: [['A3',2],['E3',2],['F3',2],['C3',2],['A3',2],['E3',2],['G3',1],['A3',1],['D3',2]],
        },
        battle: {
            tempo: 150, leadType: 'square', bassType: 'sawtooth',
            lead: [['E4',0.5],['E4',0.5],['A4',0.5],['E4',0.5],['G4',0.5],['E4',0.5],['C5',0.5],['B4',0.5],
                   ['E4',0.5],['E4',0.5],['A4',0.5],['E4',0.5],['D5',0.5],['C5',0.5],['B4',0.5],['A4',0.5]],
            bass: [['A2',0.5],['A2',0.5],['E3',0.5],['A2',0.5],['A2',0.5],['A2',0.5],['E3',0.5],['A2',0.5],
                   ['F2',0.5],['F2',0.5],['C3',0.5],['F2',0.5],['G2',0.5],['G2',0.5],['D3',0.5],['G2',0.5]],
        },
        victory: {
            tempo: 132, leadType: 'square', bassType: 'triangle',
            lead: [['C5',0.5],['C5',0.5],['C5',0.5],['G5',1.5],['E5',1.5],
                   ['F5',0.5],['F5',0.5],['F5',0.5],['C5',0.75],['D5',0.25],['E5',2]],
            bass: [['C3',1.5],['G2',1.5],['A2',1.5],['C3',1.5],['F2',1.5],['C3',1.5],['G2',1.5],['C3',1.5]],
        },
        defeat: {
            tempo: 70, leadType: 'triangle', bassType: 'sine',
            lead: [['A4',1.5],['G4',1],['F4',1.5],['E4',1],['D4',2],[null,1],
                   ['D4',1.5],['C4',1],['B3',1.5],['A3',1],['A3',2],[null,1]],
            bass: [['D3',2],['A2',2],['B2',2],['E2',2],['A2',2],['D2',2]],
        },
    };

    function totalBeats(seq) {
        return seq.reduce((s, [, d]) => s + d, 0);
    }

    function scheduleBgmLoop(trackName, token) {
        const track = BGM_TRACKS[trackName];
        const c = ensureContext();
        if (!track || !c) return;

        const beatSec = 60 / track.tempo;
        const startAt = 0.06; // 発音開始までの僅かなマージン（when は "今から何秒後" の相対値）

        let t = startAt;
        track.lead.forEach(([note, d]) => {
            const freq = noteFreq(note);
            if (freq) tone({ freq, duration: d * beatSec * 0.92, type: track.leadType, when: t, volume: 0.55, gainNode: masterBgmGain });
            t += d * beatSec;
        });

        t = startAt;
        (track.bass || []).forEach(([note, d]) => {
            const freq = noteFreq(note);
            if (freq) tone({ freq, duration: d * beatSec * 0.92, type: track.bassType, when: t, volume: 0.4, gainNode: masterBgmGain });
            t += d * beatSec;
        });

        const loopMs = totalBeats(track.lead) * beatSec * 1000;
        bgmTimerId = setTimeout(() => {
            if (token !== bgmToken) return; // 途中で停止・曲変更されていたら止める
            scheduleBgmLoop(trackName, token);
        }, Math.max(200, loopMs - 80));
    }

    function stopBgmScheduling() {
        bgmToken++;
        if (bgmTimerId) {
            clearTimeout(bgmTimerId);
            bgmTimerId = null;
        }
    }

    // trackName を「現在流すべき曲」として記憶する。
    // BGM設定がOFFのときは実際には鳴らさないが、次にONにした時に自動再開できるよう記憶だけしておく。
    function playBGM(trackName) {
        if (!BGM_TRACKS[trackName]) return;
        if (currentTrackName === trackName && bgmTimerId) return; // 既に同じ曲を再生中
        currentTrackName = trackName;
        stopBgmScheduling();
        if (settings.bgm === 'off') return;
        const c = ensureContext();
        if (!c) return;
        resume();
        scheduleBgmLoop(trackName, bgmToken);
    }

    // ---------------------------------------------------
    // 画面遷移に応じた自動BGM切り替え
    // （個々の勝敗が絡む結果画面は各ゲームロジック側で明示的に
    //   playBGM('victory' / 'defeat') を呼ぶため、ここには含めない）
    // ---------------------------------------------------
    const SCREEN_BGM_MAP = {
        'screen-title': 'title',
        'screen-aura-ritual': 'title',
        'screen-adventure': 'adventure',
        'screen-training': 'adventure',
        'screen-bag': 'adventure',
        'screen-compass-select': 'adventure',
        'screen-event': 'adventure',
        'screen-battle': 'battle',
        'screen-ranking': 'title',
        'screen-masmon-list': 'title',
        'screen-equipment-list': 'title',
        'screen-masmon-team-select': 'title',
        'screen-masmon-item-select': 'title',
        'screen-masmon-realtime-keyword': 'title',
        'screen-masmon-realtime-waiting': 'title',
        'screen-masmon-realtime-matched': 'battle',
        'screen-pvp-ranking': 'title',
    };

    function onScreenChange(screenId) {
        const track = SCREEN_BGM_MAP[screenId];
        if (track) playBGM(track);
    }

    // ---------------------------------------------------
    // showEffect(text) のテキスト内容から対応するSEを自動再生
    // ---------------------------------------------------
    function handleBattleEffectText(text) {
        if (typeof text !== 'string') return;
        if (text.includes('CRITICAL')) playSE('critical');
        else if (text.includes('HIT') || text.includes('被弾')) playSE('hit');
        else if (text.includes('MISS') || text.includes('回避')) playSE('miss');
        else if (text.includes('WIN') || text.includes('VICTORY')) playSE('win');
        else if (text.includes('LOSE') || text.includes('DEFEAT')) playSE('lose');
        else if (text.includes('DEFENSE') || text.includes('NO ACTION')) playSE('defend');
        else if (text.includes('回復')) playSE('heal');
        else if (text.includes('UP') || text.includes('会心') || text.includes('威力')) playSE('buff');
        else if (text.includes('衰弱') || text.includes('混乱')) playSE('debuff');
        else if (text.includes('交代') || text.includes('チャージ')) playSE('status');
        else playSE('notify');
    }

    // ---------------------------------------------------
    // showToast(message) の内容から対応するSEを自動再生
    // ---------------------------------------------------
    function handleToastText(message) {
        if (typeof message !== 'string') return;
        if (/できません|エラー|失敗|見つかりません/.test(message)) playSE('error');
        else if (/手に入れた|獲得|入手|引き継ぎました|宿した/.test(message)) playSE('item');
        else playSE('notify');
    }

    // ---------------------------------------------------
    // 設定変更
    // ---------------------------------------------------
    function applyGainImmediately() {
        const c = ensureContext();
        if (!c) return;
        if (masterBgmGain) masterBgmGain.gain.setTargetAtTime(BGM_GAIN[settings.bgm], c.currentTime, 0.05);
        if (masterSeGain) masterSeGain.gain.setTargetAtTime(SE_GAIN[settings.se], c.currentTime, 0.05);
    }

    function setBgmLevel(level) {
        if (!LEVELS.includes(level)) return;
        settings.bgm = level;
        saveSettings();
        resume();
        applyGainImmediately();
        if (level === 'off') {
            stopBgmScheduling();
        } else if (currentTrackName && !bgmTimerId) {
            stopBgmScheduling();
            scheduleBgmLoop(currentTrackName, bgmToken);
        }
    }

    function setSeLevel(level) {
        if (!LEVELS.includes(level)) return;
        settings.se = level;
        saveSettings();
        resume();
        applyGainImmediately();
        if (level !== 'off') playSE('toggle');
    }

    function getSettings() {
        return { ...settings };
    }

    loadSettings();
    installUnlockListener();

    return {
        LEVELS,
        LEVEL_LABEL,
        playBGM,
        playSE,
        onScreenChange,
        handleBattleEffectText,
        handleToastText,
        setBgmLevel,
        setSeLevel,
        getSettings,
        resume,
    };
})();

// =====================================================
// 既存関数のラップ：画面遷移・戦闘演出・トースト通知に自動でサウンドを紐付ける
// （各 game_*.js / masmon_*.js 側のコードは一切変更不要）
// =====================================================
(function attachAudioHooks() {
    const originalChangeScreen = window.changeScreen;
    if (typeof originalChangeScreen === 'function') {
        window.changeScreen = function (screenId) {
            const ret = originalChangeScreen(screenId);
            AudioManager.onScreenChange(screenId);
            return ret;
        };
    }

    const originalShowEffect = window.showEffect;
    if (typeof originalShowEffect === 'function') {
        window.showEffect = function (text) {
            AudioManager.handleBattleEffectText(text);
            return originalShowEffect(text);
        };
    }

    const originalShowToast = window.showToast;
    if (typeof originalShowToast === 'function') {
        window.showToast = function (message) {
            AudioManager.handleToastText(message);
            return originalShowToast(message);
        };
    }
})();

// =====================================================
// 汎用UI操作音：button / onclick要素のクリックに軽いSEを付与
// （キャプチャフェーズで拾うため個々のボタンの実装変更は不要）
// =====================================================
document.addEventListener('click', function (e) {
    const target = e.target.closest('button, [onclick], input[type="radio"], input[type="checkbox"], select');
    if (!target) return;
    if (target.closest('#audio-settings-modal')) return; // 設定モーダル内は専用の音を鳴らすため除外
    AudioManager.playSE('click');
}, true);

// =====================================================
// 音声設定モーダルのUI制御
// =====================================================
function openAudioSettingsModal() {
    updateAudioSettingsUI();
    document.getElementById('audio-settings-modal').classList.remove('hidden');
}

function closeAudioSettingsModal() {
    document.getElementById('audio-settings-modal').classList.add('hidden');
}

function setAudioLevel(kind, level) {
    if (kind === 'bgm') {
        AudioManager.setBgmLevel(level);
    } else if (kind === 'se') {
        AudioManager.setSeLevel(level);
    }
    updateAudioSettingsUI();
}

function updateAudioSettingsUI() {
    const s = AudioManager.getSettings();
    ['bgm', 'se'].forEach((kind) => {
        AudioManager.LEVELS.forEach((level) => {
            const btn = document.getElementById(`audio-btn-${kind}-${level}`);
            if (!btn) return;
            const active = s[kind] === level;
            btn.classList.toggle('bg-amber-500', active);
            btn.classList.toggle('text-slate-900', active);
            btn.classList.toggle('border-amber-400', active);
            btn.classList.toggle('bg-[#1a120b]', !active);
            btn.classList.toggle('text-gray-400', !active);
            btn.classList.toggle('border-amber-900', !active);
        });
    });

    const iconEl = document.getElementById('audio-settings-icon');
    if (iconEl) {
        const muted = s.bgm === 'off' && s.se === 'off';
        iconEl.className = muted
            ? 'fa-solid fa-volume-xmark'
            : 'fa-solid fa-volume-high';
    }
}

document.addEventListener('DOMContentLoaded', updateAudioSettingsUI);
