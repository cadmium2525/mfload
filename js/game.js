// --- ゲーム状態管理 ---
const GAME_STATE = {
    currentScreen: 'screen-title',
    floor: 1,
    totalActions: 0,          // 総行動回数
    totalDamageDealt: 0,      // 敵への与ダメージ累計
    playerName: 'ブリーダー', // プレイヤー名
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
    isShuchuActive: false       // 集中状態が有効か (ガッツ90超から技使用まで)
};

// --- モンスター画像読み込みヘルパー関数 ---
function renderMonsterVisual(containerEl, name, emoji, isAwakened = false) {
    if (!containerEl) return;

    // 画像ロード前にまず絵文字で即時初期化（残像防止）
    containerEl.innerHTML = `<span class="text-5xl filter drop-shadow-[0_8px_6px_rgba(0,0,0,0.6)]">${emoji}</span>`;

    // 名前のクレンジング (中ボス/伝説の邪神などの修飾子やスペース、(強敵)などを除外してファイル名にする)
    let cleanName = name.replace("中ボス：", "").replace("伝説の邪神：", "").split(" ")[0];
    cleanName = cleanName.replace(/\s*\(強敵\)\s*/g, "");

    const prefix = isAwakened ? "覚醒" : "";
    const imagePath = `images/${prefix}${cleanName}.png`;

    const img = new Image();
    img.src = imagePath;
    img.onload = () => {
        // 画像が存在する場合はimgタグを挿入
        containerEl.innerHTML = `<img src="${imagePath}" alt="${name}" class="w-full h-full object-contain max-h-24 max-w-24 mx-auto drop-shadow-lg">`;
    };
    // onerror: 既に絵文字でフォールバック表示済みのため何もしない
    img.onerror = () => {};
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
        renderMonsterVisual(visualEl, m.name, m.emoji, false);
        
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
    GAME_STATE.playerName = enteredName || 'ブリーダー';
    
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
    }

    GAME_STATE.player = {
        name: template.name,
        emoji: template.emoji,
        stats: { ...template.stats },
        skills: startSkills 
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

    goToAdventure();
}

function goToAdventure() {
    updateAdventureUI();
    changeScreen('screen-adventure');
}

function updateAdventureUI() {
    document.getElementById('adventure-floor').textContent = `FLOOR ${GAME_STATE.floor}/30`;
    document.getElementById('adventure-actions').textContent = GAME_STATE.totalActions;
    
    const diffTag = document.getElementById('adventure-diff-tag');
    if (GAME_STATE.difficulty === 'hard') {
        diffTag.textContent = '💀 HARD MODE 💀';
        diffTag.className = 'text-[9px] text-red-500 font-bold mt-1 text-center';
    } else {
        diffTag.textContent = 'NORMAL MODE';
        diffTag.className = 'text-[9px] text-emerald-400 font-bold mt-1 text-center';
    }

    const p = GAME_STATE.player;
    const advIconEl = document.getElementById('adventure-monster-icon');
    renderMonsterVisual(advIconEl, p.name, p.emoji, GAME_STATE.isAwakened);
    document.getElementById('adventure-monster-name').textContent = p.name;
    
    document.getElementById('adv-stat-life').textContent = `${p.stats.life}/${p.stats.maxLife}`;
    document.getElementById('adv-stat-pow').textContent = p.stats.pow;
    document.getElementById('adv-stat-int').textContent = p.stats.int;
    document.getElementById('adv-stat-hit').textContent = p.stats.hit;
    document.getElementById('adv-stat-spd').textContent = p.stats.spd;
    document.getElementById('adv-stat-def').textContent = p.stats.def;

    document.getElementById('adv-stat-fatigue').textContent = `${GAME_STATE.fatigue}/100`;
    const fatiguePct = GAME_STATE.fatigue;
    const fBar = document.getElementById('adv-fatigue-bar');
    fBar.style.width = `${fatiguePct}%`;
    if (fatiguePct < 30) {
        fBar.className = "bg-red-500 h-full rounded-full transition-all duration-300";
    } else if (fatiguePct < 60) {
        fBar.className = "bg-yellow-500 h-full rounded-full transition-all duration-300";
    } else {
        fBar.className = "bg-green-500 h-full rounded-full transition-all duration-300";
    }

    document.getElementById('bag-count').textContent = GAME_STATE.items.length;

    const compassBadge = document.getElementById('compass-active-badge');
    if (GAME_STATE.compassChoice) {
        compassBadge.classList.remove('hidden');
        let routeName = '';
        if (GAME_STATE.compassChoice === 'battle') routeName = '⚔️ バトル確定';
        if (GAME_STATE.compassChoice === 'training_event') routeName = '🏋️ トレーニング確定';
        if (GAME_STATE.compassChoice === 'event') routeName = '⛲ イベント確定';
        if (GAME_STATE.compassChoice === 'training') routeName = '⛰️ 修行(新技)確定';
        compassBadge.innerHTML = `🧭 運命のコンパス効果: <span class="font-black text-amber-300">${routeName}</span>`;
    } else {
        compassBadge.classList.add('hidden');
    }

    const listContainer = document.getElementById('adv-skills-list');
    listContainer.innerHTML = '';
    p.skills.forEach(skKey => {
        const skill = SKILLS_DB[skKey];
        const span = document.createElement('span');
        const style = getSkillStyle(skill);
        const rank = getDamageRank(skill.force, skill.type);
        span.className = `border px-2 py-0.5 rounded text-[9px] ${style.bgClass} ${style.borderClass} ${style.textClass}`;
        span.textContent = skill ? `${skill.name}[${rank}]` : '未知の技';
        listContainer.appendChild(span);
    });

    const tBtn = document.getElementById('btn-training-menu');
    const rBtn = document.getElementById('btn-rest');
    const prompt = document.getElementById('adventure-prompt');
    
    if (GAME_STATE.actionPerformedThisFloor) {
        tBtn.disabled = true;
        tBtn.classList.add('opacity-40', 'pointer-events-none');
        rBtn.disabled = true;
        rBtn.classList.add('opacity-40', 'pointer-events-none');
        prompt.innerHTML = `<span class="text-amber-400 font-bold">✨ この階層での育成・休養は完了しました！次の階層へ進みましょう。</span>`;
    } else {
        tBtn.disabled = false;
        tBtn.classList.remove('opacity-40', 'pointer-events-none');
        rBtn.disabled = false;
        rBtn.classList.remove('opacity-40', 'pointer-events-none');
        
        if (GAME_STATE.floor % 10 === 0) {
            prompt.innerHTML = `<span class="text-red-500 font-bold pixel-font">⚠️ 警告：この先に強力なボス反応があります！</span>`;
        } else {
            prompt.textContent = `モンスターをトレーニングで鍛えるか、次の階層へ進みましょう！`;
        }
    }
}

function triggerNextFloor() {
    if (GAME_STATE.floor % 10 === 0) {
        setupBattle(true);
        return;
    }

    if (GAME_STATE.compassChoice) {
        const chosen = GAME_STATE.compassChoice;
        GAME_STATE.compassChoice = null;

        if (chosen === 'battle') {
            setupBattle(false);
        } else if (chosen === 'training_event') {
            setupTrainingEvent();
        } else if (chosen === 'event') {
            setupEvent(false);
        } else if (chosen === 'training') {
            setupEvent(true);
        }
        return;
    }

    const rand = Math.random() * 110;
    
    if (rand < 45) {
        setupBattle(false);                     
    } else if (rand < 60) {
        setupTrainingEvent(); 
    } else if (rand < 90) {
        setupEvent(false);                      
    } else {
        setupEvent(true);                       
    }
}

function openCompassSelection() {
    changeScreen('screen-compass-select');
}

function selectCompassRoute(route) {
    GAME_STATE.compassChoice = route;
    showToast(`運命 of コンパスにより次の探索先が確定しました！`);
    goToAdventure();
}

// ==================== トレーニング画面の制御 ====================
function openTrainingMenu() {
    document.getElementById('training-current-fatigue').textContent = GAME_STATE.fatigue;
    renderTrainingList();
    changeScreen('screen-training');
}

function renderTrainingList() {
    const container = document.getElementById('training-list-container');
    container.innerHTML = '';

    const p = GAME_STATE.player;

    TRAINING_DB.forEach(train => {
        const canDo = GAME_STATE.fatigue >= train.cost;
        const isBoosted = GAME_STATE.activeTrainBoost && GAME_STATE.activeTrainBoost.targetTraining === train.id;
        const card = document.createElement('div');
        card.className = `p-3 rounded-xl border flex flex-col justify-between ${
            isBoosted
                ? 'bg-gradient-to-br from-amber-950 to-[#2a1b15] border-amber-400 shadow-[0_0_10px_2px_rgba(251,191,36,0.4)] ring-1 ring-amber-400/60'
                : (canDo ? 'bg-[#2a1b15] border-amber-900/60' : 'bg-[#1a120b] border-red-950/40 opacity-60')
        }`;

        let costColor = canDo ? 'text-cyan-400' : 'text-red-500';
        let tagColor = train.type === 'heavy' ? 'bg-red-950 text-red-300' : 'bg-cyan-950 text-cyan-300';
        let tagText = train.type === 'heavy' ? '重トレ' : '軽トレ';

        const boostMultForDisplay = isBoosted ? GAME_STATE.activeTrainBoost.multiplier : 1.0;
        const diminishedMain = Math.floor(getDiminishedVal(p.stats[train.mainStat], train.mainVal) * boostMultForDisplay);
        let statBonusText = '';
        if (train.type === 'light') {
            statBonusText = `<span class="text-green-400 font-bold font-mono">+${diminishedMain}</span>`;
        } else {
            const diminishedExtra = Math.floor(getDiminishedVal(p.stats[train.extraStat], train.extraVal) * boostMultForDisplay);
            statBonusText = `<span class="text-green-400 font-bold font-mono">+${diminishedMain}</span> / <span class="text-green-300 font-mono">+${diminishedExtra}</span> / <span class="text-red-500 font-mono">-${train.penaltyVal}</span>`;
        }

        const boostBadge = isBoosted
            ? `<span class="text-[9px] px-1.5 py-0.5 rounded bg-amber-500 text-slate-900 font-extrabold animate-pulse">🌟 ブースト中 ×${GAME_STATE.activeTrainBoost.multiplier}</span>`
            : '';

        card.innerHTML = `
            <div class="flex justify-between items-center w-full">
                <div class="flex items-center space-x-2 flex-wrap gap-y-1">
                    <span class="text-xs font-bold text-white">${train.name}</span>
                    <span class="text-[9px] px-1.5 py-0.5 rounded ${tagColor}">${tagText}</span>
                    ${boostBadge}
                </div>
                <span class="text-[10px] ${costColor} font-bold font-mono"><i class="fa-solid fa-bolt mr-0.5"></i>体力 -${train.cost}</span>
            </div>
            <p class="text-[10px] text-gray-400 mt-1 leading-relaxed">${train.desc}</p>
            <div class="flex justify-between items-center mt-2 pt-1.5 border-t border-amber-950/40 text-[10px]">
                <span class="text-amber-300 font-bold">パラメータ変動（現在効率）:</span>
                <span>${statBonusText}</span>
            </div>
            <button onclick="executeTraining('${train.id}')" ${!canDo ? 'disabled' : ''} class="mt-2.5 w-full py-1.5 rounded-lg text-[10px] font-bold ${
                isBoosted ? 'bg-amber-500 hover:bg-amber-600 text-slate-900' : (canDo ? 'bg-cyan-600 hover:bg-cyan-700 text-white' : 'bg-gray-800 text-gray-500 cursor-not-allowed')
            }">
                ${isBoosted ? '🌟 ブースト発動でトレーニング！' : 'トレーニング開始'}
            </button>
        `;
        container.appendChild(card);
    });
}

