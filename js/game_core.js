// =====================================================
// game_core.js
// 育成ゲーム全体で共有する基盤部分：
//   ・GAME_STATE（プレイヤー/冒険の全状態）
//   ・画面遷移、モンスター画像描画、トースト通知
//   ・パートナー選択〜ゲーム開始（startGame）
//   ・技詳細モーダル、引き継ぎ技の管理
//   ・addLog / showEffect / showDamagePopup / animateSprite
//     （育成バトル・マスモンCPU対戦・リアルタイム対戦の3系統から
//       共通で呼び出されるバトル演出ヘルパー）
// 他の game_*.js や masmon_*.js より先に読み込まれる前提。
// =====================================================

// --- ブリーダー名の永続化（LocalStorage） ---
// これが無いと、GAME_STATE.playerName はページ読み込みのたびに既定値
// 'ブリーダー' にリセットされてしまい、startGame() を経由せずに
// 「マイマスモンを見る」から直接PvP対戦・ランキング参照をした場合、
// 常に名前が「ブリーダー」として記録・表示されてしまう（PvPランキング名が
// 誰でも「ブリーダー」になるバグの原因）。
function loadStoredPlayerName() {
    try {
        return localStorage.getItem('mfload_player_name') || 'ブリーダー';
    } catch (e) {
        return 'ブリーダー';
    }
}

function saveStoredPlayerName(name) {
    try {
        localStorage.setItem('mfload_player_name', name);
    } catch (e) { /* ignore（プライベートブラウズ等でlocalStorage不可の場合は無視） */ }
}

// --- ブリーダー名をクラウド（Firebase）と同期する ---
// masmon_owners/{playerId}/name には、マスモン保存時（registerMasmonOwner）に
// 既に名前が書き込まれている。この値をプレイヤーID紐づけの「正」として扱い、
// ページ読み込み時に取得してGAME_STATE・入力欄・LocalStorageキャッシュへ反映する。
// これにより、LocalStorageだけに頼る場合と違い、キャッシュを消しても
// 「引き継ぎコード」でプレイヤーIDさえ復元できれば名前も一緒に復元される。
async function syncPlayerNameFromCloud() {
    try {
        if (typeof initFirebase !== 'function' || !initFirebase()) return;
        if (typeof getMyPlayerId !== 'function') return;

        const pid = getMyPlayerId();
        const snap = await firebaseDb.ref(`masmon_owners/${pid}/name`).once('value');
        const cloudName = snap.val();

        if (cloudName && cloudName !== GAME_STATE.playerName) {
            GAME_STATE.playerName = cloudName;
            saveStoredPlayerName(cloudName);
            const nameInputEl = document.getElementById('player-name-input');
            if (nameInputEl && !nameInputEl.value) {
                nameInputEl.value = cloudName;
            }
        }
    } catch (e) {
        console.error('[ブリーダー名同期エラー]', e);
    }
}

// --- ゲーム状態管理 ---
const GAME_STATE = {
    currentScreen: 'screen-title',
    floor: 1,
    totalActions: 0,          // 総行動回数
    totalDamageDealt: 0,      // 敵への与ダメージ累計
    playerName: loadStoredPlayerName(), // プレイヤー名（LocalStorageから復元。無ければ既定値）
    player: null,
    enemy: null,
    battleTurn: 1,
    isBattleEnd: false,
    isPlayerTurnActive: true,
    usedSkillsThisTurn: {},     // 1ターン中に使用したスキルの記録
    difficulty: 'normal',       // 難易度: 'normal' か 'hard'
    inheritedSkill: null,       // 引き継いでいる追加技のキー
    isDefending: false,         // 防御状態かどうか
    halfRecoveryNextTurn: false, // 次のターン、ガッツ回復量が半減するか
    battleGain: null,           // バトル終了時のステータス成長記録
    isBossBattle: false,        // 現在のバトルがボス戦かどうか
    compassChoice: null,        // 次の探索先がコンパスによってロックされている場合の行先 ('battle','training_event','event','training')
    
    // 新規ステータス
    fatigue: 100,               // 体力 (MAX 100)
    items: [],                  // 所持アイテム (バッグ)
    actionPerformedThisFloor: false, // この階層でトレーニングまたは休養を実行したか
    activeTrainBoost: null,     // アクティブなトレーニングブースト { targetTraining, multiplier }
    skillEnhancements: {},      // 技の強化データ { skKey: { forceBonus, hitBonus, level } }
    isAwakened: false,          // 覚醒状態フラグ（覚醒イベント発生後にtrue）
    playerStatusEffect: null,   // 付与された状態変化 ("根性", "逆上", "底力", "闘魂", "集中")
    isGyakujoActive: false,     // 逆上状態が発動しているか
    isSokojikaraFired: false,   // 底力が既にトリガーされたか (バトル中1回)
    isSokojikaraActive: false,  // 底力のダメージ増加効果が有効か (次の1回)
    isShuchuActive: false,      // 集中状態が有効か (ガッツ90超から技使用まで)
    acquiredEquipment: []        // 今回の冒険中に入手した装備アイテム（クリア時にブリーダーIDへ保存される）
};

