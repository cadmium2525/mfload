// =====================================================
// マスモンバトル（対人マスモンデータを用いたCPU対戦）機能
// フェーズ3: 個人戦（1vs1）＋ 団体戦（3vs3）＋ 対戦アイテム3種 対応
//
// バトル仕様はリアルタイム対戦（masmon_realtime_battle.js）と統一している：
//   ・1回の行動（技 or 防御 or アイテム）で即座に相手のターンへ移る
//     （育成中バトルのような「攻撃終了」「防御して終了」ボタンは無し）
//   ・防御は技一覧の中の1コマンドとして選択する
//     （被ダメージ軽減のみ。ガッツ回復量の減少ペナルティは無い）
// =====================================================

// 現在アクティブなバトルの種別を管理 ('adventure' | 'masmon')
// screen-battle の攻撃終了/防御して終了ボタンはこのフラグを見て処理を振り分ける
let ACTIVE_BATTLE_MODE = 'adventure';

// マイマスモンを使用してのバトル（CPU対戦・リアルタイム対戦共通）は
// 通常の育成バトルよりダメージを大幅に抑える（通常の1/5）
const MASMON_BATTLE_DAMAGE_MULTIPLIER = 1 / 5;

// --- 対戦アイテムデータベース ---
const MASMON_ITEM_DB = {
    mango: { name: 'カララギマンゴー', emoji: '🥭', desc: 'ライフを少し回復する（最大ライフの25%）' },
    kuri: { name: 'クーリ栗', emoji: '🌰', desc: 'クリティカル率が上昇する（+25%・3ターン持続）' },
    toro: { name: 'トロカチン', emoji: '🧪', desc: 'ちから・かしこさが上昇するが、代償として最大ライフの30%のダメージを受ける' }
};

const MASMON_BATTLE_STATE = {
    mode: null,            // 'cpu_solo' | 'cpu_team'
    playerTeam: [],        // バトル用ユニット配列（soloは1体、teamは最大3体）
    enemyTeam: [],
    playerActiveIdx: 0,
    enemyActiveIdx: 0,
    playerMeta: [],        // 表示用：自分が使用したマスモンの登録情報（playerTeamと同じ並び）
    enemyMeta: [],         // 表示用：対戦相手のマスモンの登録情報
    playerItems: { mango: 0, kuri: 0, toro: 0 },
    enemyItems: { mango: 0, kuri: 0, toro: 0 },
    isBattleEnd: false,
    isPlayerTurnActive: true,
    turn: 1,
    isDefending: false,
    usedSkillsThisTurn: {},
    battleResult: null,     // 'win' | 'lose'
    opponentOwnerName: '',
    playerItemsInitial: { mango: 0, kuri: 0, toro: 0 } // 持ち込み時点の初期所持数（UI表示用）
};

// --- 現在アクティブなユニットの取得 ---
function getPlayerActive() { return MASMON_BATTLE_STATE.playerTeam[MASMON_BATTLE_STATE.playerActiveIdx]; }
function getEnemyActive() { return MASMON_BATTLE_STATE.enemyTeam[MASMON_BATTLE_STATE.enemyActiveIdx]; }

// --- マスモン登録データをバトル用ユニットに変換 ---
function convertMasmonToBattleUnit(masmonData) {
    return {
        name: masmonData.name,
        monsterBaseName: masmonData.monsterBaseName || masmonData.name,
        emoji: masmonData.emoji,
        isAwakened: !!masmonData.isAwakened,
        guts: 50,
        critBonusTurns: 0,
        statusEffect: masmonData.statusEffect || null,   // 育成中に得た状態変化（根性/逆上/底力/闘魂/集中）
        isGyakujoActive: false,
        isSokojikaraFired: false,
        isSokojikaraActive: false,
        isShuchuActive: false,
        weakenTurns: 0,   // わらわら等で受ける「ちから・かしこさ低下」の残ターン
        confuseTurns: 0,  // サケビ声等で受ける「混乱」の残行動回数
        forceBoost: 0,    // オーロラゲート等で得る「次の技威力アップ」倍率
        shieldValue: 0,   // 九重神眼等で得るシールド（被ダメージ吸収）の残量
        dodgeNextGuaranteed: false, // 陽炎等で得る「次の敵攻撃を確実に回避」フラグ
        stats: {
            maxLife: masmonData.stats.maxLife,
            life: masmonData.stats.maxLife,
            pow: masmonData.stats.pow,
            int: masmonData.stats.int,
            hit: masmonData.stats.hit,
            spd: masmonData.stats.spd,
            def: masmonData.stats.def,
            gutsSpeed: masmonData.stats.gutsSpeed || 14
        },
        skills: [...(masmonData.skills || [])],
        skillEnhancements: JSON.parse(JSON.stringify(masmonData.skillEnhancements || {})) // 技の強化データ { skKey: { forceBonus, hitBonus, level } }
    };
}

// --- 技の強化データを反映した実効ステータス（force/hitRate）を取得 ---
function getMasmonEffectiveSkill(unit, skKey) {
    const sk = SKILLS_DB[skKey];
    if (!sk) return null;
    const enh = (unit.skillEnhancements && unit.skillEnhancements[skKey]) || { forceBonus: 0, hitBonus: 0 };
    return {
        ...sk,
        force: sk.force + (enh.forceBonus || 0),
        hitRate: sk.hitRate === 100 ? 100 : Math.min(99, sk.hitRate + (enh.hitBonus || 0))
    };
}

// --- 他ユーザーのマスモンをランダムに1体取得（個人戦用） ---
async function fetchRandomOpponentMasmon() {
    if (!initFirebase()) return null;
    const myId = getMyPlayerId();

    const ownersSnap = await firebaseDb.ref('masmon_owners').once('value');
    const ownerIds = [];
    ownersSnap.forEach(child => {
        if (child.key !== myId) ownerIds.push(child.key);
    });

    if (ownerIds.length === 0) return null;

    // ランダムな順番でオーナーを走査し、マスモンを保有している相手を探す
    const shuffled = ownerIds.sort(() => Math.random() - 0.5);
    for (const ownerId of shuffled) {
        const snap = await firebaseDb.ref(`masmons/${ownerId}`).once('value');
        const list = [];
        snap.forEach(child => list.push({ key: child.key, ...child.val() }));
        if (list.length > 0) {
            return list[Math.floor(Math.random() * list.length)];
        }
    }
    return null;
}

// --- 他ユーザーのマスモンチーム（最大3体）をランダムに取得（団体戦用） ---
async function fetchRandomOpponentTeam() {
    if (!initFirebase()) return null;
    const myId = getMyPlayerId();

    const ownersSnap = await firebaseDb.ref('masmon_owners').once('value');
    const ownerIds = [];
    ownersSnap.forEach(child => {
        if (child.key !== myId) ownerIds.push(child.key);
    });

    if (ownerIds.length === 0) return null;

    const shuffled = ownerIds.sort(() => Math.random() - 0.5);
    for (const ownerId of shuffled) {
        const snap = await firebaseDb.ref(`masmons/${ownerId}`).once('value');
        const list = [];
        snap.forEach(child => list.push({ key: child.key, ...child.val() }));
        if (list.length > 0) {
            const shuffledList = list.sort(() => Math.random() - 0.5);
            return shuffledList.slice(0, 3);
        }
    }
    return null;
}

// -----------------------------------------------------
// アイテム持ち込み数からカウントオブジェクトを作成
// itemLoadout: ['mango','mango','kuri'] のような配列（最大3つ、'none'は無視）
// -----------------------------------------------------
function buildItemCounts(itemLoadout) {
    const counts = { mango: 0, kuri: 0, toro: 0 };
    (itemLoadout || []).forEach(key => {
        if (counts.hasOwnProperty(key)) counts[key]++;
    });
    return counts;
}

// --- 敵CPU用のランダムなアイテム所持数を生成（各0〜1個、フェアな範囲） ---
function buildRandomEnemyItemCounts() {
    const counts = { mango: 0, kuri: 0, toro: 0 };
    Object.keys(counts).forEach(key => {
        if (Math.random() < 0.6) counts[key] = 1;
    });
    return counts;
}