function executeTraining(id) {
    const train = TRAINING_DB.find(t => t.id === id);
    if (!train || GAME_STATE.fatigue < train.cost) {
        showToast("体力が不足しています！休養するか回復アイテムを使ってください。");
        return;
    }

    const p = GAME_STATE.player;
    GAME_STATE.fatigue -= train.cost;
    GAME_STATE.totalActions++; 
    GAME_STATE.actionPerformedThisFloor = true; 

    const diminishedMainVal = getDiminishedVal(p.stats[train.mainStat], train.mainVal);
    let statChanges = [];
    
    let boostMult = 1.0;
    if (GAME_STATE.activeTrainBoost && GAME_STATE.activeTrainBoost.targetTraining === train.id) {
        boostMult = GAME_STATE.activeTrainBoost.multiplier;
        GAME_STATE.activeTrainBoost = null; // 消費
        showToast(`🌟 トレーニングブーストが発動！効果が${boostMult}倍になった！`);
    }

    const boostedMain = Math.floor(diminishedMainVal * boostMult);
    p.stats[train.mainStat] += boostedMain;
    statChanges.push(`${getStatLabel(train.mainStat)}+${boostedMain}`);

    if (train.mainStat === 'maxLife') {
        p.stats.life = Math.min(p.stats.maxLife, p.stats.life + boostedMain);
    }

    let diminishedExtraVal = 0;
    if (train.extraStat && train.extraVal) {
        diminishedExtraVal = getDiminishedVal(p.stats[train.extraStat], train.extraVal);
        const boostedExtra = Math.floor(diminishedExtraVal * boostMult);
        p.stats[train.extraStat] += boostedExtra;
        statChanges.push(`${getStatLabel(train.extraStat)}+${boostedExtra}`);
        if (train.extraStat === 'maxLife') {
            p.stats.life = Math.min(p.stats.maxLife, p.stats.life + boostedExtra);
        }
    }

    if (train.penaltyStat && train.penaltyVal) {
        p.stats[train.penaltyStat] = Math.max(5, p.stats[train.penaltyStat] - train.penaltyVal);
        statChanges.push(`${getStatLabel(train.penaltyStat)}-${train.penaltyVal}`);
    }

    let resultPrefix = "トレーニング成功！";
    if (Math.random() < 0.1) {
        resultPrefix = "🔥 トレーニング超大成功！！効果1.5倍！";
        const bonusMain = Math.floor(boostedMain * 0.5);
        p.stats[train.mainStat] += bonusMain;
        if (train.extraStat) {
            const boostedExtra = Math.floor(diminishedExtraVal * boostMult);
            const bonusExtra = Math.floor(boostedExtra * 0.5);
            p.stats[train.extraStat] += bonusExtra;
        }
    }

    showToast(`${resultPrefix}\n${statChanges.join(' / ')}`);
    goToAdventure();
}

function executeRest() {
    GAME_STATE.fatigue = Math.min(100, GAME_STATE.fatigue + 50);
    GAME_STATE.totalActions++; 
    GAME_STATE.actionPerformedThisFloor = true; 
    showToast("モンスターとしっかり休養して体力が 50 回復した！");
    goToAdventure();
}

function getStatLabel(key) {
    const labels = {
        maxLife: 'ライフ',
        pow: 'ちから',
        int: 'かしこさ',
        hit: '命中',
        spd: '回避',
        def: '丈夫さ'
    };
    return labels[key] || key;
}

// ==================== バッグ・アイテムの制御 ====================
function openBagMenu() {
    renderBagList();
    changeScreen('screen-bag');
}

function renderBagList() {
    const container = document.getElementById('bag-list-container');
    container.innerHTML = '';

    if (GAME_STATE.items.length === 0) {
        container.innerHTML = `
            <div class="p-6 text-center text-gray-500 text-xs">
                🎒 バッグは空っぽです。<br>バトルに勝利すると、低確率で便利なアイテムが手に入ります！
            </div>
        `;
        return;
    }

    GAME_STATE.items.forEach((item, index) => {
        const card = document.createElement('div');
        card.className = 'p-3 bg-[#2a1b15] rounded-xl border border-amber-900/60 flex items-center justify-between';
        card.innerHTML = `
            <div class="flex items-center space-x-3 flex-1 pr-2">
                <span class="text-3xl">${item.icon}</span>
                <div class="text-left space-y-0.5">
                    <span class="text-xs font-bold text-white block">${item.name}</span>
                    <span class="text-[9px] text-gray-400 block leading-relaxed">${item.desc}</span>
                </div>
            </div>
            <button onclick="useItem(${index})" class="bg-amber-600 hover:bg-amber-500 text-white text-[10px] font-bold px-3 py-2 rounded-lg transition-all active:scale-95 shrink-0">
                使用
            </button>
        `;
        container.appendChild(card);
    });
}

function useItem(index) {
    const item = GAME_STATE.items[index];
    if (!item) return;

    const p = GAME_STATE.player;

    if (item.type === 'fatigue') {
        GAME_STATE.fatigue = Math.min(100, GAME_STATE.fatigue + item.value);
        showToast(`${item.name} を使って、体力が ${item.value} 回復した！`);
    } else if (item.type === 'stat') {
        const diminishedVal = getDiminishedVal(p.stats[item.stat], item.value);
        p.stats[item.stat] += diminishedVal;
        if (item.stat === 'maxLife') {
            p.stats.life = Math.min(p.stats.maxLife, p.stats.life + diminishedVal);
        }
        showToast(`${item.name} を使って、${getStatLabel(item.stat)}が ${diminishedVal} アップした！`);
    } else if (item.type === 'compass') {
        GAME_STATE.items.splice(index, 1);
        openCompassSelection();
        return; 
    } else if (item.type === 'train_boost') {
        GAME_STATE.activeTrainBoost = { targetTraining: item.targetTraining, multiplier: item.multiplier };
        const trainName = TRAINING_DB.find(t => t.id === item.targetTraining)?.name || item.targetTraining;
        showToast(`${item.name} をセット！次の「${trainName}」のトレーニング効果が${item.multiplier}倍になる！`);
    }

    GAME_STATE.items.splice(index, 1); 
    renderBagList();
    updateAdventureUI();
}

// ==================== 探索イベント：トレーニングイベント ====================
function setupTrainingEvent() {
    const train = TRAINING_DB[Math.floor(Math.random() * TRAINING_DB.length)];
    const p = GAME_STATE.player;

    document.getElementById('event-tag').textContent = 'TRAINING EVENT / お勧め特訓';
    document.getElementById('event-tag').className = 'text-xs text-cyan-400 tracking-wider font-bold';
    document.getElementById('event-title').textContent = `道中でお勧めトレーニングを発見！`;
    document.getElementById('event-visual').textContent = '🏋️';
    document.getElementById('event-description').textContent = `
        探索中、ちょうどいい訓練設備【${train.name}】を発見した！
        お勧めのため、体力を一切消費せずにトレーニングが可能です。やってみますか？
    `;
    document.getElementById('event-result').classList.add('hidden');

    const choicesContainer = document.getElementById('event-choices-container');
    choicesContainer.innerHTML = '';

    const btn = document.createElement('button');
    btn.className = 'w-full py-3 bg-[#3c2a21] hover:bg-[#4a352a] text-white font-bold rounded-xl text-xs shadow-md border border-amber-800 transition-all active:scale-95';
    btn.textContent = `ノーコストで ${train.name} を行う！`;
    btn.onclick = () => {
        GAME_STATE.totalActions++;

        const diminishedMain = getDiminishedVal(p.stats[train.mainStat], train.mainVal);
        p.stats[train.mainStat] += diminishedMain;
        if (train.mainStat === 'maxLife') {
            p.stats.life = Math.min(p.stats.maxLife, p.stats.life + diminishedMain);
        }

        let diminishedExtra = 0;
        if (train.extraStat) {
            diminishedExtra = getDiminishedVal(p.stats[train.extraStat], train.extraVal);
            p.stats[train.extraStat] += diminishedExtra;
            if (train.extraStat === 'maxLife') {
                p.stats.life = Math.min(p.stats.maxLife, p.stats.life + diminishedExtra);
            }
        }

        let bonusLog = `${getStatLabel(train.mainStat)}+${diminishedMain}`;
        if (train.extraStat) {
            bonusLog += ` / ${getStatLabel(train.extraStat)}+${diminishedExtra}`;
        }

        const resultBox = document.getElementById('event-result');
        resultBox.textContent = `大成功！体力を消費せずに ${train.name} を完遂した！能力アップ：[${bonusLog}]`;
        resultBox.classList.remove('hidden');

        choicesContainer.innerHTML = `
            <button onclick="endEvent()" class="w-full py-4 bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold rounded-xl text-xs shadow-md transition-all">
                冒険を再開する
            </button>
        `;
    };
    choicesContainer.appendChild(btn);

    changeScreen('screen-event');
}

// ==================== 通常イベント / 修行 画面制御 ====================
function setupEvent(isTraining = false) {
    let ev;
    if (isTraining) {
        ev = TRAINING_EVENTS[0]; 
        document.getElementById('event-tag').textContent = 'SPECIAL TRAINING / 新技修行';
        document.getElementById('event-tag').className = 'text-xs text-cyan-400 tracking-wider font-bold';
        
        const p = GAME_STATE.player;
        let candidates = [];
        if (p.emoji === '🍪') candidates = ['monta', 'mochiki', 'gaccho', 'sakurafubuki', 'cho_rollinmochi', 'cho_mochihou', 'mossama', 'yaezakura'];
        else if (p.emoji === '👁️') candidates = ['shippobinta', 'nameru', 'kamitsuki', 'kuu', 'psychokinesis', 'cho_netsushisen', 'utau', 'berobinta'];
        else if (p.emoji === '🦖') candidates = ['shippo', 'kamitsuki_dino', 'sunakake', 'kamitsukinage', 'honoo_taiatari', 'hizageri', 'kurohizacombo'];
        
        const available = candidates.filter(s => !p.skills.includes(s));
        if (available.length === 0) {
            setupSkillEnhancementTraining();
            return;
        }
    } else {
        if (!GAME_STATE.isAwakened && Math.random() < 0.10) {
            triggerAwakeningEvent();
            return;
        }
        ev = GENERAL_EVENTS[Math.floor(Math.random() * GENERAL_EVENTS.length)];
        document.getElementById('event-tag').textContent = 'EVENT OCCURRED / イベント';
        document.getElementById('event-tag').className = 'text-xs text-amber-400 tracking-wider font-bold';
    }
    
    document.getElementById('event-title').textContent = ev.title;
    document.getElementById('event-visual').textContent = ev.visual;
    document.getElementById('event-description').textContent = ev.desc;
    document.getElementById('event-result').classList.add('hidden');

    const choicesContainer = document.getElementById('event-choices-container');
    choicesContainer.innerHTML = '';

    ev.choices.forEach(ch => {
        const btn = document.createElement('button');
        btn.className = 'w-full py-3 bg-[#3c2a21] hover:bg-[#4a352a] text-white font-bold rounded-xl text-xs shadow-md border border-amber-800 transition-all active:scale-95';
        btn.textContent = ch.text;
        btn.onclick = () => {
            const resultText = ch.action(GAME_STATE.player);
            GAME_STATE.totalActions++;

            if (resultText.includes('強化修行に切り替えます')) {
                setupSkillEnhancementTraining();
                return;
            }

            const resultBox = document.getElementById('event-result');
            resultBox.textContent = resultText;
            resultBox.classList.remove('hidden');

            choicesContainer.innerHTML = `
                <button onclick="endEvent()" class="w-full py-4 bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold rounded-xl text-xs shadow-md transition-all">
                    冒険を再開する
                </button>
            `;
        };
        choicesContainer.appendChild(btn);
    });

    changeScreen('screen-event');
}