// --- モンスター画像読み込みヘルパー関数 ---
// isPartner: プレイヤー側（パートナー/マイマスモン）のモンスターを描画する場合はtrue。
//   プラントは敵モンスターと同じ画像だと向きが同じになってしまうため、
//   パートナー側表示時は専用の「Rプラント.png」（反転版）を使用する。
function renderMonsterVisual(containerEl, name, emoji, isAwakened = false, isPartner = false) {
    if (!containerEl) return;

    // イラスト読み込みが完了するまでは画像を表示しない（絵文字の一瞬表示を防止）。
    // ただし呼び出し側が後から追加するバッジ等の子要素（例：団体戦の出撃順①②③）を
    // 消してしまわないよう、既存の画像要素だけを取り除く（innerHTML全体は上書きしない）。
    const oldImg = containerEl.querySelector('img.monster-visual-img');
    if (oldImg) oldImg.remove();

    // HTML側に初期表示用のプレースホルダー絵文字（例：🍪 👁️ 💬 など）が
    // テキストノードとして直接残っている場合、画像読み込み後にそれと並んで
    // 表示されてしまう（イラストと絵文字が並んで表示されるバグ）ため、
    // 子要素（バッジ等）は残しつつ、直下のテキストノードだけを除去する。
    Array.from(containerEl.childNodes).forEach(node => {
        if (node.nodeType === Node.TEXT_NODE) node.remove();
    });

    // 名前のクレンジング (中ボス/伝説の邪神などの修飾子やスペース、(強敵)などを除外してファイル名にする)
    let cleanName = name.replace("中ボス：", "").replace("伝説の邪神：", "").split(" ")[0];
    cleanName = cleanName.replace(/\s*\(強敵\)\s*/g, "");

    // パートナー（プレイヤー側）のプラントは、敵と向きが被らないよう専用画像を使用
    if (isPartner && cleanName === "プラント" && !isAwakened) {
        cleanName = "Rプラント";
    }

    const prefix = isAwakened ? "覚醒" : "";
    const imagePath = `images/${prefix}${cleanName}.png`;

    // このコンテナへの最新のリクエスト先を記録し、古い非同期読込結果が
    // 後から誤って反映されてしまう（表示が入れ替わる）のを防ぐ
    containerEl.dataset.visualSrc = imagePath;

    const img = new Image();
    img.src = imagePath;
    img.onload = () => {
        if (containerEl.dataset.visualSrc !== imagePath) return; // 別の画像に切り替わっていた場合は反映しない
        const oldImgNow = containerEl.querySelector('img.monster-visual-img');
        if (oldImgNow) oldImgNow.remove();
        const imgEl = document.createElement('img');
        imgEl.src = imagePath;
        imgEl.alt = name;
        imgEl.className = 'monster-visual-img w-full h-full object-contain max-h-24 max-w-24 mx-auto drop-shadow-lg';
        containerEl.insertBefore(imgEl, containerEl.firstChild);
    };
    img.onerror = () => {
        console.warn(`[renderMonsterVisual] 画像が見つかりません: ${imagePath}`);
    };
}


// --- オーラバッジ表示ヘルパー（バトル画面の名前横に色付きバッジを表示する） ---
function renderAuraBadge(elId, auraKey) {
    const el = document.getElementById(elId);
    if (!el) return;
    const aura = AURA_TYPES[auraKey];
    if (!aura) {
        el.classList.add('hidden');
        el.textContent = '';
        return;
    }
    el.textContent = `${aura.emoji}${aura.name}`;
    el.className = `px-1 py-0.5 rounded text-[8px] font-bold text-slate-900 ${aura.colorClass}`;
}

