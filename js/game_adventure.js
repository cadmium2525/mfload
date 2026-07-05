// =====================================================
// game_adventure.js
// ダンジョン探索パート：
//   ・フロア移動、コンパス選択
//   ・トレーニング（軽/重）、休養、バッグ（アイテム使用）
//   ・ランダムイベント、特訓（新技習得/技強化）、覚醒イベント
//   ・状態変化付与イベント
// game_core.js の GAME_STATE / 各種UIヘルパーに依存する。
// =====================================================

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
        else if (p.emoji === '🗿') candidates = ['monotaore', 'warawara', 'sakebigoe', 'cho_monotaore', 'aurora_gate', 'sanren_attack', 'trio_beam_z'];
        
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