// ==================== 覚醒イベント ====================
function triggerAwakeningEvent() {
    const p = GAME_STATE.player;

    document.getElementById('event-tag').textContent = '⚡ AWAKENING / 覚醒';
    document.getElementById('event-tag').className = 'text-xs text-yellow-300 tracking-wider font-extrabold animate-pulse';
    document.getElementById('event-title').textContent = '伝説の覚醒…！';
    document.getElementById('event-visual').textContent = '⚡';

    document.getElementById('event-description').textContent =
        '突然、モンスターの全身に謎の光が宿った…！伝説に語られし「覚醒」が今、眼前で起きている！全能力が大幅に強化される！';

    const resultBox = document.getElementById('event-result');
    resultBox.classList.add('hidden');

    const choicesContainer = document.getElementById('event-choices-container');
    choicesContainer.innerHTML = '';

    const btn = document.createElement('button');
    btn.className = 'w-full py-4 bg-gradient-to-r from-yellow-700 to-amber-500 hover:from-yellow-600 hover:to-amber-400 text-slate-900 font-extrabold rounded-xl text-sm shadow-lg transition-all active:scale-95 border border-yellow-300';
    btn.textContent = '✨ 覚醒の力を受け入れる！';
    btn.onclick = () => {
        const boostAmount = 30;
        p.stats.pow     += boostAmount;
        p.stats.int     += boostAmount;
        p.stats.hit     += boostAmount;
        p.stats.spd     += boostAmount;
        p.stats.def     += boostAmount;
        p.stats.maxLife += boostAmount;
        p.stats.life = Math.min(p.stats.maxLife, p.stats.life + boostAmount);

        // 覚醒フラグをON。冒険画面に戻る際、画像が「覚醒モッチー.png」などの覚醒verに変更されます。
        GAME_STATE.isAwakened = true;
        GAME_STATE.totalActions++;

        resultBox.textContent = `✨ 覚醒完了！ちから・かしこさ・命中・回避・丈夫さ・最大ライフがそれぞれ+${boostAmount}アップした！もうモンスターは以前の姿ではない…！`;
        resultBox.classList.remove('hidden');

        choicesContainer.innerHTML = `
            <button onclick="endEvent()" class="w-full py-4 bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold rounded-xl text-sm shadow-md transition-all">
                冒険を再開する
            </button>
        `;
    };
    choicesContainer.appendChild(btn);

    changeScreen('screen-event');
}

// ==================== 強化修行（全技習得済み時） ====================
function setupSkillEnhancementTraining() {
    const p = GAME_STATE.player;
    document.getElementById('event-tag').textContent = 'ENHANCE TRAINING / 強化修行';
    document.getElementById('event-tag').className = 'text-xs text-purple-400 tracking-wider font-bold';
    document.getElementById('event-title').textContent = '強化修行：奥義を磨く';
    document.getElementById('event-visual').textContent = '🔥';
    document.getElementById('event-description').textContent = 
        'すべての技を習得済みのあなたは、さらなる高みを目指し既存の技を磨き上げることができる！強化したい技を1つ選んでください。（ライフ-30）';
    document.getElementById('event-result').classList.add('hidden');

    const choicesContainer = document.getElementById('event-choices-container');
    choicesContainer.innerHTML = '';

    p.skills.forEach(skKey => {
        const sk = SKILLS_DB[skKey];
        if (!sk || sk.type === 'heal' || sk.type.startsWith('buff')) return;

        const enh = GAME_STATE.skillEnhancements[skKey] || { forceBonus: 0, hitBonus: 0, level: 0 };
        const btn = document.createElement('button');
        btn.className = 'w-full py-3 bg-[#2a1058] hover:bg-[#3a1a78] text-white font-bold rounded-xl text-xs shadow-md border border-purple-700 transition-all active:scale-95 flex justify-between items-center px-4';
        const currentForce = (sk.force + enh.forceBonus).toFixed(1);
        const currentHit = sk.hitRate + enh.hitBonus;
        btn.innerHTML = `
            <div class="text-left">
                <span class="text-purple-200 font-bold">${sk.name}</span>
                <span class="text-[9px] text-purple-400 ml-2">Lv.${enh.level}</span>
                <div class="text-[9px] text-gray-400 mt-0.5">威力:${currentForce} / 命中:${currentHit}%</div>
            </div>
            <div class="text-right text-[9px] text-purple-300">
                <div>威力 +0.2</div>
                <div>命中 +3%</div>
            </div>
        `;
        btn.onclick = () => {
            p.stats.life = Math.max(10, p.stats.life - 30);
            if (!GAME_STATE.skillEnhancements[skKey]) {
                GAME_STATE.skillEnhancements[skKey] = { forceBonus: 0, hitBonus: 0, level: 0 };
            }
            GAME_STATE.skillEnhancements[skKey].forceBonus += 0.2;
            GAME_STATE.skillEnhancements[skKey].hitBonus += 3;
            GAME_STATE.skillEnhancements[skKey].level += 1;
            GAME_STATE.totalActions++;

            const newLevel = GAME_STATE.skillEnhancements[skKey].level;
            const resultBox = document.getElementById('event-result');
            resultBox.textContent = `修行成功！【${sk.name}】が Lv.${newLevel} に強化された！威力と命中がアップした！（ライフ-30）`;
            resultBox.classList.remove('hidden');

            choicesContainer.innerHTML = `
                <button onclick="endEvent()" class="w-full py-4 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-xl text-xs shadow-md transition-all">
                    修行を終える
                </button>
            `;
        };
        choicesContainer.appendChild(btn);
    });

    const skipBtn = document.createElement('button');
    skipBtn.className = 'w-full py-2 bg-[#3c2a21] hover:bg-[#4a352a] text-gray-400 font-bold rounded-xl text-[10px] border border-amber-900/40 transition-all active:scale-95 mt-1';
    skipBtn.textContent = '基礎を鍛える修行に留める（ライフ-10）';
    skipBtn.onclick = () => {
        p.stats.life = Math.max(10, p.stats.life - 10);
        const gainP = getDiminishedVal(p.stats.pow, 10);
        const gainH = getDiminishedVal(p.stats.hit, 10);
        p.stats.pow += gainP;
        p.stats.hit += gainH;
        GAME_STATE.totalActions++;

        const resultBox = document.getElementById('event-result');
        resultBox.textContent = `基礎トレーニングを行いました。ちからが+${gainP}、命中が+${gainH}アップした。（ライフ-10）`;
        resultBox.classList.remove('hidden');
        choicesContainer.innerHTML = `
            <button onclick="endEvent()" class="w-full py-4 bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold rounded-xl text-xs shadow-md transition-all">
                冒険を再開する
            </button>
        `;
    };
    choicesContainer.appendChild(skipBtn);

    changeScreen('screen-event');
}

function endEvent() {
    GAME_STATE.floor++;
    GAME_STATE.actionPerformedThisFloor = false; 
    
    if (GAME_STATE.floor > 30) {
        endGame(true);
    } else {
        goToAdventure();
    }
}

// ==================== バトルロジック ====================
function setupBattle(isBoss = false) {
    GAME_STATE.isBattleEnd = false;
    GAME_STATE.battleTurn = 1;
    GAME_STATE.isPlayerTurnActive = true;
    GAME_STATE.usedSkillsThisTurn = {}; 
    GAME_STATE.isDefending = false;
    GAME_STATE.halfRecoveryNextTurn = false;
    GAME_STATE.battleGain = null;
    GAME_STATE.isBossBattle = isBoss;

    // 状態変化関連のフラグ初期化
    GAME_STATE.isGyakujoActive = false;
    GAME_STATE.isSokojikaraFired = false;
    GAME_STATE.isSokojikaraActive = false;
    GAME_STATE.isShuchuActive = false;

    let enemyTemplate;
    if (isBoss) {
        enemyTemplate = BOSS_TEMPLATES[GAME_STATE.floor];
    } else {
        enemyTemplate = { ...ENEMY_TEMPLATES[Math.floor(Math.random() * ENEMY_TEMPLATES.length)] };
    }

    let hpScale = 1.0;
    let statScale = 1.0;

    if (isBoss) {
        if (GAME_STATE.floor === 10) {
            hpScale = 1.9; statScale = 1.7;
        } else if (GAME_STATE.floor === 20) {
            hpScale = 3.3; statScale = 2.7;
        } else if (GAME_STATE.floor === 30) {
            hpScale = 3.0; statScale = 3.0; 
        }
        
        if (GAME_STATE.difficulty === 'hard') {
            hpScale *= 1.12;
            statScale *= 1.15;
        }
    } else {
        let floorFactor = GAME_STATE.floor;
        hpScale = 1.0 + (floorFactor * 0.05) + (Math.pow(floorFactor, 1.4) * 0.015);
        statScale = 1.0 + (floorFactor * 0.04) + (Math.pow(floorFactor, 1.4) * 0.012);

        if (GAME_STATE.difficulty === 'hard') {
            hpScale *= 1.15;    
            statScale *= 1.20;  
        }
    }

    GAME_STATE.enemy = {
        name: enemyTemplate.name + (GAME_STATE.difficulty === 'hard' ? ' (強敵)' : ''),
        emoji: enemyTemplate.emoji,
        type: enemyTemplate.type,
        guts: 50, 
        stats: {
            maxLife: Math.floor(enemyTemplate.maxLife * hpScale),
            life: Math.floor(enemyTemplate.maxLife * hpScale),
            pow: Math.floor(enemyTemplate.pow * statScale),
            int: Math.floor(enemyTemplate.int * statScale),
            hit: Math.floor(enemyTemplate.hit * statScale),
            spd: Math.floor(enemyTemplate.spd * statScale),
            def: Math.floor(enemyTemplate.def * statScale),
            gutsSpeed: 12 
        },
        skills: enemyTemplate.skills
    };

    const floorIndicator = document.getElementById('battle-floor-indicator');
    let battleTitle = isBoss ? `FLOOR ${GAME_STATE.floor} - BOSS BATTLE` : `FLOOR ${GAME_STATE.floor} - WILD BATTLE`;
    if (GAME_STATE.difficulty === 'hard') battleTitle += ' (HARD)';
    floorIndicator.textContent = battleTitle;
    
    document.getElementById('battle-turn-counter').textContent = GAME_STATE.battleTurn;
    document.getElementById('battle-actions-counter').textContent = GAME_STATE.totalActions;
    
    document.getElementById('enemy-name').textContent = GAME_STATE.enemy.name;
    const enemyIconEl = document.getElementById('battle-enemy-icon');
    renderMonsterVisual(enemyIconEl, GAME_STATE.enemy.name, GAME_STATE.enemy.emoji, false);
    document.getElementById('battle-enemy-type').textContent = GAME_STATE.enemy.name;
    
    const playerIconEl = document.getElementById('battle-player-icon');
    renderMonsterVisual(playerIconEl, GAME_STATE.player.name, GAME_STATE.player.emoji, GAME_STATE.isAwakened);
    document.getElementById('battle-player-name').textContent = GAME_STATE.player.name;

    const log = document.getElementById('battle-log');
    log.innerHTML = `<div>${GAME_STATE.enemy.type}の ${GAME_STATE.enemy.name} が現れた！</div>`;

    GAME_STATE.player.guts = 50; 
    updateBattleStatsUI();

    renderBattleSkills();
    changeScreen('screen-battle');

    startPlayerTurn(true); 
}