// --- お知らせトースト関数 ---
function showToast(message) {
    const toast = document.getElementById('custom-toast');
    toast.textContent = message;
    toast.classList.remove('opacity-0', 'pointer-events-none');
    toast.classList.add('opacity-100');
    
    setTimeout(() => {
        toast.classList.remove('opacity-100');
        toast.classList.add('opacity-0', 'pointer-events-none');
    }, 3000);
}

// --- スマホブラウザのアドレスバー変動対策（100dvh未対応端末向けフォールバック） ---
function setRealViewportHeight() {
    const vh = window.innerHeight;
    document.documentElement.style.setProperty('--real-vh', `${vh}px`);
    const gameContainer = document.getElementById('game-container');
    const body = document.body;
    if (body) body.style.height = `${vh}px`;
    if (gameContainer) gameContainer.style.height = `${vh}px`;
}
window.addEventListener('resize', setRealViewportHeight);
window.addEventListener('orientationchange', setRealViewportHeight);

// --- 初期化処理 ---
window.addEventListener('load', () => {
    setRealViewportHeight();
    loadInheritedSkill();
    renderPartnerSelection();
    // 保存済みのブリーダー名があれば入力欄にプリセットしておく
    // （PvPランキング等に表示される名前が毎回「ブリーダー」に戻るのを防ぐため）
    const nameInputEl = document.getElementById('player-name-input');
    if (nameInputEl && GAME_STATE.playerName && GAME_STATE.playerName !== 'ブリーダー') {
        nameInputEl.value = GAME_STATE.playerName;
    }
    // Firebase側（プレイヤーIDに紐づく masmon_owners/{playerId}/name）から
    // 名前を取得し直し、LocalStorageより優先して反映する（非同期・失敗しても致命的ではない）
    syncPlayerNameFromCloud();
    // Firebaseのサーバー時刻オフセット取得をできるだけ早く開始しておく
    // （ランダムマッチング等の「経過時間」判定が端末の時計ズレに影響されないようにするため）
    if (typeof initFirebase === 'function') initFirebase();
});

// --- LocalStorageによるスキル継承管理 ---
function loadInheritedSkill() {
    const skillKey = localStorage.getItem('mf_inherited_skill');
    if (skillKey && SKILLS_DB[skillKey]) {
        GAME_STATE.inheritedSkill = skillKey;
        document.getElementById('inherited-skill-display').textContent = `${SKILLS_DB[skillKey].name} (継承中)`;
        document.getElementById('clear-skill-btn').classList.remove('hidden');
    } else {
        GAME_STATE.inheritedSkill = null;
        document.getElementById('inherited-skill-display').textContent = 'なし (初期状態)';
        document.getElementById('clear-skill-btn').classList.add('hidden');
    }
}

function saveInheritedSkill(skillKey) {
    if (skillKey) {
        localStorage.setItem('mf_inherited_skill', skillKey);
    } else {
        localStorage.removeItem('mf_inherited_skill');
    }
    loadInheritedSkill();
}

// 技長押し・詳細モーダル制御関数
function openSkillModal(skKey) {
    const sk = SKILLS_DB[skKey];
    if (!sk) return;

    const p = GAME_STATE.player;
    const e = GAME_STATE.enemy;
    const currentGuts = p ? Math.floor(p.guts) : 50;
    const mods = getGutsModifiers(currentGuts);

    document.getElementById('modal-skill-name').textContent = sk.name;
    document.getElementById('modal-skill-cost').textContent = sk.cost;
    document.getElementById('modal-skill-rank').textContent = getDamageRank(sk.force, sk.type);
    document.getElementById('modal-skill-gutsdown').textContent = sk.gutsDown || 0;
    document.getElementById('modal-skill-desc').textContent = sk.desc || "説明はありません。";
    document.getElementById('modal-current-guts').textContent = currentGuts;
    
    // 補正の可視化
    if (sk.type === 'heal' || sk.type.startsWith('buff')) {
        document.getElementById('modal-guts-dmg-scale').textContent = "なし (補助)";
        document.getElementById('modal-guts-hit-rate').textContent = "必中";
    } else {
        document.getElementById('modal-guts-dmg-scale').textContent = mods.dmgMod.toFixed(2) + "倍";
        
        // 命中率計算
        if (sk.hitRate === 100) {
            document.getElementById('modal-guts-hit-rate').textContent = "必中 🎯";
        } else if (e) {
            const actualHit = Math.max(10, Math.min(99, (sk.hitRate + mods.hitMod) + (p.stats.hit - e.stats.spd) * 0.5));
            document.getElementById('modal-guts-hit-rate').textContent = Math.round(actualHit) + "%";
        } else {
            const actualHit = Math.max(10, Math.min(99, sk.hitRate + mods.hitMod));
            document.getElementById('modal-guts-hit-rate').textContent = Math.round(actualHit) + "%";
        }
    }

    let typeStr = "ちから技";
    if (sk.type === 'int') typeStr = "かしこさ技";
    if (sk.type === 'heal') typeStr = "回復技";
    if (sk.type.startsWith('buff')) typeStr = "補助技";
    document.getElementById('modal-skill-type').textContent = typeStr;

    document.getElementById('skill-modal').classList.remove('hidden');
}