// -----------------------------------------------------
// CPU対戦（個人戦）開始
// -----------------------------------------------------
async function startMasmonCpuBattle(myMasmon, itemLoadout = []) {
    showToast('対戦相手を探しています...');

    if (!initFirebase()) {
        showToast('Firebase未設定のため対戦できません。');
        return;
    }

    let enemyMasmon;
    try {
        enemyMasmon = await fetchRandomOpponentMasmon();
    } catch (e) {
        console.error('[Firebase] 対戦相手取得エラー:', e);
        showToast('対戦相手の取得に失敗しました。');
        return;
    }

    if (!enemyMasmon) {
        showToast('まだ他のブリーダーのマスモンが登録されていません…');
        return;
    }

    MASMON_BATTLE_STATE.mode = 'cpu_solo';
    MASMON_BATTLE_STATE.playerTeam = [convertMasmonToBattleUnit(myMasmon)];
    MASMON_BATTLE_STATE.enemyTeam = [convertMasmonToBattleUnit(enemyMasmon)];
    MASMON_BATTLE_STATE.playerMeta = [myMasmon];
    MASMON_BATTLE_STATE.enemyMeta = [enemyMasmon];
    MASMON_BATTLE_STATE.playerActiveIdx = 0;
    MASMON_BATTLE_STATE.enemyActiveIdx = 0;
    MASMON_BATTLE_STATE.playerItems = buildItemCounts(itemLoadout);
    MASMON_BATTLE_STATE.playerItemsInitial = { ...MASMON_BATTLE_STATE.playerItems };
    MASMON_BATTLE_STATE.enemyItems = buildRandomEnemyItemCounts();
    MASMON_BATTLE_STATE.opponentOwnerName = enemyMasmon.ownerName || '相手ブリーダー';

    const floorText = `⚔️ マスモンCPU対戦：${myMasmon.ownerName || 'あなた'} vs ${enemyMasmon.ownerName || '相手ブリーダー'}`;
    startMasmonBattleCommon(floorText);
}

// -----------------------------------------------------
// CPU対戦（団体戦・3vs3）開始
// -----------------------------------------------------
async function startMasmonCpuTeamBattle(myMasmons, itemLoadout = []) {
    showToast('対戦相手チームを探しています...');

    if (!initFirebase()) {
        showToast('Firebase未設定のため対戦できません。');
        return;
    }

    let enemyMasmons;
    try {
        enemyMasmons = await fetchRandomOpponentTeam();
    } catch (e) {
        console.error('[Firebase] 対戦相手チーム取得エラー:', e);
        showToast('対戦相手チームの取得に失敗しました。');
        return;
    }

    if (!enemyMasmons || enemyMasmons.length === 0) {
        showToast('まだ他のブリーダーのマスモンが登録されていません…');
        return;
    }

    MASMON_BATTLE_STATE.mode = 'cpu_team';
    MASMON_BATTLE_STATE.playerTeam = myMasmons.map(convertMasmonToBattleUnit);
    MASMON_BATTLE_STATE.enemyTeam = enemyMasmons.map(convertMasmonToBattleUnit);
    MASMON_BATTLE_STATE.playerMeta = [...myMasmons];
    MASMON_BATTLE_STATE.enemyMeta = [...enemyMasmons];
    MASMON_BATTLE_STATE.playerActiveIdx = 0;
    MASMON_BATTLE_STATE.enemyActiveIdx = 0;
    MASMON_BATTLE_STATE.playerItems = buildItemCounts(itemLoadout);
    MASMON_BATTLE_STATE.playerItemsInitial = { ...MASMON_BATTLE_STATE.playerItems };
    MASMON_BATTLE_STATE.enemyItems = buildRandomEnemyItemCounts();
    MASMON_BATTLE_STATE.opponentOwnerName = enemyMasmons[0].ownerName || '相手ブリーダー';

    const floorText = `🛡️⚔️🛡️ 団体戦（${myMasmons.length}vs${enemyMasmons.length}）：${myMasmons[0].ownerName || 'あなた'} vs ${MASMON_BATTLE_STATE.opponentOwnerName}`;
    startMasmonBattleCommon(floorText);
}

// --- 個人戦・団体戦共通の初期化処理 ---
function startMasmonBattleCommon(floorText) {
    MASMON_BATTLE_STATE.isBattleEnd = false;
    MASMON_BATTLE_STATE.turn = 1;
    MASMON_BATTLE_STATE.isDefending = false;
    MASMON_BATTLE_STATE.usedSkillsThisTurn = {};
    MASMON_BATTLE_STATE.battleResult = null;

    ACTIVE_BATTLE_MODE = 'masmon';

    // PvP（リアルタイム対戦）と同じ操作仕様にするため、育成中バトル用の
    // 「攻撃終了」「防御して終了」ボタンは非表示にする（防御は技一覧に統合）
    document.getElementById('battle-endturn-controls').classList.add('hidden');

    document.getElementById('battle-floor-indicator').textContent = floorText;
    document.getElementById('battle-turn-counter').textContent = MASMON_BATTLE_STATE.turn;
    document.getElementById('battle-actions-counter').textContent = 0;

    const isTeam = MASMON_BATTLE_STATE.mode === 'cpu_team';
    document.getElementById('player-team-icons').classList.toggle('hidden', !isTeam);
    document.getElementById('enemy-team-icons').classList.toggle('hidden', !isTeam);
    renderTeamIcons();

    const p = getPlayerActive();
    const e = getEnemyActive();
    const enemyOwner = MASMON_BATTLE_STATE.enemyMeta[MASMON_BATTLE_STATE.enemyActiveIdx].ownerName || '相手ブリーダー';

    document.getElementById('enemy-name').textContent = `${e.name}（${enemyOwner}）`;
    renderMonsterVisual(document.getElementById('battle-enemy-icon'), e.monsterBaseName, e.emoji, e.isAwakened);
    document.getElementById('battle-enemy-type').textContent = e.name;

    renderMonsterVisual(document.getElementById('battle-player-icon'), p.monsterBaseName, p.emoji, p.isAwakened);
    document.getElementById('battle-player-name').textContent = p.name;

    const log = document.getElementById('battle-log');
    log.innerHTML = `<div>${enemyOwner}の【${e.name}】が立ちはだかった！</div>`;
    if (isTeam) {
        log.innerHTML += `<div class="text-indigo-300">団体戦スタート！お互い${MASMON_BATTLE_STATE.playerTeam.length}体 vs ${MASMON_BATTLE_STATE.enemyTeam.length}体で戦う！</div>`;
    }

    updateMasmonBattleStatsUI();
    renderMasmonBattleSkills();
    renderBattleItems();
    changeScreen('screen-battle');

    startMasmonPlayerTurn(true);
}

// -----------------------------------------------------
// 団体戦：チームアイコン表示
// -----------------------------------------------------
function renderTeamIcons() {
    if (MASMON_BATTLE_STATE.mode !== 'cpu_team') return;

    const renderSide = (containerId, team, activeIdx) => {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = '';
        team.forEach((unit, idx) => {
            const isFainted = unit.stats.life <= 0;
            const isActive = idx === activeIdx;
            const icon = document.createElement('div');
            icon.className = `w-8 h-8 flex items-center justify-center rounded-full text-base border-2 transition-all overflow-hidden ${
                isFainted ? 'grayscale opacity-30 border-gray-700 bg-black/40' :
                isActive ? 'border-amber-400 bg-amber-950/60 scale-110' : 'border-gray-600 bg-[#1a120b]'
            }`;
            if (isFainted) {
                icon.textContent = '💀';
            } else {
                renderMonsterVisual(icon, unit.monsterBaseName, unit.emoji, unit.isAwakened);
            }
            icon.title = unit.name;
            container.appendChild(icon);
        });
    };

    renderSide('player-team-icons', MASMON_BATTLE_STATE.playerTeam, MASMON_BATTLE_STATE.playerActiveIdx);
    renderSide('enemy-team-icons', MASMON_BATTLE_STATE.enemyTeam, MASMON_BATTLE_STATE.enemyActiveIdx);
}