function startPlayerTurn(isFirstTurn = false) {
    GAME_STATE.isPlayerTurnActive = true;
    GAME_STATE.usedSkillsThisTurn = {}; 
    
    document.getElementById('end-turn-btn').disabled = false;
    document.getElementById('end-turn-btn').classList.remove('opacity-50', 'pointer-events-none');
    document.getElementById('end-turn-defend-btn').disabled = false;
    document.getElementById('end-turn-defend-btn').classList.remove('opacity-50', 'pointer-events-none');

    document.getElementById('player-defense-shield').classList.add('hidden');

    if (!isFirstTurn) {
        let recovery = Math.floor((GAME_STATE.player.stats.gutsSpeed || 15) + 30);
        
        let extraRecoverMsg = "";
        if (GAME_STATE.isGyakujoActive) {
            recovery = Math.floor(recovery * 1.2);
            extraRecoverMsg += " (逆上効果×1.2)";
        }
        if (GAME_STATE.playerStatusEffect === "闘魂" && GAME_STATE.enemy && GAME_STATE.enemy.guts > 70) {
            recovery = Math.floor(recovery * 1.5);
            extraRecoverMsg += " (闘魂効果×1.5)";
        }

        if (GAME_STATE.halfRecoveryNextTurn) {
            recovery = Math.floor(recovery / 2);
            addLog(`--- あなたのターン (防御ペナルティ) ---`);
            addLog(`防御姿勢の反動により、ガッツ回復量が半減した！`);
            GAME_STATE.halfRecoveryNextTurn = false; 
        } else {
            addLog(`--- あなたのターン ---`);
        }

        GAME_STATE.player.guts = Math.min(100, GAME_STATE.player.guts + recovery);
        addLog(`ガッツが ${recovery} 回復した！${extraRecoverMsg} (現在: ${Math.floor(GAME_STATE.player.guts)})`);
        showEffect('🔥 YOUR TURN 🔥');
    } else {
        addLog(`--- あなたのターン (初期GUTS: 50) ---`);
    }

    GAME_STATE.isDefending = false;

    updateBattleStatsUI();
    toggleSkillButtons(true);
}

function toggleSkillButtons(enable) {
    const container = document.getElementById('battle-skills-container');
    const buttons = container.querySelectorAll('button');
    buttons.forEach(btn => {
        if (enable) {
            btn.classList.remove('pointer-events-none');
        } else {
            btn.classList.add('opacity-40', 'pointer-events-none');
        }
    });
}

function updateBattleStatsUI() {
    const p = GAME_STATE.player;
    const e = GAME_STATE.enemy;

    document.getElementById('player-hp-text').textContent = `${p.stats.life}/${p.stats.maxLife}`;
    const pLifePct = (p.stats.life / p.stats.maxLife) * 100;
    document.getElementById('player-hp-bar').style.width = `${pLifePct}%`;

    document.getElementById('enemy-hp-text').textContent = `HP: ${e.stats.life}/${e.stats.maxLife}`;
    const eLifePct = (e.stats.life / e.stats.maxLife) * 100;
    document.getElementById('enemy-hp-bar').style.width = `${eLifePct}%`;

    document.getElementById('enemy-guts-text').textContent = Math.floor(e.guts);
    document.getElementById('enemy-guts-bar').style.width = `${e.guts}%`;

    const gutsVal = Math.floor(p.guts);
    document.getElementById('guts-number').textContent = gutsVal;
    document.getElementById('guts-progress-bar').style.width = `${gutsVal}%`;

    document.getElementById('battle-actions-counter').textContent = GAME_STATE.totalActions;

    p.skills.forEach(skKey => {
        const btn = document.getElementById(`skill-btn-${skKey}`);
        if (btn) {
            const sk = SKILLS_DB[skKey];
            if (!sk) return;
            const isUsedLimit = GAME_STATE.usedSkillsThisTurn[skKey] && skKey === 'charge'; 
            
            if (!GAME_STATE.isPlayerTurnActive || gutsVal < sk.cost || isUsedLimit) {
                btn.classList.add('opacity-40', 'pointer-events-none');
            } else {
                btn.classList.remove('opacity-40', 'pointer-events-none');
            }

            const hitSpan = btn.querySelector('.hit-rate-text');
            if (hitSpan && sk.type !== 'heal' && !sk.type.startsWith('buff')) {
                const enh2 = GAME_STATE.skillEnhancements[skKey];
                const effectiveHit = (enh2 && sk.hitRate < 100) ? Math.min(99, sk.hitRate + enh2.hitBonus) : sk.hitRate;
                if (effectiveHit === 100 || sk.hitRate === 100) {
                    hitSpan.textContent = `命中:必中`;
                } else {
                    const mods = getGutsModifiers(gutsVal);
                    const actualHit = Math.max(10, Math.min(99, (effectiveHit + mods.hitMod) + (p.stats.hit - e.stats.spd) * 0.5));
                    hitSpan.textContent = `命中:${Math.round(actualHit)}%`;
                }
            }
        }
    });

    const recoveryVal = Math.floor((p.stats.gutsSpeed || 15) + 30);
    document.getElementById('turn-guts-notice').textContent = `💡 あなたのガッツ回復力: +${recoveryVal} / ターン`;

    // 状態変化UIの更新
    updateStatusEffectUI();
}

// 状態変化表示のUI制御
function updateStatusEffectUI() {
    const el = document.getElementById('player-status-effect-display');
    if (!el) return;

    const p = GAME_STATE.player;
    if (p && GAME_STATE.playerStatusEffect === "集中" && p.guts > 90 && !GAME_STATE.isShuchuActive) {
        GAME_STATE.isShuchuActive = true;
        addLog(`🎯 集中が発動！次の技の命中率 1.5 倍、ダメージが 1.2 倍に上昇！`);
    }

    let showText = "";

    if (GAME_STATE.isGyakujoActive) {
        showText = "逆上";
    } else if (GAME_STATE.isSokojikaraActive) {
        showText = "底力";
    } else if (GAME_STATE.playerStatusEffect === "闘魂" && GAME_STATE.enemy && GAME_STATE.enemy.guts > 70) {
        showText = "闘魂";
    } else if (GAME_STATE.isShuchuActive) {
        showText = "集中";
    }

    if (showText) {
        el.textContent = showText;
        el.classList.remove('hidden');
    } else {
        if (!el.dataset.temporaryActive) {
            el.classList.add('hidden');
        }
    }
}

// 根性などの一時的な状態変化の点滅表示
function triggerTemporaryStatusEffect(effectName) {
    const el = document.getElementById('player-status-effect-display');
    if (!el) return;
    el.textContent = effectName;
    el.classList.remove('hidden');
    el.dataset.temporaryActive = "true";
    setTimeout(() => {
        delete el.dataset.temporaryActive;
        updateStatusEffectUI();
    }, 2500); // 2.5秒間点滅表示
}

function renderBattleSkills() {
    const container = document.getElementById('battle-skills-container');
    container.innerHTML = '';

    GAME_STATE.player.skills.forEach(skKey => {
        const sk = SKILLS_DB[skKey];
        if (!sk) return;
        const btn = document.createElement('button');
        btn.id = `skill-btn-${skKey}`;
        
        const style = getSkillStyle(sk);
        const rank = getDamageRank(sk.force, sk.type);

        let rankColor = 'text-gray-400';
        if (rank === 'S') rankColor = 'text-red-600 font-extrabold';
        else if (rank === 'A') rankColor = 'text-orange-500 font-bold';
        else if (rank === 'B') rankColor = 'text-yellow-600 font-bold';
        else if (rank === 'C') rankColor = 'text-green-600 font-bold';
        else if (rank === 'D') rankColor = 'text-cyan-600';
        else if (rank === 'E') rankColor = 'text-blue-500';
        else if (rank === 'F') rankColor = 'text-purple-500';

        const enh = GAME_STATE.skillEnhancements[skKey];
        const isEnhanced = enh && enh.level > 0;
        const enhBorderClass = isEnhanced ? 'border-purple-400 shadow-[0_0_6px_2px_rgba(168,85,247,0.4)]' : style.borderClass;
        const enhBgClass = isEnhanced ? 'bg-[#1e0f3a] hover:bg-[#2a1558]' : style.bgClass;

        btn.className = `text-left p-2 rounded border transition-all active:scale-95 flex flex-col justify-between ${enhBgClass} ${enhBorderClass} ${style.textClass}`;
        
        btn.onclick = () => executePlayerSkill(skKey);
        
        let longPressTimer;
        btn.ontouchstart = (e) => {
            longPressTimer = setTimeout(() => {
                openSkillModal(skKey);
            }, 500);
        };
        btn.ontouchend = () => clearTimeout(longPressTimer);
        btn.onmousedown = (e) => {
            if (e.button === 2) {
                openSkillModal(skKey);
            } else {
                longPressTimer = setTimeout(() => {
                    openSkillModal(skKey);
                }, 500);
            }
        };
        btn.onmouseup = () => clearTimeout(longPressTimer);
        btn.oncontextmenu = (e) => e.preventDefault();

        let typeIcon = '💥';
        if (sk.type === 'int') typeIcon = '🔮';
        if (sk.type.startsWith('buff')) typeIcon = '⭐';
        if (sk.type === 'heal') typeIcon = '💖';

        let limitText = '';
        if (skKey === 'charge') {
            limitText = '<span class="limit-tag text-[8px] bg-red-900 text-red-200 px-1 py-0.5 rounded ml-1 font-normal">ターン1回限定</span>';
        }

        const enhBadge = isEnhanced
            ? `<span class="text-[8px] bg-purple-900 text-purple-200 px-1 py-0.5 rounded font-bold ml-1">⚔️Lv.${enh.level}</span>`
            : '';

        const e = GAME_STATE.enemy;
        const mods = getGutsModifiers(GAME_STATE.player.guts);
        const effectiveSk_hit = isEnhanced ? Math.min(99, sk.hitRate + enh.hitBonus) : sk.hitRate;
        let displayHitRate = effectiveSk_hit;
        
        if (effectiveSk_hit === 100 || sk.hitRate === 100) {
            displayHitRate = "必中";
        } else if (e && (sk.type === 'pow' || sk.type === 'int')) {
            const actualHit = Math.max(10, Math.min(99, (effectiveSk_hit + mods.hitMod) + (GAME_STATE.player.stats.hit - e.stats.spd) * 0.5));
            displayHitRate = Math.round(actualHit) + "%";
        } else {
            displayHitRate = displayHitRate + "%";
        }

        const hitRateDisplay = (sk.type === 'heal' || sk.type.startsWith('buff'))
            ? `<span class="text-emerald-700 text-[9px] font-bold">必中</span>`
            : `<span class="${style.textIntensity} text-[9px] font-bold font-mono hit-rate-text">命中:${displayHitRate}</span>`;

        btn.innerHTML = `
            <div class="flex justify-between items-center w-full">
                <span class="font-bold text-xs">${sk.name} ${typeIcon}${enhBadge} <span class="ml-1 text-[10px] ${rankColor} bg-[#1a120b]/10 px-1 py-0.2 rounded">ランク:${rank}</span></span>
                <span class="text-[9px] font-bold">G:${sk.cost}</span>
            </div>
            <div class="flex justify-between items-center mt-0.5 w-full">
                <div class="text-[8px] opacity-85 line-clamp-1 flex-1">GUTS-DOWN:${sk.gutsDown || 0}</div>
                <div class="ml-1 shrink-0">${hitRateDisplay}</div>
            </div>
            <div class="w-full text-right mt-0.5">${limitText}</div>
        `;
        container.appendChild(btn);
    });
}