function closeSkillModal() {
    document.getElementById('skill-modal').classList.add('hidden');
}

function clearInheritedSkill() {
    saveInheritedSkill(null);
}

// 画面遷移
function changeScreen(screenId) {
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });
    document.getElementById(screenId).classList.add('active');
    GAME_STATE.currentScreen = screenId;
}

// パートナー選択
let selectedPartnerId = 'mochi';
function renderPartnerSelection() {
    const container = document.getElementById('partner-select-container');
    container.innerHTML = '';
    
    Object.values(MONSTER_TEMPLATES).forEach(m => {
        const isSelected = m.id === selectedPartnerId;
        const btn = document.createElement('button');
        btn.className = `p-3 rounded-xl border flex flex-col items-center justify-center transition-all ${
            isSelected ? 'bg-amber-600 border-amber-400 text-white shadow-lg scale-105' : 'bg-[#1a120b] border-amber-900/60 text-gray-400 hover:border-amber-700'
        }`;
        btn.onclick = () => selectPartner(m.id);
        
        // 画像または絵文字を動的に設定するためのコンテナを作成
        const visualEl = document.createElement('div');
        visualEl.className = 'w-12 h-12 flex items-center justify-center mb-1 text-3xl';
        renderMonsterVisual(visualEl, m.name, m.emoji, false, true);
        
        const nameEl = document.createElement('span');
        nameEl.className = 'text-[11px] font-bold';
        nameEl.textContent = m.name;
        
        btn.appendChild(visualEl);
        btn.appendChild(nameEl);
        container.appendChild(btn);
    });

    updatePartnerDetails();
}

function selectPartner(id) {
    selectedPartnerId = id;
    renderPartnerSelection();
}

function updatePartnerDetails() {
    const monster = MONSTER_TEMPLATES[selectedPartnerId];
    const details = document.getElementById('selected-monster-details');
    details.innerHTML = `
        <p class="text-amber-400 font-bold mb-1">${monster.name} の初期パラメータ</p>
        <div class="grid grid-cols-2 gap-x-4 gap-y-1 bg-[#150b07] p-2 rounded text-[11px]">
            <div>ライフ: <span class="text-white font-mono">${monster.stats.maxLife}</span></div>
            <div>ちから: <span class="text-white font-mono">${monster.stats.pow}</span></div>
            <div>かしこさ: <span class="text-white font-mono">${monster.stats.int}</span></div>
            <div>命中: <span class="text-white font-mono">${monster.stats.hit}</span></div>
            <div>回避: <span class="text-white font-mono">${monster.stats.spd}</span></div>
            <div>丈夫さ: <span class="text-white font-mono">${monster.stats.def}</span></div>
        </div>
        <p class="text-[10px] text-gray-400 mt-2 leading-relaxed">${monster.desc}</p>
    `;
}

// --- 技の背景色・スタイルの設定 ---
function getSkillStyle(sk) {
    if (!sk) return { bgClass: 'bg-[#3c2a21]', borderClass: 'border-amber-700/40', textClass: 'text-amber-200', textIntensity: 'text-slate-900' };
    if (sk.type === 'pow') {
        return {
            bgClass: 'bg-[#ebdcb9]',
            borderClass: 'border-[#c0af87]',
            textClass: 'text-[#4a3c1c] font-bold',
            textIntensity: 'text-[#3c3115]'
        };
    } else if (sk.type === 'int') {
        return {
            bgClass: 'bg-[#d1e7dd]',
            borderClass: 'border-[#a3cfbb]',
            textClass: 'text-[#0f5132] font-bold',
            textIntensity: 'text-[#0a3622]'
        };
    } else if (sk.type === 'heal') {
        return {
            bgClass: 'bg-[#f8d7da]',
            borderClass: 'border-[#f5c2c7]',
            textClass: 'text-[#842029] font-bold',
            textIntensity: 'text-[#58151c]'
        };
    } else {
        return {
            bgClass: 'bg-[#cff4fc]',
            borderClass: 'border-[#b6effb]',
            textClass: 'text-[#055160] font-bold',
            textIntensity: 'text-[#022f38]'
        };
    }
}