// -----------------------------------------------------
// 戦闘不能判定＆チーム交代処理
// side: 'player' | 'enemy'
// 戻り値: true の場合はバトル終了（呼び出し元は以降の処理を中断すること）
// -----------------------------------------------------
function checkFaintAndProceed(side) {
    const team = side === 'player' ? MASMON_BATTLE_STATE.playerTeam : MASMON_BATTLE_STATE.enemyTeam;
    const idx = side === 'player' ? MASMON_BATTLE_STATE.playerActiveIdx : MASMON_BATTLE_STATE.enemyActiveIdx;
    const unit = team[idx];

    if (unit.stats.life > 0) return false;

    addLog(`💥 ${unit.name} は戦闘不能になった！`);

    const nextIdx = team.findIndex(u => u.stats.life > 0);

    if (nextIdx === -1) {
        // チーム全滅 → バトル終了
        if (side === 'player') {
            handleMasmonBattleLose();
        } else {
            handleMasmonBattleWin();
        }
        return true;
    }

    // 次のマスモンを繰り出す
    if (side === 'player') {
        MASMON_BATTLE_STATE.playerActiveIdx = nextIdx;
    } else {
        MASMON_BATTLE_STATE.enemyActiveIdx = nextIdx;
    }
    MASMON_BATTLE_STATE.isDefending = false;

    const newUnit = team[nextIdx];
    const sideLabel = side === 'player' ? 'あなた' : (MASMON_BATTLE_STATE.opponentOwnerName || '相手');
    addLog(`${sideLabel}は【${newUnit.name}】を繰り出した！`);

    if (side === 'player') {
        renderMonsterVisual(document.getElementById('battle-player-icon'), newUnit.monsterBaseName, newUnit.emoji, newUnit.isAwakened);
        document.getElementById('battle-player-name').textContent = newUnit.name;
        renderMasmonBattleSkills();
    } else {
        const enemyOwner = MASMON_BATTLE_STATE.enemyMeta[nextIdx].ownerName || '相手ブリーダー';
        document.getElementById('enemy-name').textContent = `${newUnit.name}（${enemyOwner}）`;
        renderMonsterVisual(document.getElementById('battle-enemy-icon'), newUnit.monsterBaseName, newUnit.emoji, newUnit.isAwakened);
        document.getElementById('battle-enemy-type').textContent = newUnit.name;
    }

    renderTeamIcons();
    updateMasmonBattleStatsUI();
    return false;
}

// -----------------------------------------------------
// バトル進行
// -----------------------------------------------------
function startMasmonPlayerTurn(isFirstTurn = false) {
    MASMON_BATTLE_STATE.isPlayerTurnActive = true;
    MASMON_BATTLE_STATE.usedSkillsThisTurn = {};

    document.getElementById('player-defense-shield').classList.add('hidden');

    const p = getPlayerActive();

    if (p.critBonusTurns > 0) {
        p.critBonusTurns--;
        if (p.critBonusTurns === 0) addLog(`${p.name} のクリティカル率上昇効果が切れた。`);
    }

    if (!isFirstTurn) {
        const e = getEnemyActive();
        let recovery = Math.floor((p.stats.gutsSpeed || 14) + 30);
        if (p.isGyakujoActive) {
            recovery = Math.floor(recovery * 1.2);
        }
        if (p.statusEffect === "闘魂" && e && e.guts > 70) {
            recovery = Math.floor(recovery * 1.5);
        }
        addLog(`--- あなたのターン ---`);
        p.guts = Math.min(100, p.guts + recovery);
        addLog(`ガッツが ${recovery} 回復した！(現在: ${Math.floor(p.guts)})`);
        showEffect('🔥 YOUR TURN 🔥');
    } else {
        addLog(`--- あなたのターン (初期GUTS: 50) ---`);
    }

    MASMON_BATTLE_STATE.isDefending = false;
    updateMasmonBattleStatsUI();

    // 混乱状態（サケビ声などで付与）の残ターン消化と行動失敗判定
    const confusionResult = tickStatusTurnsAndCheckConfusion(p);
    if (confusionResult.confused) {
        addLog(`❓ ${p.name} は混乱していて、行動できなかった！`);
        showEffect('❓ 混乱... ❓');
        MASMON_BATTLE_STATE.isPlayerTurnActive = false;
        toggleMasmonSkillButtons(false);
        setTimeout(() => {
            executeMasmonEnemyTurn();
        }, 1000);
        return;
    }

    toggleMasmonSkillButtons(true);
    renderBattleItems();
}

function toggleMasmonSkillButtons(enable) {
    const container = document.getElementById('battle-skills-container');
    container.querySelectorAll('button').forEach(btn => {
        if (enable) {
            btn.classList.remove('pointer-events-none');
        } else {
            btn.classList.add('opacity-40', 'pointer-events-none');
        }
    });
    const itemContainer = document.getElementById('battle-items-container');
    itemContainer.querySelectorAll('button').forEach(btn => {
        if (enable) {
            if (!btn.dataset.depleted) btn.classList.remove('pointer-events-none');
        } else {
            btn.classList.add('opacity-40', 'pointer-events-none');
        }
    });
}

function checkAndActivateShuchu(unit) {
    if (unit && unit.statusEffect === "集中" && unit.guts > 90 && !unit.isShuchuActive) {
        unit.isShuchuActive = true;
        addLog(`🎯 ${unit.name} に集中が発動！次の技の命中率 1.5 倍、ダメージが 1.2 倍に上昇！`);
    }
}

// --- ダメージを受けた側の「根性」「底力」発動判定 ---
function checkMasmonDefenseStatusTriggers(defender) {
    const isPlayerSide = defender === getPlayerActive();
    if (defender.stats.life === 0 && defender.statusEffect === "根性") {
        if (Math.random() < 0.50) {
            defender.stats.life = 1;
            addLog(`✨ 根性が発動！ ${defender.name} は力尽きず、ライフ 1 で耐え抜いた！`);
            if (isPlayerSide) triggerMasmonTemporaryStatusEffect("根性");
        }
    }
    if (defender.statusEffect === "底力" && !defender.isSokojikaraFired) {
        if (defender.stats.life > 0 && defender.stats.life < defender.stats.maxLife * 0.3) {
            defender.isSokojikaraFired = true;
            defender.isSokojikaraActive = true;
            addLog(`💪 底力が発動！窮地に陥ったことで、次の技のダメージが 1.5 倍に上昇！`);
            if (isPlayerSide) updateMasmonStatusEffectUI();
        }
    }
}

// --- ガッツを奪われた側の「逆上」発動判定 ---
function checkMasmonGyakujoTrigger(defender) {
    if (defender.statusEffect === "逆上" && !defender.isGyakujoActive) {
        if (Math.random() < 0.65) {
            defender.isGyakujoActive = true;
            addLog(`💢 逆上が発動！ ${defender.name} の怒りが頂点に達し、ガッツ回復速度と与えるガッツダウン量が 1.2 倍に上昇！`);
            if (defender === getPlayerActive()) updateMasmonStatusEffectUI();
        }
    }
}