function executePlayerSkill(skKey) {
    if (GAME_STATE.isBattleEnd || !GAME_STATE.isPlayerTurnActive) return;

    const sk = SKILLS_DB[skKey];
    if (!sk) return;
    const p = GAME_STATE.player;
    const e = GAME_STATE.enemy;

    const enh = GAME_STATE.skillEnhancements[skKey] || { forceBonus: 0, hitBonus: 0 };
    const effectiveSk = { ...sk, force: sk.force + enh.forceBonus, hitRate: sk.hitRate === 100 ? 100 : Math.min(99, sk.hitRate + enh.hitBonus) };

    if (skKey === 'charge' && GAME_STATE.usedSkillsThisTurn['charge']) {
        addLog(`ガッツチャージは1ターンに1回しか使えません！`);
        return;
    }

    if (p.guts < sk.cost) return;

    const mods = getGutsModifiers(p.guts);
    p.guts -= sk.cost;
    
    if (skKey === 'charge') {
        GAME_STATE.usedSkillsThisTurn['charge'] = true;
    }

    GAME_STATE.totalActions++;
    updateBattleStatsUI();

    addLog(`${p.name} の 【${sk.name}】！`);
    animateSprite('battle-player-sprite-container', 'translate-x-6');

    setTimeout(() => {
        if (sk.type === 'pow' || sk.type === 'int') {
            const isCertain = effectiveSk.hitRate === 100;
            let hitChance = isCertain ? 100 : Math.max(10, Math.min(99, (effectiveSk.hitRate + mods.hitMod) + (p.stats.hit - e.stats.spd) * 0.5));
            
            // 集中効果の適用 (命中率1.5倍)
            if (GAME_STATE.isShuchuActive && !isCertain) {
                hitChance = Math.min(99, hitChance * 1.5);
            }

            const isHit = isCertain || (Math.random() * 100 < hitChance);

            if (isHit) {
                const isPow = sk.type === 'pow';
                const attackerStat = isPow ? p.stats.pow : p.stats.int;
                const defenderStat = e.stats.def;
                
                const statCap = Math.max(30, defenderStat * 2.5);
                let effectiveAttacker = attackerStat;
                if (attackerStat > statCap) {
                    effectiveAttacker = statCap + (attackerStat - statCap) * 0.2;
                }

                const defenderGutsDefenseMod = getGutsDefenseModifier(e.guts);
                let rawDmg = ((effectiveAttacker * effectiveSk.force) * mods.dmgMod) - (defenderStat * 0.35);
                let damage = Math.floor(Math.max(10, (rawDmg * (0.9 + Math.random() * 0.2)) * defenderGutsDefenseMod));

                if (isCertain) {
                    addLog(`（必中攻撃！） ターゲットを完璧にロック！`);
                }

                if (e.guts >= 80) {
                    addLog(`🛡️ 相手は高いガッツで身構えている！被ダメージが軽減された。`);
                } else if (e.guts <= 15) {
                    addLog(`💀 相手はガッツが無く無防備だ！大ダメージのチャンス！`);
                }

                // 底力・集中のダメージ補正適用
                let extraDmgMsg = "";
                if (GAME_STATE.isSokojikaraActive) {
                    damage = Math.floor(damage * 1.5);
                    extraDmgMsg += " (底力×1.5)";
                }
                if (GAME_STATE.isShuchuActive) {
                    damage = Math.floor(damage * 1.2);
                    extraDmgMsg += " (集中×1.2)";
                }

                let isCrit = Math.random() < 0.10;
                if (isCrit) {
                    damage = Math.floor(damage * 1.5);
                    addLog(`★クリティカルヒット！ ${e.name} に ${damage} ダメージ！${extraDmgMsg}`);
                } else {
                    addLog(`${e.name} に ${damage} ダメージ！${extraDmgMsg}`);
                }

                e.stats.life = Math.max(0, e.stats.life - damage);
                GAME_STATE.totalDamageDealt += damage;
                
                // 逆上効果の適用 (与ガッツダウン1.2倍)
                let finalGutsDown = sk.gutsDown || 0;
                if (GAME_STATE.isGyakujoActive && finalGutsDown > 0) {
                    finalGutsDown = Math.floor(finalGutsDown * 1.2);
                }

                if (finalGutsDown > 0) {
                    const actualGutsDown = Math.min(e.guts, finalGutsDown);
                    e.guts = Math.max(0, e.guts - actualGutsDown);
                    addLog(`さらに！相手のガッツを ${actualGutsDown} 奪い取った！${GAME_STATE.isGyakujoActive ? " (逆上×1.2)" : ""} (現在: ${Math.floor(e.guts)})`);
                }
                
                showEffect(isCrit ? '💥 CRITICAL!! 💥' : '💥 HIT! 💥');
                showDamagePopup('enemy-dmg-popup', damage, isCrit);
                animateSprite('battle-enemy-sprite-container', 'shake');

            } else {
                addLog('しかし、攻撃はかわされた！');
                showEffect('💨 MISS 💨');
                showDamagePopup('enemy-dmg-popup', 'MISS', false);
            }

            // 攻撃技実行完了後の効果消費
            GAME_STATE.isSokojikaraActive = false;
            GAME_STATE.isShuchuActive = false;

        } else if (sk.type === 'buff_pow') {
            p.stats.pow += 15;
            addLog(`${p.name} の闘志がみなぎる！ちからが15アップした！`);
            showEffect('💪 ちからUP! 💪');
        } else if (sk.type === 'buff_guts') {
            p.guts = Math.min(100, p.guts + 25);
            addLog(`${p.name} は気合を入れ直した！ガッツが25回復！`);
            showEffect('⚡ ガッツチャージ! ⚡');
        } else if (sk.type === 'heal') {
            const healAmount = Math.floor(p.stats.maxLife * 0.35); 
            p.stats.life = Math.min(p.stats.maxLife, p.stats.life + healAmount);
            addLog(`${p.name} は癒された！ライフが ${healAmount} 回復！`);
            showEffect('💚 ライフ回復! 💚');
        }

        updateBattleStatsUI();

        if (e.stats.life <= 0) {
            handleBattleWin();
        }
    }, 300);
}

function endPlayerTurn(defendMode = false) {
    if (GAME_STATE.isBattleEnd || !GAME_STATE.isPlayerTurnActive) return;

    GAME_STATE.isPlayerTurnActive = false;
    
    if (defendMode) {
        GAME_STATE.isDefending = true;
        GAME_STATE.halfRecoveryNextTurn = true;
        document.getElementById('player-defense-shield').classList.remove('hidden');
        addLog(`${GAME_STATE.player.name} は身を守るため防御姿勢をとった！`);
        showEffect('🛡️ DEFENSE 🛡️');
    } else {
        GAME_STATE.isDefending = false;
        GAME_STATE.halfRecoveryNextTurn = false;
    }

    updateBattleStatsUI();
    toggleSkillButtons(false);

    document.getElementById('end-turn-btn').disabled = true;
    document.getElementById('end-turn-btn').classList.add('opacity-50', 'pointer-events-none');
    document.getElementById('end-turn-defend-btn').disabled = true;
    document.getElementById('end-turn-defend-btn').classList.add('opacity-50', 'pointer-events-none');

    setTimeout(() => {
        executeEnemyTurn();
    }, 600);
}

function executeEnemyTurn() {
    if (GAME_STATE.isBattleEnd) return;

    const p = GAME_STATE.player;
    const e = GAME_STATE.enemy;

    addLog(`--- ${e.name} のターン ---`);
    showEffect('⚠️ ENEMY TURN ⚠️');

    const enemyRecovery = Math.floor((e.stats.gutsSpeed || 12) + 20);
    e.guts = Math.min(100, e.guts + enemyRecovery);
    addLog(`${e.name} のガッツが ${enemyRecovery} 回復した！(現在: ${Math.floor(e.guts)})`);
    updateBattleStatsUI();

    setTimeout(() => {
        const affordableSkills = e.skills.map(skKey => {
            return { key: skKey, info: SKILLS_DB[skKey] || SKILLS_DB.boss_bite };
        }).filter(skObj => e.guts >= skObj.info.cost);

        if (affordableSkills.length === 0) {
            addLog(`しかし ${e.name} はガッツが著しく不足しており、何も行動できない！`);
            showEffect('💨 NO ACTION 💨');
        } else {
            affordableSkills.sort((a, b) => b.info.cost - a.info.cost);
            const selected = affordableSkills[0]; 
            const sk = selected.info;

            e.guts -= sk.cost;
            updateBattleStatsUI();

            addLog(`${e.name} の 【${sk.name}】！`);
            animateSprite('battle-enemy-sprite-container', '-translate-x-6');

            setTimeout(() => {
                if (sk.type === 'pow' || sk.type === 'int') {
                    const isCertain = sk.hitRate === 100;
                    const hitChance = isCertain ? 100 : Math.max(10, Math.min(99, sk.hitRate + (e.stats.hit - p.stats.spd) * 0.5));
                    const isHit = isCertain || (Math.random() * 100 < hitChance);

                    if (isHit) {
                        const isPow = sk.type === 'pow';
                        const attackerStat = isPow ? e.stats.pow : e.stats.int;
                        const defenderStat = p.stats.def;

                        const statCap = Math.max(30, defenderStat * 2.5);
                        let effectiveAttacker = attackerStat;
                        if (attackerStat > statCap) {
                            effectiveAttacker = statCap + (attackerStat - statCap) * 0.2;
                        }

                        const playerGutsDefenseMod = getGutsDefenseModifier(p.guts);

                        let rawDmg = (effectiveAttacker * sk.force) - (defenderStat * 0.35);
                        let damage = Math.floor(Math.max(8, (rawDmg * (0.9 + Math.random() * 0.2)) * playerGutsDefenseMod));

                        if (isCertain) {
                            addLog(`（必中技！） ${p.name} はこの技を回避することができない！`);
                        }

                        if (GAME_STATE.isDefending) {
                            damage = Math.floor(damage / 2);
                            addLog(`【防御効果】攻撃を盾で受け流し、ダメージを半減した！`);
                        }

                        p.stats.life = Math.max(0, p.stats.life - damage);
                        addLog(`${p.name} は ${damage} ダメージを受けた！`);

                        // 根性の発動判定
                        if (p.stats.life === 0 && GAME_STATE.playerStatusEffect === "根性") {
                            if (Math.random() < 0.50) {
                                p.stats.life = 1;
                                addLog(`✨ 根性が発動！ ${p.name} は力尽きず、ライフ 1 で耐え抜いた！`);
                                triggerTemporaryStatusEffect("根性");
                            }
                        }

                        // 底力の発動判定 (ライフ3割未満で発動、次の技ダメージ1.5倍)
                        if (GAME_STATE.playerStatusEffect === "底力" && !GAME_STATE.isSokojikaraFired) {
                            if (p.stats.life > 0 && p.stats.life < p.stats.maxLife * 0.3) {
                                GAME_STATE.isSokojikaraFired = true;
                                GAME_STATE.isSokojikaraActive = true;
                                addLog(`💪 底力が発動！窮地に陥ったことで、次の技のダメージが 1.5 倍に上昇！`);
                                updateStatusEffectUI();
                            }
                        }
                        
                        if (sk.gutsDown > 0) {
                            const actualGutsDown = Math.min(p.guts, sk.gutsDown);
                            p.guts = Math.max(0, p.guts - actualGutsDown);
                            addLog(`さらに！ ${p.name} のガッツが ${actualGutsDown} 奪われた！ (現在: ${Math.floor(p.guts)})`);

                            // 逆上の発動判定
                            if (GAME_STATE.playerStatusEffect === "逆上" && !GAME_STATE.isGyakujoActive) {
                                if (Math.random() < 0.65) {
                                    GAME_STATE.isGyakujoActive = true;
                                    addLog(`💢 逆上が発動！ ${p.name} の怒りが頂点に達し、ガッツ回復速度と与えるガッツダウン量が 1.2 倍に上昇！`);
                                    updateStatusEffectUI();
                                }
                            }
                        }

                        showEffect('⚡ 被弾!! ⚡');
                        showDamagePopup('player-dmg-popup', damage, false);
                        animateSprite('battle-player-sprite-container', 'shake');
                    } else {
                        addLog(`しかし ${p.name} は身軽にかわした！`);
                        showEffect('💨 回避!! 💨');
                        showDamagePopup('player-dmg-popup', 'MISS', false);
                    }
                } else if (sk.type === 'buff_pow') {
                    e.stats.pow += 15;
                    addLog(`${e.name} は気合を入れて攻撃力を上げた！`);
                    showEffect('💪 相手の攻撃UP! 💪');
                }

                updateBattleStatsUI();
            }, 300);
        }

        setTimeout(() => {
            if (p.stats.life <= 0) {
                handleBattleLose();
            } else {
                GAME_STATE.battleTurn++;
                document.getElementById('battle-turn-counter').textContent = GAME_STATE.battleTurn;
                startPlayerTurn(false);
            }
        }, 800);

    }, 600);
}