// --- ゲーム開始 ---
function startGame() {
    const template = MONSTER_TEMPLATES[selectedPartnerId];
    
    const nameInput = document.getElementById('player-name-input');
    const enteredName = nameInput ? nameInput.value.trim() : '';
    // 入力が空の場合、以前保存済みの名前があればそれを維持する（無ければ既定値）
    GAME_STATE.playerName = enteredName || GAME_STATE.playerName || 'ブリーダー';
    saveStoredPlayerName(GAME_STATE.playerName);
    // プレイヤーIDに紐づけてクラウド側にも即時反映（失敗しても本編の進行は妨げない）
    if (typeof registerMasmonOwner === 'function') {
        registerMasmonOwner().catch(() => {});
    }
    
    const diffRadios = document.getElementsByName('difficulty');
    for (let r of diffRadios) {
        if (r.checked) {
            GAME_STATE.difficulty = r.value;
        }
    }

    let startSkills = [];
    if (template.id === 'mochi') {
        startSkills = ['monta', 'mochiki', 'sakurafubuki'];
    } else if (template.id === 'suezo') {
        startSkills = ['shippobinta', 'nameru', 'kamitsuki'];
    } else if (template.id === 'dino') {
        startSkills = ['shippo', 'kamitsuki_dino', 'sunakake'];
    } else if (template.id === 'monolith') {
        startSkills = ['monotaore', 'warawara', 'sakebigoe'];
    } else if (template.id === 'plant') {
        startSkills = ['renkon', 'tane_gun', 'kafun'];
    } else if (template.id === 'kyubi') {
        startSkills = ['hikkaki', 'kitsunebi'];
    }

    GAME_STATE.player = {
        name: template.name,
        emoji: template.emoji,
        stats: { ...template.stats },
        skills: startSkills,
        weakenTurns: 0,   // わらわら等で受ける「ちから・かしこさ低下」の残ターン
        confuseTurns: 0,  // サケビ声等で受ける「混乱」の残行動回数
        forceBoost: 0,    // オーロラゲート等で得る「次の技威力アップ」倍率
        shieldValue: 0,   // 九重神眼等で得るシールド（被ダメージ吸収）の残量
        shieldUsedThisBattle: false, // 九重神眼等の「バトル中1回限り」シールド技を使用済みか
        dodgeNextGuaranteed: false, // 陽炎等で得る「次の敵攻撃を確実に回避」フラグ
        permaForceBoostActive: false // 天河天翔等で得る「今後のダメージ永続アップ」フラグ
    };

    if (GAME_STATE.inheritedSkill && !GAME_STATE.player.skills.includes(GAME_STATE.inheritedSkill)) {
        GAME_STATE.player.skills.push(GAME_STATE.inheritedSkill);
    }

    GAME_STATE.floor = 1;
    GAME_STATE.totalActions = 0; 
    GAME_STATE.totalDamageDealt = 0;
    GAME_STATE.fatigue = 100;
    GAME_STATE.actionPerformedThisFloor = false;
    
    GAME_STATE.items = [
        { ...ITEMS_DB.energy_drink },
        { ...ITEMS_DB.power_jelly }
    ];
    
    GAME_STATE.compassChoice = null;
    GAME_STATE.activeTrainBoost = null;
    GAME_STATE.skillEnhancements = {};
    GAME_STATE.isAwakened = false;
    GAME_STATE.playerStatusEffect = null;
    GAME_STATE.isGyakujoActive = false;
    GAME_STATE.isSokojikaraFired = false;
    GAME_STATE.isSokojikaraActive = false;
    GAME_STATE.isShuchuActive = false;
    GAME_STATE.acquiredEquipment = [];

    goToAuraRitual();
}