// -----------------------------------------------------
// 状態変化表示UI（育成中のバトルと同じ見た目・仕様で表示する）
// -----------------------------------------------------
function updateMasmonStatusEffectUI() {
    const el = document.getElementById('player-status-effect-display');
    if (!el) return;

    const p = getPlayerActive();
    const e = getEnemyActive();
    if (!p) return;

    let showText = "";
    if (p.isGyakujoActive) {
        showText = "逆上";
    } else if (p.isSokojikaraActive) {
        showText = "底力";
    } else if (p.statusEffect === "闘魂" && e && e.guts > 70) {
        showText = "闘魂";
    } else if (p.isShuchuActive) {
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

// 根性などの一時的な状態変化の点滅表示（育成中のバトルと同じ演出）
function triggerMasmonTemporaryStatusEffect(effectName) {
    const el = document.getElementById('player-status-effect-display');
    if (!el) return;
    el.textContent = effectName;
    el.classList.remove('hidden');
    el.dataset.temporaryActive = "true";
    setTimeout(() => {
        delete el.dataset.temporaryActive;
        updateMasmonStatusEffectUI();
    }, 2500);
}

function updateMasmonBattleStatsUI() {
    const p = getPlayerActive();
    const e = getEnemyActive();

    checkAndActivateShuchu(p);
    checkAndActivateShuchu(e);

    document.getElementById('player-hp-text').textContent = `${p.stats.life}/${p.stats.maxLife}`;
    document.getElementById('player-hp-bar').style.width = `${(p.stats.life / p.stats.maxLife) * 100}%`;

    document.getElementById('enemy-hp-text').textContent = `HP: ${e.stats.life}/${e.stats.maxLife}`;
    document.getElementById('enemy-hp-bar').style.width = `${(e.stats.life / e.stats.maxLife) * 100}%`;

    document.getElementById('enemy-guts-text').textContent = Math.floor(e.guts);
    document.getElementById('enemy-guts-bar').style.width = `${e.guts}%`;

    const gutsVal = Math.floor(p.guts);
    document.getElementById('guts-number').textContent = gutsVal;
    document.getElementById('guts-progress-bar').style.width = `${gutsVal}%`;

    p.skills.forEach(skKey => {
        const btn = document.getElementById(`skill-btn-${skKey}`);
        if (!btn) return;
        const sk = SKILLS_DB[skKey];
        if (!sk) return;
        if (!MASMON_BATTLE_STATE.isPlayerTurnActive || gutsVal < sk.cost) {
            btn.classList.add('opacity-40', 'pointer-events-none');
        } else {
            btn.classList.remove('opacity-40', 'pointer-events-none');
        }
        const hitSpan = btn.querySelector('.hit-rate-text');
        if (hitSpan && sk.type !== 'heal' && !sk.type.startsWith('buff')) {
            const effSk = getMasmonEffectiveSkill(p, skKey);
            if (effSk.hitRate === 100) {
                hitSpan.textContent = `命中:必中`;
            } else {
                const mods = getGutsModifiers(gutsVal);
                let actualHit = Math.max(10, Math.min(99, (effSk.hitRate + mods.hitMod) + (p.stats.hit - e.stats.spd) * 0.5));
                if (p.isShuchuActive) actualHit = Math.min(99, actualHit * 1.5);
                hitSpan.textContent = `命中:${Math.round(actualHit)}%`;
            }
        }
    });

    const recoveryVal = Math.floor((p.stats.gutsSpeed || 14) + 30);
    document.getElementById('turn-guts-notice').textContent = `💡 あなたのガッツ回復力: +${recoveryVal} / ターン`;

    updateMasmonStatusEffectUI();

    renderTeamIcons();
}

function renderMasmonBattleSkills() {
    const container = document.getElementById('battle-skills-container');
    container.innerHTML = '';

    const p = getPlayerActive();
    p.skills.forEach(skKey => {
        const sk = getMasmonEffectiveSkill(p, skKey);
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

        // 技強化状態の判定（マスモン登録時に保存された強化データを反映。育成中のバトルと同じ表記にする）
        const enh = p.skillEnhancements && p.skillEnhancements[skKey];
        const isEnhanced = enh && enh.level > 0;
        const enhBorderClass = isEnhanced ? 'border-purple-400 shadow-[0_0_6px_2px_rgba(168,85,247,0.4)]' : style.borderClass;
        const enhBgClass = isEnhanced ? 'bg-[#1e0f3a] hover:bg-[#2a1558]' : style.bgClass;

        btn.className = `text-left p-2 rounded border transition-all active:scale-95 flex flex-col justify-between ${enhBgClass} ${enhBorderClass} ${style.textClass}`;
        btn.onclick = () => executeMasmonPlayerSkill(skKey);

        // 技の長押し／右クリックで詳細モーダルを表示（育成中のバトルと同じ操作）
        let longPressTimer;
        btn.ontouchstart = () => {
            longPressTimer = setTimeout(() => {
                openMasmonSkillModal(skKey);
            }, 500);
        };
        btn.ontouchend = () => clearTimeout(longPressTimer);
        btn.onmousedown = (ev) => {
            if (ev.button === 2) {
                openMasmonSkillModal(skKey);
            } else {
                longPressTimer = setTimeout(() => {
                    openMasmonSkillModal(skKey);
                }, 500);
            }
        };
        btn.onmouseup = () => clearTimeout(longPressTimer);
        btn.oncontextmenu = (ev) => ev.preventDefault();

        let typeIcon = '💥';
        if (sk.type === 'int') typeIcon = '🔮';
        if (sk.type.startsWith('buff')) typeIcon = '⭐';
        if (sk.type === 'heal') typeIcon = '💖';

        const enhBadge = isEnhanced
            ? `<span class="text-[8px] bg-purple-900 text-purple-200 px-1 py-0.5 rounded font-bold ml-1">⚔️Lv.${enh.level}</span>`
            : '';

        const hitRateDisplay = (sk.type === 'heal' || sk.type.startsWith('buff'))
            ? `<span class="text-emerald-700 text-[9px] font-bold">必中</span>`
            : `<span class="${style.textIntensity} text-[9px] font-bold font-mono hit-rate-text">命中:${sk.hitRate}%</span>`;

        btn.innerHTML = `
            <div class="flex justify-between items-center w-full">
                <span class="font-bold text-xs">${sk.name} ${typeIcon}${enhBadge} <span class="ml-1 text-[10px] ${rankColor} bg-[#1a120b]/10 px-1 py-0.2 rounded">ランク:${rank}</span></span>
                <span class="text-[9px] font-bold">G:${sk.cost}</span>
            </div>
            <div class="flex justify-between items-center mt-0.5 w-full">
                <div class="text-[8px] opacity-85 line-clamp-1 flex-1">GUTS-DOWN:${sk.gutsDown || 0}</div>
                <div class="ml-1 shrink-0">${hitRateDisplay}</div>
            </div>
        `;
        container.appendChild(btn);
    });

    // --- 防御コマンド（技一覧に統合。被ダメ軽減のみ、ガッツ回復量の減は無し＝PvP仕様） ---
    const defendBtn = document.createElement('button');
    defendBtn.className = `text-left p-2 rounded border transition-all active:scale-95 flex flex-col justify-between bg-blue-950/40 border-blue-700 text-blue-200`;
    defendBtn.onclick = () => executeMasmonDefend();
    defendBtn.innerHTML = `
        <div class="flex justify-between items-center w-full">
            <span class="font-bold text-xs">🛡️ 防御 <span class="ml-1 text-[10px] text-blue-300 bg-[#1a120b]/10 px-1 py-0.2 rounded">被ダメ半減</span></span>
            <span class="text-[9px] font-bold">G:0</span>
        </div>
        <div class="flex justify-between items-center mt-0.5 w-full">
            <div class="text-[8px] opacity-85 line-clamp-1 flex-1">次の相手の攻撃ダメージを半減（ガッツ回復ペナルティ無し）</div>
        </div>
    `;
    container.appendChild(defendBtn);

    // --- 交代コマンド（団体戦のみ。ライフが残っている控えのマスモンと入れ替える。1ターン消費） ---
    const switchCandidates = getMasmonSwitchCandidates();
    if (switchCandidates.length > 0) {
        const switchBtn = document.createElement('button');
        switchBtn.className = `text-left p-2 rounded border transition-all active:scale-95 flex flex-col justify-between bg-emerald-950/40 border-emerald-700 text-emerald-200`;
        switchBtn.onclick = () => openMasmonSwitchMenu();
        switchBtn.innerHTML = `
            <div class="flex justify-between items-center w-full">
                <span class="font-bold text-xs">🔄 交代 <span class="ml-1 text-[10px] text-emerald-300 bg-[#1a120b]/10 px-1 py-0.2 rounded">1ターン消費</span></span>
                <span class="text-[9px] font-bold">G:0</span>
            </div>
            <div class="flex justify-between items-center mt-0.5 w-full">
                <div class="text-[8px] opacity-85 line-clamp-1 flex-1">控えのマスモンと交代する（ライフが残っている仲間のみ）</div>
            </div>
        `;
        container.appendChild(switchBtn);
    }
}

// --- 交代候補（団体戦・現在の場に出ていない、ライフが残っている控えのマスモン）の取得 ---
function getMasmonSwitchCandidates() {
    if (MASMON_BATTLE_STATE.mode !== 'cpu_team') return [];
    return MASMON_BATTLE_STATE.playerTeam
        .map((unit, idx) => ({ idx, unit }))
        .filter(({ idx, unit }) => idx !== MASMON_BATTLE_STATE.playerActiveIdx && unit.stats.life > 0);
}

// --- 交代先選択メニューを技一覧エリアに一時的に表示する ---
function openMasmonSwitchMenu() {
    if (MASMON_BATTLE_STATE.isBattleEnd || !MASMON_BATTLE_STATE.isPlayerTurnActive) return;
    const candidates = getMasmonSwitchCandidates();
    if (candidates.length === 0) return;

    const container = document.getElementById('battle-skills-container');
    container.innerHTML = '';

    candidates.forEach(({ idx, unit }) => {
        const lifePct = Math.max(0, Math.floor((unit.stats.life / unit.stats.maxLife) * 100));
        const btn = document.createElement('button');
        btn.className = `text-left p-2 rounded border transition-all active:scale-95 flex flex-col justify-between bg-emerald-950/40 border-emerald-700 text-emerald-200`;
        btn.onclick = () => executeMasmonSwitch(idx);
        btn.innerHTML = `
            <div class="flex justify-between items-center w-full">
                <span class="font-bold text-xs">${unit.name}</span>
                <span class="text-[9px] font-bold">HP ${unit.stats.life}/${unit.stats.maxLife} (${lifePct}%)</span>
            </div>
        `;
        container.appendChild(btn);
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.className = `text-left p-2 rounded border transition-all active:scale-95 flex items-center justify-center bg-[#1a120b] border-gray-600 text-gray-300 col-span-2`;
    cancelBtn.onclick = () => renderMasmonBattleSkills();
    cancelBtn.innerHTML = `<span class="font-bold text-xs">↩️ もどる</span>`;
    container.appendChild(cancelBtn);
}

// --- 交代実行（1ターン消費。ライフが残っている控えのマスモンと入れ替えて相手ターンへ移る） ---
function executeMasmonSwitch(targetIdx) {
    if (MASMON_BATTLE_STATE.isBattleEnd || !MASMON_BATTLE_STATE.isPlayerTurnActive) return;
    const team = MASMON_BATTLE_STATE.playerTeam;
    const target = team[targetIdx];
    if (!target || target.stats.life <= 0 || targetIdx === MASMON_BATTLE_STATE.playerActiveIdx) return;

    const prev = getPlayerActive();
    MASMON_BATTLE_STATE.playerActiveIdx = targetIdx;
    MASMON_BATTLE_STATE.isDefending = false;

    addLog(`${prev.name} を引っ込め、【${target.name}】を繰り出した！`);
    showEffect('🔄 交代！ 🔄');

    renderMonsterVisual(document.getElementById('battle-player-icon'), target.monsterBaseName, target.emoji, target.isAwakened);
    document.getElementById('battle-player-name').textContent = target.name;
    renderTeamIcons();
    updateMasmonBattleStatsUI();
    renderMasmonBattleSkills();

    proceedToMasmonEnemyTurn();
}

// -----------------------------------------------------
// 技詳細モーダル（マスモンバトル用：育成中のバトルと同じ見た目のモーダルを、
// マスモンバトルの現在のユニット／強化データに合わせて表示する）
// -----------------------------------------------------
function openMasmonSkillModal(skKey) {
    const p = getPlayerActive();
    const e = getEnemyActive();
    if (!p) return;
    const sk = getMasmonEffectiveSkill(p, skKey);
    if (!sk) return;

    const currentGuts = Math.floor(p.guts);
    const mods = getGutsModifiers(currentGuts);

    document.getElementById('modal-skill-name').textContent = sk.name;
    document.getElementById('modal-skill-cost').textContent = sk.cost;
    document.getElementById('modal-skill-rank').textContent = getDamageRank(sk.force, sk.type);
    document.getElementById('modal-skill-gutsdown').textContent = sk.gutsDown || 0;
    document.getElementById('modal-skill-desc').textContent = sk.desc || "説明はありません。";
    document.getElementById('modal-current-guts').textContent = currentGuts;

    if (sk.type === 'heal' || sk.type.startsWith('buff')) {
        document.getElementById('modal-guts-dmg-scale').textContent = "なし (補助)";
        document.getElementById('modal-guts-hit-rate').textContent = "必中";
    } else {
        document.getElementById('modal-guts-dmg-scale').textContent = mods.dmgMod.toFixed(2) + "倍";

        if (sk.hitRate === 100) {
            document.getElementById('modal-guts-hit-rate').textContent = "必中 🎯";
        } else if (e) {
            let actualHit = Math.max(10, Math.min(99, (sk.hitRate + mods.hitMod) + (p.stats.hit - e.stats.spd) * 0.5));
            if (p.isShuchuActive) actualHit = Math.min(99, actualHit * 1.5);
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

// -----------------------------------------------------
// 対戦アイテムバー表示
// -----------------------------------------------------
function renderBattleItems() {
    const container = document.getElementById('battle-items-container');
    const counts = MASMON_BATTLE_STATE.playerItems || { mango: 0, kuri: 0, toro: 0 };
    const initial = MASMON_BATTLE_STATE.playerItemsInitial || { mango: 0, kuri: 0, toro: 0 };
    const broughtKeys = Object.keys(MASMON_ITEM_DB).filter(key => (initial[key] || 0) > 0);

    container.innerHTML = '';
    container.classList.toggle('hidden', broughtKeys.length === 0);
    if (broughtKeys.length === 0) return;

    broughtKeys.forEach(key => {
        const item = MASMON_ITEM_DB[key];
        const remaining = counts[key] || 0;
        const btn = document.createElement('button');
        btn.className = 'p-1.5 rounded border text-[9px] font-bold flex flex-col items-center bg-emerald-950/40 border-emerald-800 text-emerald-200 transition-all active:scale-95';
        btn.title = item.desc;
        btn.innerHTML = `<span class="text-base leading-none">${item.emoji}</span><span class="mt-0.5 leading-tight">${item.name}</span><span class="text-emerald-400">×${remaining}</span>`;
        if (remaining <= 0 || !MASMON_BATTLE_STATE.isPlayerTurnActive) {
            btn.classList.add('opacity-40', 'pointer-events-none');
            btn.dataset.depleted = remaining <= 0 ? '1' : '';
        }
        btn.onclick = () => useMasmonItem(key);
        container.appendChild(btn);
    });
}

function useMasmonItem(itemKey) {
    if (MASMON_BATTLE_STATE.isBattleEnd || !MASMON_BATTLE_STATE.isPlayerTurnActive) return;
    const counts = MASMON_BATTLE_STATE.playerItems;
    if (!counts || !counts[itemKey] || counts[itemKey] <= 0) return;

    counts[itemKey]--;
    const p = getPlayerActive();
    const item = MASMON_ITEM_DB[itemKey];

    if (itemKey === 'mango') {
        const heal = Math.floor(p.stats.maxLife * 0.25);
        p.stats.life = Math.min(p.stats.maxLife, p.stats.life + heal);
        addLog(`🥭 ${p.name} は【${item.name}】を使った！ライフが ${heal} 回復した！`);
        showEffect('🥭 回復! 🥭');
    } else if (itemKey === 'kuri') {
        p.critBonusTurns = 3;
        addLog(`🌰 ${p.name} は【${item.name}】を使った！3ターンの間クリティカル率が上昇する！`);
        showEffect('🌰 会心UP! 🌰');
    } else if (itemKey === 'toro') {
        p.stats.pow += 20;
        p.stats.int += 20;
        const selfDmg = Math.floor(p.stats.maxLife * 0.3);
        p.stats.life = Math.max(0, p.stats.life - selfDmg);
        addLog(`🧪 ${p.name} は【${item.name}】を使った！ちから・かしこさが上昇したが、反動で ${selfDmg} のダメージを受けた！`);
        showEffect('🧪 パワーUP! 🧪');
    }

    updateMasmonBattleStatsUI();
    renderBattleItems();

    if (itemKey === 'toro') {
        const ended = checkFaintAndProceed('player');
        if (ended) return;
    }

    proceedToMasmonEnemyTurn();
}

function executeMasmonPlayerSkill(skKey) {
    if (MASMON_BATTLE_STATE.isBattleEnd || !MASMON_BATTLE_STATE.isPlayerTurnActive) return;

    const rawSk = SKILLS_DB[skKey];
    if (!rawSk) return;
    const p = getPlayerActive();
    const e = getEnemyActive();
    const sk = getMasmonEffectiveSkill(p, skKey);

    if (p.guts < sk.cost) return;

    const mods = getGutsModifiers(p.guts);
    p.guts -= sk.cost;
    updateMasmonBattleStatsUI();

    addLog(`${p.name} の 【${sk.name}】！`);
    animateSprite('battle-player-sprite-container', 'translate-x-6');

    setTimeout(() => {
        if (sk.type === 'pow' || sk.type === 'int') {
            const isCertain = sk.hitRate === 100;
            let hitChance = isCertain ? 100 : Math.max(10, Math.min(99, (sk.hitRate + mods.hitMod) + (p.stats.hit - e.stats.spd) * 0.5));
            if (p.isShuchuActive && !isCertain) {
                hitChance = Math.min(99, hitChance * 1.5);
            }
            let isHit;
            let isGuaranteedDodge = false;
            if (e.dodgeNextGuaranteed) {
                isHit = false;
                isGuaranteedDodge = true;
                e.dodgeNextGuaranteed = false;
            } else {
                isHit = isCertain || (Math.random() * 100 < hitChance);
            }

            // 次技威力アップ（オーロラゲート等）の消費は命中判定に関わらず技を撃った時点で消費する
            const usedForce = consumeForceBoost(p, sk.force);

            if (isHit) {
                const isPow = sk.type === 'pow';
                const attackerStat = getWeakenedStat(p, isPow ? p.stats.pow : p.stats.int);
                const defenderStat = e.stats.def;
                const statCap = Math.max(30, defenderStat * 2.5);
                let effectiveAttacker = attackerStat;
                if (attackerStat > statCap) {
                    effectiveAttacker = statCap + (attackerStat - statCap) * 0.2;
                }

                const defenderGutsDefenseMod = getGutsDefenseModifier(e.guts);
                let rawDmg = ((effectiveAttacker * usedForce) * mods.dmgMod) - (defenderStat * 0.35);
                let damage = Math.floor(Math.max(10, (rawDmg * (0.9 + Math.random() * 0.2)) * defenderGutsDefenseMod));

                let extraDmgMsg = "";
                if (p.isSokojikaraActive) {
                    damage = Math.floor(damage * 1.5);
                    extraDmgMsg += " (底力×1.5)";
                }
                if (p.isShuchuActive) {
                    damage = Math.floor(damage * 1.2);
                    extraDmgMsg += " (集中×1.2)";
                }

                const critChance = 0.10 + (p.critBonusTurns > 0 ? 0.25 : 0);
                let isCrit = Math.random() < critChance;
                if (isCrit) {
                    damage = Math.floor(damage * 1.5);
                }
                damage = Math.max(1, Math.floor(damage * MASMON_BATTLE_DAMAGE_MULTIPLIER));

                // 九重神眼等のシールドによる被ダメージ吸収
                const shieldResult = applyShieldAbsorption(e, damage);
                damage = shieldResult.finalDamage;

                if (isCrit) {
                    addLog(`★クリティカルヒット！ ${e.name} に ${damage} ダメージ！${extraDmgMsg}`);
                } else {
                    addLog(`${e.name} に ${damage} ダメージ！${extraDmgMsg}`);
                }
                if (shieldResult.absorbed > 0) {
                    addLog(`🛡️ ${e.name} のシールドが ${shieldResult.absorbed} のダメージを吸収した！(シールド残量: ${e.shieldValue})`);
                }

                e.stats.life = Math.max(0, e.stats.life - damage);
                checkMasmonDefenseStatusTriggers(e);

                let finalGutsDown = sk.gutsDown || 0;
                if (p.isGyakujoActive && finalGutsDown > 0) {
                    finalGutsDown = Math.floor(finalGutsDown * 1.2);
                }
                if (finalGutsDown > 0) {
                    const actualGutsDown = Math.min(e.guts, finalGutsDown);
                    e.guts = Math.max(0, e.guts - actualGutsDown);
                    addLog(`さらに！相手のガッツを ${actualGutsDown} 奪い取った！${p.isGyakujoActive ? " (逆上×1.2)" : ""} (現在: ${Math.floor(e.guts)})`);
                    checkMasmonGyakujoTrigger(e);
                }

                // モノリスの技等が持つ追加効果（衰弱／混乱付与／次技威力アップ）
                applySkillOnHitEffect(p, e, sk).forEach(msg => addLog(msg));

                // プラントの「ドレイン」等：与えたダメージの一部を自身のライフに変換
                const drainHeal = getDrainHealAmount(sk, damage);
                if (drainHeal > 0) {
                    p.stats.life = Math.min(p.stats.maxLife, p.stats.life + drainHeal);
                    addLog(`🌿 ${p.name} は相手の生命力を吸収し、ライフが ${drainHeal} 回復した！(現在: ${Math.floor(p.stats.life)})`);
                }

                p.isSokojikaraActive = false;
                p.isShuchuActive = false;

                showEffect(isCrit ? '💥 CRITICAL!! 💥' : '💥 HIT! 💥');
                showDamagePopup('enemy-dmg-popup', damage, isCrit);
                animateSprite('battle-enemy-sprite-container', 'shake');
            } else {
                if (isGuaranteedDodge) {
                    addLog(`🌫️ ${e.name} は陽炎の効果で攻撃を確実に回避した！`);
                } else {
                    addLog('しかし、攻撃はかわされた！');
                }
                showEffect('💨 MISS 💨');
                showDamagePopup('enemy-dmg-popup', 'MISS', false);
            }
        } else if (sk.type === 'buff_pow') {
            p.stats.pow += 15;
            addLog(`${p.name} の闘志がみなぎる！ちからが15アップした！`);
            showEffect('💪 ちからUP! 💪');
        } else if (sk.type === 'heal') {
            const healAmount = Math.floor(p.stats.maxLife * 0.35);
            p.stats.life = Math.min(p.stats.maxLife, p.stats.life + healAmount);
            addLog(`${p.name} は癒された！ライフが ${healAmount} 回復！`);
            showEffect('💚 ライフ回復! 💚');
        }

        updateMasmonBattleStatsUI();
        if (checkFaintAndProceed('enemy')) return;
        proceedToMasmonEnemyTurn();
    }, 300);
}

// --- ターン終了ボタンのモード振り分けルーター ---
// （マスモンCPU対戦・リアルタイム対戦は、いずれもPvP仕様＝1行動で即ターン交代のため
//   このボタン自体が非表示になっており、育成中バトルからのみ呼び出される）
function handleEndTurnClick(defendMode) {
    if (ACTIVE_BATTLE_MODE === 'adventure') {
        endPlayerTurn(defendMode);
    }
}

// --- 技・防御・アイテムいずれかの行動が終わったら、即座に相手のターンへ移る（PvP仕様） ---
function proceedToMasmonEnemyTurn() {
    if (MASMON_BATTLE_STATE.isBattleEnd || !MASMON_BATTLE_STATE.isPlayerTurnActive) return;
    MASMON_BATTLE_STATE.isPlayerTurnActive = false;
    toggleMasmonSkillButtons(false);

    setTimeout(() => {
        executeMasmonEnemyTurn();
    }, 600);
}

// --- 防御コマンド（技一覧内から選択。被ダメ半減のみで、ガッツ回復ペナルティは無い） ---
function executeMasmonDefend() {
    if (MASMON_BATTLE_STATE.isBattleEnd || !MASMON_BATTLE_STATE.isPlayerTurnActive) return;

    MASMON_BATTLE_STATE.isDefending = true;
    document.getElementById('player-defense-shield').classList.remove('hidden');
    addLog(`${getPlayerActive().name} は身を守るため防御の構えを取った！（被ダメ半減／ガッツ回復ペナルティ無し）`);
    showEffect('🛡️ DEFENSE 🛡️');
    updateMasmonBattleStatsUI();

    proceedToMasmonEnemyTurn();
}

// --- 敵CPUのアイテム使用AI（シンプルな条件判定） ---
function runEnemyItemAI() {
    const e = getEnemyActive();
    const counts = MASMON_BATTLE_STATE.enemyItems;
    if (!counts) return;

    const lifeRatio = e.stats.life / e.stats.maxLife;

    if (lifeRatio <= 0.35 && counts.mango > 0) {
        counts.mango--;
        const heal = Math.floor(e.stats.maxLife * 0.25);
        e.stats.life = Math.min(e.stats.maxLife, e.stats.life + heal);
        addLog(`🥭 ${e.name} は【${MASMON_ITEM_DB.mango.name}】を使った！ライフが ${heal} 回復した！`);
        return;
    }

    if (e.critBonusTurns <= 0 && counts.kuri > 0 && Math.random() < 0.4) {
        counts.kuri--;
        e.critBonusTurns = 3;
        addLog(`🌰 ${e.name} は【${MASMON_ITEM_DB.kuri.name}】を使った！クリティカル率が上昇した！`);
        return;
    }

    if (counts.toro > 0 && lifeRatio > 0.6 && Math.random() < 0.35) {
        counts.toro--;
        e.stats.pow += 20;
        e.stats.int += 20;
        const selfDmg = Math.floor(e.stats.maxLife * 0.3);
        e.stats.life = Math.max(0, e.stats.life - selfDmg);
        addLog(`🧪 ${e.name} は【${MASMON_ITEM_DB.toro.name}】を使った！ちから・かしこさが上昇したが、反動でダメージを受けた！`);
    }
}

function executeMasmonEnemyTurn() {
    if (MASMON_BATTLE_STATE.isBattleEnd) return;

    let p = getPlayerActive();
    let e = getEnemyActive();

    addLog(`--- ${e.name} のターン ---`);
    showEffect('⚠️ ENEMY TURN ⚠️');

    if (e.critBonusTurns > 0) {
        e.critBonusTurns--;
    }

    let enemyRecovery = Math.floor((e.stats.gutsSpeed || 14) + 30);
    if (e.isGyakujoActive) {
        enemyRecovery = Math.floor(enemyRecovery * 1.2);
    }
    if (e.statusEffect === "闘魂" && p && p.guts > 70) {
        enemyRecovery = Math.floor(enemyRecovery * 1.5);
    }
    e.guts = Math.min(100, e.guts + enemyRecovery);
    addLog(`${e.name} のガッツが ${enemyRecovery} 回復した！(現在: ${Math.floor(e.guts)})`);

    runEnemyItemAI();
    updateMasmonBattleStatsUI();

    if (checkFaintAndProceed('enemy')) return; // トロカチンの反動で自滅した場合

    setTimeout(() => {
        // アイテム使用やチーム交代後の最新ユニットを再取得
        p = getPlayerActive();
        e = getEnemyActive();

        // 混乱状態（サケビ声などで受けた場合）の残ターン消化と行動失敗判定
        const enemyConfusionResult = tickStatusTurnsAndCheckConfusion(e);
        if (enemyConfusionResult.confused) {
            addLog(`❓ ${e.name} は混乱していて、行動できなかった！`);
            showEffect('❓ 混乱... ❓');
            updateMasmonBattleStatsUI();
            setTimeout(() => {
                if (checkFaintAndProceed('player')) return;
                MASMON_BATTLE_STATE.turn++;
                document.getElementById('battle-turn-counter').textContent = MASMON_BATTLE_STATE.turn;
                startMasmonPlayerTurn(false);
            }, 800);
            return;
        }

        const affordableSkills = e.skills
            .map(skKey => ({ key: skKey, info: SKILLS_DB[skKey] }))
            .filter(skObj => skObj.info && e.guts >= skObj.info.cost);

        if (affordableSkills.length === 0) {
            addLog(`しかし ${e.name} はガッツが著しく不足しており、何も行動できない！`);
            showEffect('💨 NO ACTION 💨');
        } else {
            affordableSkills.sort((a, b) => b.info.cost - a.info.cost);
            const skKey = affordableSkills[0].key;
            const sk = getMasmonEffectiveSkill(e, skKey);
            e.guts -= sk.cost;
            updateMasmonBattleStatsUI();

            addLog(`${e.name} の 【${sk.name}】！`);
            animateSprite('battle-enemy-sprite-container', '-translate-x-6');

            setTimeout(() => {
                if (sk.type === 'pow' || sk.type === 'int') {
                    const isCertain = sk.hitRate === 100;
                    let hitChance = isCertain ? 100 : Math.max(10, Math.min(99, sk.hitRate + (e.stats.hit - p.stats.spd) * 0.5));
                    if (e.isShuchuActive && !isCertain) {
                        hitChance = Math.min(99, hitChance * 1.5);
                    }
                    let isHit;
                    let isGuaranteedDodge = false;
                    if (p.dodgeNextGuaranteed) {
                        isHit = false;
                        isGuaranteedDodge = true;
                        p.dodgeNextGuaranteed = false;
                    } else {
                        isHit = isCertain || (Math.random() * 100 < hitChance);
                    }

                    // 次技威力アップの消費は命中判定に関わらず技を撃った時点で消費する
                    const enemyUsedForce = consumeForceBoost(e, sk.force);

                    if (isHit) {
                        const isPow = sk.type === 'pow';
                        const attackerStat = getWeakenedStat(e, isPow ? e.stats.pow : e.stats.int);
                        const defenderStat = p.stats.def;
                        const statCap = Math.max(30, defenderStat * 2.5);
                        let effectiveAttacker = attackerStat;
                        if (attackerStat > statCap) {
                            effectiveAttacker = statCap + (attackerStat - statCap) * 0.2;
                        }

                        const playerGutsDefenseMod = getGutsDefenseModifier(p.guts);
                        let rawDmg = (effectiveAttacker * enemyUsedForce) - (defenderStat * 0.35);
                        let damage = Math.floor(Math.max(8, (rawDmg * (0.9 + Math.random() * 0.2)) * playerGutsDefenseMod));

                        if (e.isSokojikaraActive) {
                            damage = Math.floor(damage * 1.5);
                        }
                        if (e.isShuchuActive) {
                            damage = Math.floor(damage * 1.2);
                        }

                        const critChance = 0.10 + (e.critBonusTurns > 0 ? 0.25 : 0);
                        const isCrit = Math.random() < critChance;
                        if (isCrit) damage = Math.floor(damage * 1.5);

                        if (MASMON_BATTLE_STATE.isDefending) {
                            damage = Math.floor(damage / 2);
                            addLog(`【防御効果】攻撃を盾で受け流し、ダメージを半減した！`);
                        }

                        damage = Math.max(1, Math.floor(damage * MASMON_BATTLE_DAMAGE_MULTIPLIER));

                        // 九重神眼等のシールドによる被ダメージ吸収
                        const shieldResult = applyShieldAbsorption(p, damage);
                        damage = shieldResult.finalDamage;

                        p.stats.life = Math.max(0, p.stats.life - damage);
                        addLog(isCrit ? `★相手のクリティカル！ ${p.name} は ${damage} ダメージを受けた！` : `${p.name} は ${damage} ダメージを受けた！`);
                        if (shieldResult.absorbed > 0) {
                            addLog(`🛡️ ${p.name} のシールドが ${shieldResult.absorbed} のダメージを吸収した！(シールド残量: ${p.shieldValue})`);
                        }
                        checkMasmonDefenseStatusTriggers(p);

                        let finalGutsDown = sk.gutsDown || 0;
                        if (e.isGyakujoActive && finalGutsDown > 0) {
                            finalGutsDown = Math.floor(finalGutsDown * 1.2);
                        }
                        if (finalGutsDown > 0) {
                            const actualGutsDown = Math.min(p.guts, finalGutsDown);
                            p.guts = Math.max(0, p.guts - actualGutsDown);
                            addLog(`さらに！ ${p.name} のガッツが ${actualGutsDown} 奪われた！(現在: ${Math.floor(p.guts)})`);
                            checkMasmonGyakujoTrigger(p);
                        }

                        applySkillOnHitEffect(e, p, sk).forEach(msg => addLog(msg));

                        // 相手マスモンが「ドレイン」等を使う場合：与えたダメージの一部を自身のライフに変換
                        const enemyDrainHeal = getDrainHealAmount(sk, damage);
                        if (enemyDrainHeal > 0) {
                            e.stats.life = Math.min(e.stats.maxLife, e.stats.life + enemyDrainHeal);
                            addLog(`🌿 ${e.name} は相手の生命力を吸収し、ライフが ${enemyDrainHeal} 回復した！(現在: ${Math.floor(e.stats.life)})`);
                        }

                        e.isSokojikaraActive = false;
                        e.isShuchuActive = false;

                        showEffect('⚡ 被弾!! ⚡');
                        showDamagePopup('player-dmg-popup', damage, false);
                        animateSprite('battle-player-sprite-container', 'shake');
                    } else {
                        if (isGuaranteedDodge) {
                            addLog(`🌫️ ${p.name} は陽炎の効果で攻撃を確実に回避した！`);
                        } else {
                            addLog(`しかし ${p.name} は身軽にかわした！`);
                        }
                        showEffect('💨 回避!! 💨');
                        showDamagePopup('player-dmg-popup', 'MISS', false);
                    }
                } else if (sk.type === 'buff_pow') {
                    e.stats.pow += 15;
                    addLog(`${e.name} は気合を入れて攻撃力を上げた！`);
                    showEffect('💪 相手の攻撃UP! 💪');
                } else if (sk.type === 'heal') {
                    const healAmount = Math.floor(e.stats.maxLife * 0.35);
                    e.stats.life = Math.min(e.stats.maxLife, e.stats.life + healAmount);
                    addLog(`${e.name} は癒された！ライフが ${healAmount} 回復！`);
                    showEffect('💚 相手回復! 💚');
                }
                updateMasmonBattleStatsUI();
            }, 300);
        }

        setTimeout(() => {
            if (checkFaintAndProceed('player')) return;

            MASMON_BATTLE_STATE.turn++;
            document.getElementById('battle-turn-counter').textContent = MASMON_BATTLE_STATE.turn;
            startMasmonPlayerTurn(false);
        }, 800);
    }, 600);
}

// -----------------------------------------------------
// バトル終了処理
// -----------------------------------------------------
function handleMasmonBattleWin() {
    if (MASMON_BATTLE_STATE.isBattleEnd) return;
    MASMON_BATTLE_STATE.isBattleEnd = true;
    MASMON_BATTLE_STATE.battleResult = 'win';
    const isTeam = MASMON_BATTLE_STATE.mode === 'cpu_team';
    addLog(isTeam ? `🎉 勝利！ 相手チームを全滅させた！` : `🎉 勝利！ ${MASMON_BATTLE_STATE.enemyTeam[0].name} を倒した！`);
    showEffect('🏆 WIN!! 🏆');
    setTimeout(() => showMasmonBattleResult(true), 1500);
}

function handleMasmonBattleLose() {
    if (MASMON_BATTLE_STATE.isBattleEnd) return;
    MASMON_BATTLE_STATE.isBattleEnd = true;
    MASMON_BATTLE_STATE.battleResult = 'lose';
    const isTeam = MASMON_BATTLE_STATE.mode === 'cpu_team';
    addLog(isTeam ? `💀 敗北… あなたのチームは全滅してしまった…` : `💀 敗北… ${MASMON_BATTLE_STATE.playerTeam[0].name} は倒れてしまった…`);
    showEffect('💀 LOSE... 💀');
    setTimeout(() => showMasmonBattleResult(false), 1500);
}

function showMasmonBattleResult(isWin) {
    ACTIVE_BATTLE_MODE = 'adventure'; // モードを元に戻す
    // 育成中バトル用の「攻撃終了」「防御して終了」ボタンを再表示しておく
    document.getElementById('battle-endturn-controls').classList.remove('hidden');

    const badge = document.getElementById('masmon-result-badge');
    const title = document.getElementById('masmon-result-title');
    const subtitle = document.getElementById('masmon-result-subtitle');
    const detail = document.getElementById('masmon-result-detail');

    const isTeam = MASMON_BATTLE_STATE.mode === 'cpu_team';
    const myNames = MASMON_BATTLE_STATE.playerMeta.map(m => m.name).join('、');
    const enemyNames = MASMON_BATTLE_STATE.enemyMeta.map(m => m.name).join('、');
    const enemyOwner = MASMON_BATTLE_STATE.opponentOwnerName || '相手ブリーダー';

    if (isWin) {
        badge.textContent = '🏆';
        title.textContent = 'VICTORY!';
        title.className = 'text-2xl font-black text-amber-500 pixel-font';
        subtitle.textContent = isTeam
            ? `【${myNames}】のチームが【${enemyOwner}】のチームを打ち破った！`
            : `【${myNames}】が【${enemyOwner}】の【${enemyNames}】を倒した！`;
    } else {
        badge.textContent = '💀';
        title.textContent = 'DEFEAT...';
        title.className = 'text-2xl font-black text-red-500 pixel-font';
        subtitle.textContent = isTeam
            ? `【${myNames}】のチームは【${enemyOwner}】のチームに敗れた…`
            : `【${myNames}】は【${enemyOwner}】の【${enemyNames}】に敗れた…`;
    }

    const survivedCount = (isWin ? MASMON_BATTLE_STATE.playerTeam : MASMON_BATTLE_STATE.enemyTeam).filter(u => u.stats.life > 0).length;

    detail.innerHTML = `
        <div class="text-xs text-purple-300 font-bold border-b border-purple-800 pb-1 mb-1">対戦結果</div>
        <div class="flex justify-between text-xs"><span class="text-gray-400">あなたの${isTeam ? 'チーム' : 'マスモン'}:</span><span class="text-white font-bold">${myNames}</span></div>
        <div class="flex justify-between text-xs"><span class="text-gray-400">対戦相手:</span><span class="text-white font-bold">${enemyOwner} の ${enemyNames}</span></div>
        ${isTeam ? `<div class="flex justify-between text-xs"><span class="text-gray-400">生存数:</span><span class="text-white font-bold">${survivedCount}/${(isWin ? MASMON_BATTLE_STATE.playerTeam : MASMON_BATTLE_STATE.enemyTeam).length}</span></div>` : ''}
        <div class="flex justify-between text-xs"><span class="text-gray-400">経過ターン数:</span><span class="text-white font-bold">${MASMON_BATTLE_STATE.turn}</span></div>
    `;

    changeScreen('screen-masmon-battle-result');
}

function returnToMasmonList() {
    changeScreen('screen-masmon-list');
    renderMasmonList();
}