function handleBattleWin() {
    GAME_STATE.isBattleEnd = true;
    addLog(`🎉 勝利！ ${GAME_STATE.enemy.name} を倒した！`);

    const p = GAME_STATE.player;
    const scale = GAME_STATE.difficulty === 'hard' ? 1.5 : 1.0;

    const upPow = Math.floor((Math.random() * 6 + 2) * scale);
    const upInt = Math.floor((Math.random() * 6 + 2) * scale);
    const upSpd = Math.floor((Math.random() * 6 + 2) * scale);
    const upMaxLife = 5;
    const upLifeHeal = 45;

    const prevStats = { ...p.stats };

    const finalUpPow = getDiminishedVal(p.stats.pow, upPow);
    const finalUpInt = getDiminishedVal(p.stats.int, upInt);
    const finalUpSpd = getDiminishedVal(p.stats.spd, upSpd);
    const finalUpMaxLife = getDiminishedVal(p.stats.maxLife, upMaxLife);

    p.stats.pow += finalUpPow;
    p.stats.int += finalUpInt;
    p.stats.spd += finalUpSpd;
    p.stats.maxLife += finalUpMaxLife; 
    p.stats.life = Math.min(p.stats.maxLife, p.stats.life + upLifeHeal); 

    GAME_STATE.battleGain = {
        prev: prevStats,
        next: { ...p.stats },
        diff: {
            maxLife: finalUpMaxLife,
            lifeHeal: upLifeHeal,
            pow: finalUpPow,
            int: finalUpInt,
            spd: finalUpSpd
        }
    };

    let droppedItem = null;
    if (GAME_STATE.isBossBattle && (GAME_STATE.floor === 10 || GAME_STATE.floor === 20)) {
        droppedItem = { ...ITEMS_DB.compass_battle };
        GAME_STATE.items.push(droppedItem);
    } else if (Math.random() < 0.25) {
        const droppableKeys = Object.keys(ITEMS_DB).filter(k => ITEMS_DB[k].type !== 'compass');
        const randomKey = droppableKeys[Math.floor(Math.random() * droppableKeys.length)];
        droppedItem = { ...ITEMS_DB[randomKey] };
        GAME_STATE.items.push(droppedItem);
    }

    setTimeout(() => {
        showBattleResultScreen(droppedItem);
    }, 1800);
}

function showBattleResultScreen(droppedItem) {
    const p = GAME_STATE.player;
    const gain = GAME_STATE.battleGain;

    document.getElementById('battle-result-enemy-desc').textContent = `${GAME_STATE.enemy.name} に勝利しました！`;
    
    const listContainer = document.getElementById('battle-gain-list');
    listContainer.innerHTML = `
        <div class="flex justify-between items-center py-1 text-xs">
            <span class="text-gray-400">最大ライフ:</span>
            <span class="font-bold text-white font-mono">${gain.prev.maxLife} ➔ ${gain.next.maxLife} <span class="text-emerald-400 font-bold ml-1">(+${gain.diff.maxLife})</span></span>
        </div>
        <div class="flex justify-between items-center py-1 text-xs">
            <span class="text-gray-400">現在のライフ:</span>
            <span class="font-bold text-white font-mono">${gain.prev.life} ➔ ${gain.next.life} <span class="text-[#055160] bg-[#cff4fc] px-1.5 py-0.5 rounded text-[10px] ml-1 font-bold">(回復 +${gain.diff.lifeHeal})</span></span>
        </div>
        <div class="flex justify-between items-center py-1 border-t border-amber-900/40 mt-1 pt-2 text-xs">
            <span class="text-gray-400">ちから:</span>
            <span class="font-bold text-white font-mono">${gain.prev.pow} ➔ ${gain.next.pow} <span class="text-amber-400 font-bold ml-1">(+${gain.diff.pow})</span></span>
        </div>
        <div class="flex justify-between items-center py-1 text-xs">
            <span class="text-gray-400">かしこさ:</span>
            <span class="font-bold text-white font-mono">${gain.prev.int} ➔ ${gain.next.int} <span class="text-emerald-400 font-bold ml-1">(+${gain.diff.int})</span></span>
        </div>
        <div class="flex justify-between items-center py-1 text-xs">
            <span class="text-gray-400">回避:</span>
            <span class="font-bold text-white font-mono">${gain.prev.spd} ➔ ${gain.next.spd} <span class="text-cyan-400 font-bold ml-1">(+${gain.diff.spd})</span></span>
        </div>
    `;

    const dropDisplay = document.getElementById('battle-item-drop-display');
    if (droppedItem) {
        dropDisplay.classList.remove('hidden');
        document.getElementById('dropped-item-icon').textContent = droppedItem.icon;
        document.getElementById('dropped-item-name').textContent = droppedItem.name;
        document.getElementById('dropped-item-desc').textContent = droppedItem.desc;
    } else {
        dropDisplay.classList.add('hidden');
    }

    changeScreen('screen-battle-result');
}

// 状態変化付与強制イベント画面のセットアップ
function setupStatusEffectEvent() {
    document.getElementById('event-tag').textContent = '🔮 FORCE EVENT / 潜在能力覚醒';
    document.getElementById('event-tag').className = 'text-xs text-red-500 tracking-wider font-extrabold animate-pulse';
    document.getElementById('event-title').textContent = '状態変化の目覚め';
    document.getElementById('event-visual').textContent = '🔮';
    document.getElementById('event-description').textContent = 
        '中ボス【ゴビ】を打ち破ったことで、モンスターの奥底に眠る潜在能力が共鳴している…！モンスターにランダムな【状態変化】が宿ります。';
    document.getElementById('event-result').classList.add('hidden');

    const choicesContainer = document.getElementById('event-choices-container');
    choicesContainer.innerHTML = '';

    const btn = document.createElement('button');
    btn.className = 'w-full py-4 bg-gradient-to-r from-red-800 to-amber-600 hover:from-red-700 hover:to-amber-500 text-white font-extrabold rounded-xl text-sm shadow-lg transition-all active:scale-95 border border-red-500';
    btn.textContent = '✨ 秘められた能力を開花させる！';
    btn.onclick = () => {
        const effects = ["根性", "逆上", "底力", "闘魂", "集中"];
        const chosen = effects[Math.floor(Math.random() * effects.length)];
        GAME_STATE.playerStatusEffect = chosen;

        let desc = "";
        if (chosen === "根性") desc = "根性：相手から攻撃を受けてライフが0になった場合、50%の確率でライフ1で復活します。";
        else if (chosen === "逆上") desc = "逆上：相手からガッツダウンを受けた時に65%の確率で発動、自身のターン開始時のガッツ回復量1.2倍、与えるガッツダウン量1.2倍";
        else if (chosen === "底力") desc = "底力：自身のライフが最大ライフの3割を切った時に発動。発動後の1回目の技のダメージ量1.5倍";
        else if (chosen === "闘魂") desc = "闘魂：相手のガッツが70を超えた時に発動。自身のターン開始時のガッツ回復量1.5倍";
        else if (chosen === "集中") desc = "集中：自身のガッツが90を超えた時に発動。発動後の1回目の技の命中率1.5倍＋ダメージ量1.2倍";

        const resultBox = document.getElementById('event-result');
        resultBox.innerHTML = `<span class="text-red-500 text-base font-black">【${chosen}】</span>の能力が目覚めた！<br><span class="text-xs text-gray-300 font-normal block mt-2">${desc}</span>`;
        resultBox.classList.remove('hidden');

        choicesContainer.innerHTML = `
            <button onclick="endStatusEffectEvent()" class="w-full py-4 bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold rounded-xl text-xs shadow-md transition-all">
                冒険を再開する (11階へ)
            </button>
        `;
    };
    choicesContainer.appendChild(btn);

    changeScreen('screen-event');
}

function endStatusEffectEvent() {
    goToAdventure();
}

function confirmBattleResult() {
    if (GAME_STATE.floor === 10 && GAME_STATE.isBossBattle) {
        GAME_STATE.floor++;
        GAME_STATE.isBossBattle = false;
        GAME_STATE.actionPerformedThisFloor = false;
        setupStatusEffectEvent();
    } else {
        GAME_STATE.floor++;
        GAME_STATE.actionPerformedThisFloor = false; 

        if (GAME_STATE.floor > 30) {
            endGame(true);
        } else {
            goToAdventure();
        }
    }
}