// =====================================================
// オーラの儀式（新要素）
// 育成開始時に、パートナーへ宿すオーラ（赤/緑/黄/青）をプレイヤーに選ばせる
// 演出シーン。選んだオーラは GAME_STATE.player.aura に保存され、
// 育成中バトル(game_battle.js)のダメージ計算で有利属性判定に使われる。
// =====================================================
let selectedRitualAura = null;

function goToAuraRitual() {
    selectedRitualAura = null;
    renderAuraRitualSelection();
    changeScreen('screen-aura-ritual');
}

function renderAuraRitualSelection() {
    const container = document.getElementById('aura-select-container');
    container.innerHTML = '';

    Object.values(AURA_TYPES).forEach(aura => {
        const isSelected = aura.key === selectedRitualAura;
        const btn = document.createElement('button');
        btn.className = `p-3 rounded-xl border flex flex-col items-center justify-center transition-all ${
            isSelected ? `${aura.colorClass} border-white text-slate-900 shadow-lg scale-105` : 'bg-[#0f1620] border-sky-900/60 text-gray-300 hover:border-sky-600'
        }`;
        btn.onclick = () => selectRitualAura(aura.key);

        const emojiEl = document.createElement('div');
        emojiEl.className = 'text-2xl mb-1';
        emojiEl.textContent = aura.emoji;

        const nameEl = document.createElement('span');
        nameEl.className = 'text-[11px] font-bold';
        nameEl.textContent = aura.name;

        btn.appendChild(emojiEl);
        btn.appendChild(nameEl);
        container.appendChild(btn);
    });

    updateAuraRitualDetail();
}

function selectRitualAura(key) {
    selectedRitualAura = key;
    renderAuraRitualSelection();

    const confirmBtn = document.getElementById('aura-ritual-confirm-btn');
    confirmBtn.disabled = false;
    confirmBtn.classList.remove('bg-gray-700', 'text-gray-400', 'border-gray-800', 'cursor-not-allowed');
    confirmBtn.classList.add('bg-sky-500', 'hover:bg-sky-600', 'text-slate-900', 'border-sky-700', 'active:scale-95');
}

function updateAuraRitualDetail() {
    const detail = document.getElementById('aura-ritual-detail');
    if (!selectedRitualAura) {
        detail.textContent = 'オーラを選ぶと、相性の詳細がここに表示されます。';
        return;
    }
    const aura = AURA_TYPES[selectedRitualAura];
    const beatenAura = AURA_TYPES[aura.beats];
    detail.innerHTML = `<span class="${aura.textClass} font-bold">${aura.emoji}${aura.name}のオーラ</span>を選択中。
        <span class="${beatenAura.textClass} font-bold">${beatenAura.emoji}${beatenAura.name}のオーラ</span>を持つ相手には与ダメージが1.5倍になります。`;
}

function confirmAuraRitual() {
    if (!selectedRitualAura) return;
    const aura = AURA_TYPES[selectedRitualAura];
    GAME_STATE.player.aura = selectedRitualAura;
    showToast(`✨ ${aura.emoji}${aura.name}のオーラを宿した！`);
    goToAdventure();
}


// バトル用アニメーション/エフェクト演出関数
function addLog(text) {
    const log = document.getElementById('battle-log');
    const div = document.createElement('div');
    div.textContent = text;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
}

function showEffect(text) {
    const overlay = document.getElementById('battle-effect-overlay');
    overlay.textContent = text;
    overlay.classList.remove('scale-0');
    overlay.classList.add('scale-100');
    setTimeout(() => {
        overlay.classList.remove('scale-100');
        overlay.classList.add('scale-0');
    }, 800);
}

function showDamagePopup(elId, val, isCrit) {
    const el = document.getElementById(elId);
    el.textContent = val;
    if (isCrit) {
        el.className = "absolute -top-10 text-xl font-black text-red-500 opacity-100 scale-125 transition-all duration-500 pointer-events-none";
    } else {
        el.className = "absolute -top-8 text-base font-bold text-white opacity-100 scale-100 transition-all duration-500 pointer-events-none";
    }
    setTimeout(() => {
        el.classList.replace('opacity-100', 'opacity-0');
    }, 800);
}

function animateSprite(containerId, animClass) {
    const el = document.getElementById(containerId);
    if (animClass === 'shake') {
        el.classList.add('animate-ping');
        setTimeout(() => el.classList.remove('animate-ping'), 250);
    } else {
        el.classList.add(animClass);
        setTimeout(() => el.classList.remove(animClass), 200);
    }
}