// ゲームオーバー時のヒント生成
function getGameOverHint() {
    const floor = GAME_STATE.floor;
    const p = GAME_STATE.player;
    
    // ボス戦での敗北
    if (GAME_STATE.isBossBattle) {
        if (floor === 10) {
            return "中ボス『ゴビ』は『ちから』が極めて高く、一撃が致命傷になります。しかし『命中』と『回避』が低いため、トレーニングで『回避』を鍛えて攻撃をかわすか、『丈夫さ』を高めて被ダメージを抑えましょう。また、ガッツダウン技で相手のガッツを削れば、大技『ローリング激突』の頻度を下げられます。";
        }
        if (floor === 20) {
            return "中ボス『デュラハン』は非常に『丈夫さ』が高く、中途半端な攻撃力ではダメージが通りません。トレーニングで『ちから』や『かしこさ』をしっかり高めて挑みましょう。また、相手は『きあい』で攻撃力を高めてくるため、敵の攻撃ターンは『防御して終了』を使ってダメージを軽減するのが極めて有効です。";
        }
        if (floor === 30) {
            return "伝説の邪神『モスト』は、回避不能の必中技『なめる』や、壊滅的ダメージを与える『メテオバースト』を放ちます。相手のガッツが溜まると手がつけられなくなるため、ガッツダウン効果の高い技（モッシーの『もっさま』、スエゾーの『歌う』など）を主軸にし、相手のガッツを常に低く保ちながら戦うのが勝利の鍵です。";
        }
    }
    
    // 道中での敗北
    // ライフが極端に低い場合
    if (p && p.stats.maxLife < 220) {
        return "最大ライフが低いため、敵のクリティカルや連続攻撃で力尽きやすくなっています。序盤は『走り込み』や『ライフパン』を優先し、最大ライフを220〜250程度まで引き上げることで、生存率が劇的に向上します。";
    }
    
    // ガッツ補正に関する一般的なアドバイス
    const rand = Math.random();
    if (rand < 0.5) {
        return "【ガッツ補正の重要性】本作では自身のガッツ量に応じて『与ダメージ（最大1.5倍）』と『命中率（最大+15%）』がアップします。逆にガッツが少ない状態で攻撃すると、与えるダメージが半減し、受けるダメージが1.5倍に跳ね上がります。焦って技を連発せず、ガッツを70〜90程度まで溜めてから一気に強力な技を叩き込むのが基本戦術です。";
    } else {
        return "【ボスの攻撃パターンと防御】ボスモンスターはガッツが溜まると消費ガッツの大きい大技を優先して使ってきます。敵のガッツが溜まっている状態の時は、無理に攻撃せず『防御して終了』を選択しましょう。受けるダメージが半減し、次のターンを安全に迎えることができます。";
    }
}

function endGame(isClear) {
    const p = GAME_STATE.player;
    const resTitle = document.getElementById('result-title');
    const resSubtitle = document.getElementById('result-subtitle');
    const resBadge = document.getElementById('result-badge');
    const rankText = document.getElementById('result-rank-text');
    const rankDesc = document.getElementById('result-rank-desc');
    const heritageSection = document.getElementById('heritage-section');
    const hintBox = document.getElementById('gameover-hint-box');
    const hintText = document.getElementById('gameover-hint-text');

    const totalDmg = GAME_STATE.totalDamageDealt;
    const totalAct = Math.max(1, GAME_STATE.totalActions);
    const multiplier = totalDmg / totalAct;
    const baseScore = Math.floor(totalDmg * multiplier);
    const clearBonus = isClear ? 1.5 : 1.0; 
    const finalScore = Math.floor(baseScore * clearBonus);

    document.getElementById('result-difficulty').textContent = GAME_STATE.difficulty.toUpperCase();
    document.getElementById('result-final-floor').textContent = `${GAME_STATE.floor - (isClear ? 1 : 0)} / 30`;
    document.getElementById('result-total-actions').textContent = totalAct;
    document.getElementById('result-total-damage').textContent = totalDmg.toLocaleString();
    document.getElementById('result-multiplier').textContent = `×${multiplier.toFixed(1)}`;
    document.getElementById('result-final-score').textContent = finalScore.toLocaleString();

    const clearBonusEl = document.getElementById('result-clear-bonus');
    if (clearBonusEl) {
        if (isClear) {
            clearBonusEl.textContent = '🏆 クリアボーナス ×1.5';
            clearBonusEl.classList.remove('hidden');
        } else {
            clearBonusEl.classList.add('hidden');
        }
    }

    if (isClear) {
        resTitle.textContent = "CONGRATULATIONS!";
        resTitle.className = "text-2xl font-black text-amber-500 pixel-font";
        resSubtitle.textContent = "ブリーダーとして、30階層の栄光を掴み取りました！";
        resBadge.textContent = "🏆";

        if (finalScore >= 80000) {
            rankText.textContent = "👑 神の領域のレジェンドブリーダー";
            rankDesc.textContent = "圧倒的な与ダメージ効率！運と戦術、すべてを極めた神 of 化身です。";
        } else if (finalScore >= 30000) {
            rankText.textContent = "🥇 天才ブリーダー";
            rankDesc.textContent = "無駄のない素晴らしいトレーニングと的確な戦術でモンスターを導きました。";
        } else if (finalScore >= 10000) {
            rankText.textContent = "🥈 一流ブリーダー";
            rankDesc.textContent = "モンスターとの強い絆で見事完走！次はさらなる高みを目指しましょう。";
        } else {
            rankText.textContent = "🥉 熟練ブリーダー";
            rankDesc.textContent = "クリアおめでとう！攻撃技を積極的に使うとスコアが伸びます。";
        }

        if (hintBox) hintBox.classList.add('hidden');

        let template = MONSTER_TEMPLATES.mochi; 
        if (p.emoji === '👁️') template = MONSTER_TEMPLATES.suezo;
        if (p.emoji === '🦖') template = MONSTER_TEMPLATES.dino;

        let defaultSkills = [];
        if (template.id === 'mochi') defaultSkills = ['monta', 'mochiki', 'sakurafubuki'];
        if (template.id === 'suezo') defaultSkills = ['shippobinta', 'nameru', 'kamitsuki'];
        if (template.id === 'dino') defaultSkills = ['shippo', 'kamitsuki_dino', 'sunakake'];

        const additionalSkills = p.skills.filter(s => !defaultSkills.includes(s));

        if (additionalSkills.length > 0) {
            heritageSection.classList.remove('hidden');
            const hList = document.getElementById('heritage-skills-list');
            hList.innerHTML = '';
            additionalSkills.forEach(skKey => {
                const sk = SKILLS_DB[skKey];
                if (!sk) return;
                const btn = document.createElement('button');
                btn.className = "p-2 bg-cyan-950 hover:bg-cyan-900 border border-cyan-700 text-cyan-200 text-[11px] font-bold rounded-xl transition-all text-center";
                btn.textContent = `【${sk.name}】を継承`;
                btn.onclick = () => {
                    saveInheritedSkill(skKey);
                    showToast(`秘技【${sk.name}】を次回のプレイに引き継ぎました！`);
                    restartGame();
                };
                hList.appendChild(btn);
            });
        } else {
            heritageSection.classList.add('hidden');
        }

    } else {
        resTitle.textContent = "GAME OVER";
        resTitle.className = "text-2xl font-black text-red-500 pixel-font";
        resSubtitle.textContent = `第 ${GAME_STATE.floor} 階層にて、モンスターが倒れてしまいました…`;
        resBadge.textContent = "💀";

        if (finalScore >= 30000) {
            rankText.textContent = "🥇 惜しかった天才ブリーダー";
            rankDesc.textContent = "与ダメ効率は抜群！あとはもう少しの粘りで栄光が見えていた。";
        } else if (finalScore >= 10000) {
            rankText.textContent = "🥈 奮闘した一流ブリーダー";
            rankDesc.textContent = "よく戦いました。育成と休養のバランスをもう一度見直してみましょう。";
        } else {
            rankText.textContent = "新米ブリーダー";
            rankDesc.textContent = "育成と休養のバランス、バトルでのガッツ管理をもう一度見直してみましょう。";
        }

        if (hintBox && hintText) {
            hintText.textContent = getGameOverHint();
            hintBox.classList.remove('hidden');
        }

        heritageSection.classList.add('hidden');
    }

    submitScore(GAME_STATE.playerName, p.name, finalScore, GAME_STATE.difficulty, GAME_STATE.floor - (isClear ? 1 : 0), isClear);

    changeScreen('screen-result');
}

function endStatusEffectEvent() {
    goToAdventure();
}

function confirmBattleResult() {
    if (GAME_STATE.floor === 10 && GAME_STATE.isBossBattle) {
        GAME_STATE.floor++;
        GAME_STATE.isBossBattle = false;
        GAME_STATE.actionPerformedThisFloor = false;
        setupStatusEffectEvent();
    } else {
        GAME_STATE.floor++;
        GAME_STATE.actionPerformedThisFloor = false; 

        if (GAME_STATE.floor > 30) {
            endGame(true);
        } else {
            goToAdventure();
        }
    }
}

function handleBattleLose() {
    GAME_STATE.isBattleEnd = true;
    addLog(`💀 敗北… ${GAME_STATE.player.name} は力尽きた…`);

    setTimeout(() => {
        endGame(false);
    }, 2000);
}

function endGame(isClear) {
    const p = GAME_STATE.player;
    const resTitle = document.getElementById('result-title');
    const resSubtitle = document.getElementById('result-subtitle');
    const resBadge = document.getElementById('result-badge');
    const rankText = document.getElementById('result-rank-text');
    const rankDesc = document.getElementById('result-rank-desc');
    const heritageSection = document.getElementById('heritage-section');

    const totalDmg = GAME_STATE.totalDamageDealt;
    const totalAct = Math.max(1, GAME_STATE.totalActions);
    const multiplier = totalDmg / totalAct;
    const baseScore = Math.floor(totalDmg * multiplier);
    const clearBonus = isClear ? 1.5 : 1.0; 
    const finalScore = Math.floor(baseScore * clearBonus);

    document.getElementById('result-difficulty').textContent = GAME_STATE.difficulty.toUpperCase();
    document.getElementById('result-final-floor').textContent = `${GAME_STATE.floor - (isClear ? 1 : 0)} / 30`;
    document.getElementById('result-total-actions').textContent = totalAct;
    document.getElementById('result-total-damage').textContent = totalDmg.toLocaleString();
    document.getElementById('result-multiplier').textContent = `×${multiplier.toFixed(1)}`;
    document.getElementById('result-final-score').textContent = finalScore.toLocaleString();

    const clearBonusEl = document.getElementById('result-clear-bonus');
    if (clearBonusEl) {
        if (isClear) {
            clearBonusEl.textContent = '🏆 クリアボーナス ×1.5';
            clearBonusEl.classList.remove('hidden');
        } else {
            clearBonusEl.classList.add('hidden');
        }
    }

    if (isClear) {
        resTitle.textContent = "CONGRATULATIONS!";
        resTitle.className = "text-2xl font-black text-amber-500 pixel-font";
        resSubtitle.textContent = "ブリーダーとして、30階層の栄光を掴み取りました！";
        resBadge.textContent = "🏆";

        if (finalScore >= 80000) {
            rankText.textContent = "👑 神の領域のレジェンドブリーダー";
            rankDesc.textContent = "圧倒的な与ダメージ効率！運と戦術、すべてを極めた神の化身です。";
        } else if (finalScore >= 30000) {
            rankText.textContent = "🥇 天才ブリーダー";
            rankDesc.textContent = "無駄のない素晴らしいトレーニングと的確な戦術でモンスターを導きました。";
        } else if (finalScore >= 10000) {
            rankText.textContent = "🥈 一流ブリーダー";
            rankDesc.textContent = "モンスターとの強い絆で見事完走！次はさらなる高みを目指しましょう。";
        } else {
            rankText.textContent = "🥉 熟練ブリーダー";
            rankDesc.textContent = "クリアおめでとう！攻撃技を積極的に使うとスコアが伸びます。";
        }

        let template = MONSTER_TEMPLATES.mochi; 
        if (p.emoji === '👁️') template = MONSTER_TEMPLATES.suezo;
        if (p.emoji === '🦖') template = MONSTER_TEMPLATES.dino;

        let defaultSkills = [];
        if (template.id === 'mochi') defaultSkills = ['monta', 'mochiki', 'sakurafubuki'];
        if (template.id === 'suezo') defaultSkills = ['shippobinta', 'nameru', 'kamitsuki'];
        if (template.id === 'dino') defaultSkills = ['shippo', 'kamitsuki_dino', 'sunakake'];

        const additionalSkills = p.skills.filter(s => !defaultSkills.includes(s));

        if (additionalSkills.length > 0) {
            heritageSection.classList.remove('hidden');
            const hList = document.getElementById('heritage-skills-list');
            hList.innerHTML = '';
            additionalSkills.forEach(skKey => {
                const sk = SKILLS_DB[skKey];
                if (!sk) return;
                const btn = document.createElement('button');
                btn.className = "p-2 bg-cyan-950 hover:bg-cyan-900 border border-cyan-700 text-cyan-200 text-[11px] font-bold rounded-xl transition-all text-center";
                btn.textContent = `【${sk.name}】を継承`;
                btn.onclick = () => {
                    saveInheritedSkill(skKey);
                    showToast(`秘技【${sk.name}】を次回のプレイに引き継ぎました！`);
                    restartGame();
                };
                hList.appendChild(btn);
            });
        } else {
            heritageSection.classList.add('hidden');
        }

    } else {
        resTitle.textContent = "GAME OVER";
        resTitle.className = "text-2xl font-black text-red-500 pixel-font";
        resSubtitle.textContent = `第 ${GAME_STATE.floor} 階層にて、モンスターが倒れてしまいました…`;
        resBadge.textContent = "💀";

        if (finalScore >= 30000) {
            rankText.textContent = "🥇 惜しかった天才ブリーダー";
            rankDesc.textContent = "与ダメ効率は抜群！あとはもう少しの粘りで栄光が見えていた。";
        } else if (finalScore >= 10000) {
            rankText.textContent = "🥈 奮闘した一流ブリーダー";
            rankDesc.textContent = "よく戦いました。育成と休養のバランスをもう一度見直してみましょう。";
        } else {
            rankText.textContent = "新米ブリーダー";
            rankDesc.textContent = "育成と休養のバランス、バトルでのガッツ管理をもう一度見直してみましょう。";
        }
        heritageSection.classList.add('hidden');
    }

    submitScore(GAME_STATE.playerName, p.name, finalScore, GAME_STATE.difficulty, GAME_STATE.floor - (isClear ? 1 : 0), isClear);

    changeScreen('screen-result');
}

function restartGame() {
    changeScreen('screen-title');
}

// =====================================================
// Firebase 設定 & ランキング機能
// =====================================================
const firebaseConfig = {
    apiKey: "AIzaSyDtOE8k_ul09KKWRH0AqUBkc86OYeFS3ls",
    authDomain: "mfload2525.firebaseapp.com",
    databaseURL: "https://mfload2525-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "mfload2525",
    storageBucket: "mfload2525.firebasestorage.app",
    messagingSenderId: "829047750322",
    appId: "1:829047750322:web:336b112f4d841e619d93ab"
};

let firebaseDb = null;

function initFirebase() {
    try {
        if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
        }
        firebaseDb = firebase.database();
        return true;
    } catch (e) {
        console.error('[Firebase]', e);
        return false;
    }
}

async function submitScore(playerName, monsterName, score, difficulty, floor, isClear) {
    if (!initFirebase()) return;
    try {
        const entry = {
            playerName: playerName,
            monster: monsterName,
            score: score,
            floor: floor,
            clear: isClear,
            damage: GAME_STATE.totalDamageDealt,
            actions: GAME_STATE.totalActions,
            ts: Date.now()
        };
        // モンスター毎に別パスへ保存（モンスター毎に最大10件管理）
        const path = `rankings/${difficulty}`;
        await firebaseDb.ref(path).push(entry);

        // モンスター毎にデータ件数を制限（各モンスター最大10件）
        const snap = await firebaseDb.ref(path).once('value');
        const byMonster = {};
        snap.forEach(child => {
            const val = child.val();
            if (!val || typeof val.score !== 'number') return;
            const mName = val.monster || 'unknown';
            if (!byMonster[mName]) byMonster[mName] = [];
            byMonster[mName].push({ key: child.key, score: val.score });
        });
        // モンスター毎に最大10件を超えた古いデータを削除
        for (const mName of Object.keys(byMonster)) {
            const list = byMonster[mName];
            if (list.length > 10) {
                list.sort((a, b) => a.score - b.score);
                const toDelete = list.slice(0, list.length - 10);
                for (const item of toDelete) {
                    await firebaseDb.ref(`${path}/${item.key}`).remove();
                }
            }
        }
    } catch (e) {
        console.error('[Firebase] スコア登録エラー:', e);
    }
}

let currentRankingTab = 'normal';
let currentMonsterFilter = 'all';

function showRanking() {
    currentMonsterFilter = 'all';
    changeScreen('screen-ranking');
    switchRankingTab('normal');
    // モンスタータブの初期状態をリセット
    switchMonsterTab('all');
}

function switchRankingTab(difficulty) {
    currentRankingTab = difficulty;
    const normalBtn = document.getElementById('rank-tab-normal');
    const hardBtn = document.getElementById('rank-tab-hard');
    if (difficulty === 'normal') {
        normalBtn.className = 'flex-1 py-2 text-xs font-bold rounded-lg border transition-all bg-emerald-900 border-emerald-600 text-emerald-300';
        hardBtn.className = 'flex-1 py-2 text-xs font-bold rounded-lg border transition-all bg-[#2a1b15] border-amber-900 text-gray-400';
    } else {
        hardBtn.className = 'flex-1 py-2 text-xs font-bold rounded-lg border transition-all bg-red-900 border-red-600 text-red-300';
        normalBtn.className = 'flex-1 py-2 text-xs font-bold rounded-lg border transition-all bg-[#2a1b15] border-amber-900 text-gray-400';
    }
    loadRanking(difficulty, currentMonsterFilter);
}

// モンスター別フィルタタブの切り替え
function switchMonsterTab(monsterName) {
    currentMonsterFilter = monsterName;

    // タブのID→モンスター名マッピング
    const tabs = {
        'all':    { id: 'rank-tab-all',   active: 'bg-amber-700 border-amber-500 text-white',           inactive: 'bg-[#2a1b15] border-amber-900 text-gray-400' },
        'モッチー': { id: 'rank-tab-mochi', active: 'bg-amber-800 border-amber-500 text-amber-200',        inactive: 'bg-[#2a1b15] border-amber-900 text-gray-400' },
        'スエゾー': { id: 'rank-tab-suezo', active: 'bg-cyan-900 border-cyan-500 text-cyan-200',           inactive: 'bg-[#2a1b15] border-amber-900 text-gray-400' },
        'ディノ':   { id: 'rank-tab-dino',  active: 'bg-emerald-900 border-emerald-500 text-emerald-200',  inactive: 'bg-[#2a1b15] border-amber-900 text-gray-400' },
    };

    const baseClass = 'flex-1 py-1.5 text-[10px] font-bold rounded-lg border transition-all flex items-center justify-center ';
    for (const [key, tab] of Object.entries(tabs)) {
        const btn = document.getElementById(tab.id);
        if (!btn) continue;
        btn.className = baseClass + (key === monsterName ? tab.active : tab.inactive);
    }

    loadRanking(currentRankingTab, monsterName);
}

async function loadRanking(difficulty, monsterFilter = 'all') {
    const container = document.getElementById('ranking-list-container');
    container.innerHTML = '<div class="text-center text-gray-500 text-xs py-8">読み込み中...</div>';

    if (!initFirebase()) {
        container.innerHTML = '<div class="text-center text-gray-500 text-xs py-8 leading-relaxed">Firebase未設定のため<br>ランキングを表示できません。<br><span class="text-amber-700">firebaseConfigを設定してください。</span></div>';
        return;
    }

    try {
        const snap = await firebaseDb.ref(`rankings/${difficulty}`).once('value');
        const entries = [];
        snap.forEach(function(child) {
            const val = child.val();
            if (val && typeof val.score === 'number') {
                entries.push(val);
            }
        });

        // モンスターでフィルタリング
        const filtered = (monsterFilter === 'all')
            ? entries
            : entries.filter(e => e.monster === monsterFilter);

        filtered.sort((a, b) => b.score - a.score);
        const top10 = filtered.slice(0, 10);

        const filterLabel = monsterFilter === 'all' ? 'すべて' : monsterFilter;
        if (top10.length === 0) {
            container.innerHTML = `<div class="text-center text-gray-500 text-xs py-8">【${filterLabel}】の記録はまだありません。<br>最初のブリーダーになろう！</div>`;
            return;
        }

        const rankIcons = ['\u{1F947}', '\u{1F948}', '\u{1F949}'];

        // モンスター名→絵文字のフォールバックマップ
        const monsterEmojiMap = { 'モッチー': '🍪', 'スエゾー': '👁️', 'ディノ': '🦖' };

        const rows = top10.map(function(entry, i) {
            const rankIcon = rankIcons[i] !== undefined ? rankIcons[i] : ((i + 1) + '位');
            const clearBadge = entry.clear
                ? '<span class="text-[9px] bg-amber-700 text-amber-200 px-1.5 py-0.5 rounded font-bold ml-1">CLEAR</span>'
                : '<span class="text-[9px] bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded font-bold ml-1">' + entry.floor + 'F</span>';
            const mult = entry.actions > 0 ? (entry.damage / entry.actions).toFixed(1) : '0.0';
            const d = new Date(entry.ts);
            const dateStr = (d.getMonth() + 1) + '/' + d.getDate();
            const displayName = entry.playerName ? entry.playerName : 'ブリーダー';
            const scoreStr = entry.score.toLocaleString();
            const damageStr = (entry.damage || 0).toLocaleString();

            // モンスターアイコン: PNG画像を試みて失敗時は絵文字でフォールバック
            const mName = entry.monster || '';
            const mEmoji = monsterEmojiMap[mName] || '🐾';
            const monsterIcon = '<img src="images/' + mName + '.png"'
                + ' alt="' + mName + '"'
                + ' class="w-8 h-8 object-contain flex-shrink-0 rounded-full bg-[#1a120b] border border-amber-900/40 p-0.5"'
                + ' onerror="this.outerHTML=\'<span class=&quot;text-xl w-8 h-8 flex items-center justify-center flex-shrink-0&quot;>' + mEmoji + '</span>\'"'
                + '>';

            return '<div class="bg-[#2a1b15] border border-amber-900/50 rounded-xl p-2.5 flex items-center space-x-2">'
                + '<div class="text-lg w-8 text-center flex-shrink-0">' + rankIcon + '</div>'
                + monsterIcon
                + '<div class="flex-1 min-w-0">'
                + '<div class="flex items-center">'
                + '<span class="text-xs font-bold text-amber-300 truncate">' + displayName + '</span>'
                + clearBadge
                + '</div>'
                + '<div class="text-[9px] text-gray-300 font-bold truncate">' + mName + '</div>'
                + '<div class="text-[9px] text-gray-400 mt-0.5">ダメ:' + damageStr + ' / 行動:' + (entry.actions || 0) + ' / 倍率:×' + mult + '</div>'
                + '</div>'
                + '<div class="text-right flex-shrink-0">'
                + '<div class="text-sm font-black text-amber-400 pixel-font">' + scoreStr + '</div>'
                + '<div class="text-[8px] text-gray-500">' + dateStr + '</div>'
                + '</div>'
                + '</div>';
        });

        container.innerHTML = rows.join('');
    } catch (err) {
        console.error('[Firebase] ランキング取得エラー:', err);
        container.innerHTML = '<div class="text-center text-red-400 text-xs py-8">取得に失敗しました。<br><span class="text-[9px] text-gray-500">' + err.message + '</span></div>';
    }
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
