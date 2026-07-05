// =====================================================
// マスモン リアルタイム対戦：ターン同期バトルロジック（フェーズ⑤／フェーズ⑥で団体戦対応）
// Firebase Realtime Database: battle_rooms/{keyword}/battleState, battleLog
//
// フェーズ④で構築したマッチング基盤（battle_rooms/{keyword} の
// player1 / player2 / ハートビート）の上に、実際のターン制バトル同期を実装する。
//
// 従来のCPU対戦（masmon_battle.js）との違い：
//   ・1回の行動（技 or 防御 or アイテム）で即座に相手のターンへ移る
//     （「攻撃終了」「防御して終了」ボタンは無し）
//   ・防御は技一覧の中の1コマンドとして選択する
//     （被ダメージ軽減のみ。ガッツ回復量の減少ペナルティは無い）
//   ・双方の行動結果は、行動した側のクライアントが計算し、
//     Firebase Realtime Database の transaction で書き込むことで同期する
//     （相手側は listener で結果を受け取って表示するだけ＝二重計算しない）
//   ・60秒間相手の応答（ハートビート）が無い場合、不戦勝を宣言できる
//
// フェーズ⑥：団体戦（3vs3）対応
//   ・battleState.teams.{player1|player2} = { units: [...], activeIdx } の形式で
//     個人戦（units長さ1）・団体戦（units長さ最大3）を同じ構造で扱う
//   ・行動によって場に出ている側のユニットが戦闘不能になった場合、
//     行動を実行した側のtransaction内で次の生存ユニットへ自動的に交代する
//     （CPU団体戦のcheckFaintAndProceedと同等の考え方をtransaction内に内包）
//   ・両チームとも全滅していない限りバトルは継続し、1回の行動の後は
//     必ず相手チームの「場に出ているユニット」のターンへ移る
// =====================================================

const REALTIME_BATTLE = {
    active: false,
    ref: null,               // battle_rooms/{keyword} への参照
    keyword: null,
    mySlot: null,             // 'player1' | 'player2'
    oppSlot: null,
    stateListener: null,
    logListener: null,
    oppLastSeenListener: null,
    oppLastSeen: 0,
    disconnectTimer: null,
    cachedState: null,
    actionInProgress: false,
    seenLogKeys: {}          // 二重描画防止
};

// --- 現在のバトル状態から「場に出ているユニット」を取得するヘルパー ---
function getRealtimeActiveUnit(state, slot) {
    const team = state.teams[slot];
    return team.units[team.activeIdx];
}

// -----------------------------------------------------
// マッチング成立画面 →「バトル開始」ボタン
// -----------------------------------------------------
function beginRealtimeBattle() {
    if (!realtimeRoomRef || !realtimeMySlot) {
        showToast('マッチング情報が見つかりません。');
        return;
    }
    document.getElementById('realtime-begin-battle-btn').disabled = true;
    document.getElementById('realtime-begin-battle-btn').textContent = '⏳ 対戦準備中...';

    // フェーズ④の「ルーム削除監視」リスナーは以降このファイルが引き継ぐため解除
    detachRealtimeListener();

    REALTIME_BATTLE.ref = realtimeRoomRef;
    REALTIME_BATTLE.keyword = realtimeRoomKeyword;
    REALTIME_BATTLE.mySlot = realtimeMySlot;
    REALTIME_BATTLE.oppSlot = realtimeMySlot === 'player1' ? 'player2' : 'player1';
    REALTIME_BATTLE.active = true;
    REALTIME_BATTLE.seenLogKeys = {};

    initializeRealtimeBattleState();
}

// -----------------------------------------------------
// バトル状態の初期化（先着のクライアントのみが実際に書き込む）
// -----------------------------------------------------
async function initializeRealtimeBattleState() {
    const stateRef = REALTIME_BATTLE.ref.child('battleState');

    try {
        const roomSnap = await REALTIME_BATTLE.ref.once('value');
        const roomData = roomSnap.val();
        if (!roomData || !roomData.player1 || !roomData.player2) {
            showToast('対戦相手の情報が取得できませんでした。');
            resetRealtimeBattleClientState();
            showMasmonList();
            return;
        }

        await stateRef.transaction(current => {
            if (current) return current; // 既に相手が作成済み → そのまま採用
            return buildInitialRealtimeBattleState(roomData);
        });
    } catch (e) {
        console.error('[Firebase] リアルタイムバトル初期化エラー:', e);
        showToast('バトルの初期化に失敗しました。');
        return;
    }

    attachRealtimeBattleListeners();
}

function convertRoomMasmonToRealtimeUnit(masmon) {
    const s = masmon.stats;
    return {
        name: masmon.name,
        emoji: masmon.emoji,
        monsterBaseName: masmon.monsterBaseName || masmon.name,
        isAwakened: !!masmon.isAwakened,
        life: s.maxLife,
        maxLife: s.maxLife,
        pow: s.pow,
        int: s.int,
        hit: s.hit,
        spd: s.spd,
        def: s.def,
        gutsSpeed: s.gutsSpeed || 14,
        guts: 50,
        critBonusTurns: 0,
        isDefending: false,
        statusEffect: masmon.statusEffect || null,
        isGyakujoActive: false,
        isSokojikaraFired: false,
        isSokojikaraActive: false,
        isShuchuActive: false,
        weakenTurns: 0,        // わらわら等で受ける「ちから・かしこさ低下」の残ターン
        confuseTurns: 0,       // サケビ声等で受ける「混乱」の残行動回数
        forceBoost: 0,         // オーロラゲート等で得る「次の技威力アップ」倍率
        shieldValue: 0,        // 九重神眼等で得るシールド（被ダメージ吸収）の残量
        shieldUsedThisBattle: false, // 九重神眼等の「バトル中1回限り」シールド技を使用済みか
        dodgeNextGuaranteed: false, // 陽炎等で得る「次の敵攻撃を確実に回避」フラグ
        permaForceBoostActive: false, // 天河天翔等で得る「今後のダメージ永続アップ」フラグ
        isConfusedThisTurn: false, // このターンの行動が混乱によって失敗するか（ターン開始時に決定）
        skills: [...(masmon.skills || [])],
        skillEnhancements: JSON.parse(JSON.stringify(masmon.skillEnhancements || {}))
    };
}

// --- 技の強化データを反映した実効ステータス（force/hitRate）を取得（リアルタイム対戦用） ---
function getRealtimeEffectiveSkill(unit, skKey) {
    const sk = SKILLS_DB[skKey];
    if (!sk) return null;
    const enh = (unit.skillEnhancements && unit.skillEnhancements[skKey]) || { forceBonus: 0, hitBonus: 0 };
    return {
        ...sk,
        force: sk.force + (enh.forceBonus || 0),
        hitRate: sk.hitRate === 100 ? 100 : Math.min(99, sk.hitRate + (enh.hitBonus || 0))
    };
}

function buildInitialRealtimeBattleState(roomData) {
    const p1Team = (roomData.player1.team || []).map(convertRoomMasmonToRealtimeUnit);
    const p2Team = (roomData.player2.team || []).map(convertRoomMasmonToRealtimeUnit);
    const turnOwner = p2Team[0].spd > p1Team[0].spd ? 'player2' : 'player1';

    const p1Items = roomData.player1.items || { mango: 0, kuri: 0, toro: 0 };
    const p2Items = roomData.player2.items || { mango: 0, kuri: 0, toro: 0 };

    return {
        status: 'active',
        battleType: roomData.battleType || (p1Team.length > 1 || p2Team.length > 1 ? 'team' : 'solo'),
        turnOwner: turnOwner,
        turnNumber: 1,
        winner: null,
        winReason: null,
        ownerNames: {
            player1: roomData.player1.name || 'ブリーダー1',
            player2: roomData.player2.name || 'ブリーダー2'
        },
        teams: {
            player1: { units: p1Team, activeIdx: 0 },
            player2: { units: p2Team, activeIdx: 0 }
        },
        items: { player1: { ...p1Items }, player2: { ...p2Items } },
        itemsInitial: { player1: { ...p1Items }, player2: { ...p2Items } },
        createdAt: Date.now(),
        lastActionAt: Date.now()
    };
}

// -----------------------------------------------------
// リスナー登録（バトル状態・ログ・相手の生存確認）
// -----------------------------------------------------
function attachRealtimeBattleListeners() {
    const stateRef = REALTIME_BATTLE.ref.child('battleState');
    const logRef = REALTIME_BATTLE.ref.child('battleLog');

    REALTIME_BATTLE.stateListener = stateRef.on('value', snap => {
        const state = snap.val();
        if (!state) return;
        const isFirstRender = !REALTIME_BATTLE.cachedState;
        REALTIME_BATTLE.cachedState = state;

        if (isFirstRender) {
            enterRealtimeBattleScreen(state);
        }
        renderRealtimeBattleUI(state);

        if (state.status === 'finished') {
            handleRealtimeBattleEnd(state);
        }
    });

    REALTIME_BATTLE.logListener = logRef.limitToLast(50).on('child_added', snap => {
        if (REALTIME_BATTLE.seenLogKeys[snap.key]) return;
        REALTIME_BATTLE.seenLogKeys[snap.key] = true;
        const entry = snap.val();
        if (entry && entry.text) {
            addLog(entry.text);
            // HIT/回避/クリティカルなど、育成中のバトルと同じ演出をログ内容から再現する
            triggerRealtimeCombatEffects(entry);
            // 根性の発動は状態を持続保存しないため、ログのタイミングで一時演出を出す（育成中のバトルと同じ表現）
            if (entry.text.includes('根性が発動') && REALTIME_BATTLE.cachedState) {
                const meNow = getRealtimeActiveUnit(REALTIME_BATTLE.cachedState, REALTIME_BATTLE.mySlot);
                if (meNow && entry.text.includes(meNow.name)) {
                    triggerRealtimeTemporaryStatusEffect("根性");
                }
            }
        }
    });

    // 相手の生存監視（切断検知用）
    const oppSlot = REALTIME_BATTLE.oppSlot;
    REALTIME_BATTLE.oppLastSeenListener = REALTIME_BATTLE.ref.child(`${oppSlot}/lastSeen`).on('value', snap => {
        const val = snap.val();
        if (val) REALTIME_BATTLE.oppLastSeen = val;
    });

    if (REALTIME_BATTLE.disconnectTimer) clearInterval(REALTIME_BATTLE.disconnectTimer);
    REALTIME_BATTLE.disconnectTimer = setInterval(checkOpponentDisconnect, 5000);
}

// -----------------------------------------------------
// バトル画面への遷移（初回のみ）
// -----------------------------------------------------
function enterRealtimeBattleScreen(state) {
    ACTIVE_BATTLE_MODE = 'masmon_realtime';

    document.getElementById('battle-endturn-controls').classList.add('hidden');
    document.getElementById('realtime-surrender-btn').classList.remove('hidden');
    document.getElementById('realtime-turn-indicator').classList.remove('hidden');
    document.getElementById('realtime-disconnect-banner').classList.add('hidden');

    const isTeam = state.battleType === 'team';
    const oppName = state.ownerNames ? state.ownerNames[REALTIME_BATTLE.oppSlot] : '対戦相手';
    document.getElementById('battle-floor-indicator').textContent = isTeam
        ? `🌐🛡️ リアルタイム団体戦 vs ${oppName}`
        : `🌐 リアルタイム対戦 vs ${oppName}`;

    const myFirst = getRealtimeActiveUnit(state, REALTIME_BATTLE.mySlot);
    const oppFirst = getRealtimeActiveUnit(state, REALTIME_BATTLE.oppSlot);

    const log = document.getElementById('battle-log');
    log.innerHTML = `<div>マッチング成立！ ${myFirst.name} と ${oppFirst.name} のバトル開始！</div>`;
    if (isTeam) {
        const mySize = state.teams[REALTIME_BATTLE.mySlot].units.length;
        const oppSize = state.teams[REALTIME_BATTLE.oppSlot].units.length;
        log.innerHTML += `<div class="text-indigo-300">団体戦スタート！お互い${mySize}体 vs ${oppSize}体で戦う！</div>`;
    }

    changeScreen('screen-battle');
}

// -----------------------------------------------------
// 画面描画
// -----------------------------------------------------
function renderRealtimeBattleUI(state) {
    if (!REALTIME_BATTLE.active) return;

    const mySlot = REALTIME_BATTLE.mySlot;
    const oppSlot = REALTIME_BATTLE.oppSlot;
    const me = getRealtimeActiveUnit(state, mySlot);
    const opp = getRealtimeActiveUnit(state, oppSlot);
    const oppOwnerName = state.ownerNames ? state.ownerNames[oppSlot] : '対戦相手';

    const isMyTurn = state.status === 'active' && state.turnOwner === mySlot;

    document.getElementById('battle-turn-counter').textContent = state.turnNumber || 1;

    document.getElementById('enemy-name').textContent = `${opp.name}（${oppOwnerName}）`;
    renderMonsterVisual(document.getElementById('battle-enemy-icon'), opp.monsterBaseName, opp.emoji, opp.isAwakened);
    document.getElementById('battle-enemy-type').textContent = opp.name;
    document.getElementById('enemy-hp-text').textContent = `HP: ${opp.life}/${opp.maxLife}`;
    document.getElementById('enemy-hp-bar').style.width = `${Math.max(0, (opp.life / opp.maxLife) * 100)}%`;
    document.getElementById('enemy-guts-text').textContent = Math.floor(opp.guts);
    document.getElementById('enemy-guts-bar').style.width = `${opp.guts}%`;

    renderMonsterVisual(document.getElementById('battle-player-icon'), me.monsterBaseName, me.emoji, me.isAwakened);
    document.getElementById('battle-player-name').textContent = me.name;
    document.getElementById('player-hp-text').textContent = `${me.life}/${me.maxLife}`;
    document.getElementById('player-hp-bar').style.width = `${Math.max(0, (me.life / me.maxLife) * 100)}%`;
    document.getElementById('guts-number').textContent = Math.floor(me.guts);
    document.getElementById('guts-progress-bar').style.width = `${me.guts}%`;

    document.getElementById('player-defense-shield').classList.toggle('hidden', !me.isDefending);

    renderRealtimeTeamIcons(state);

    const turnIndicator = document.getElementById('realtime-turn-indicator');
    if (state.status === 'active') {
        turnIndicator.textContent = isMyTurn ? '🟢 あなたのターン' : '🔴 相手のターン';
        turnIndicator.className = `text-white font-bold text-[9px] px-1.5 py-0.5 rounded ${isMyTurn ? 'bg-emerald-700' : 'bg-red-900'}`;
    } else {
        turnIndicator.classList.add('hidden');
    }

    document.getElementById('turn-guts-notice').textContent = isMyTurn
        ? `💡 あなたのターンです！行動を選んでください（GUTS回復:+30）`
        : `⏳ 対戦相手の行動を待っています…`;

    renderRealtimeBattleSkills(state);
    renderRealtimeBattleItems(state);
    updateRealtimeStatusEffectUI(state);

    // 相手のターンが続いている間だけ切断バナーの判定対象にする
    if (isMyTurn || state.status !== 'active') {
        document.getElementById('realtime-disconnect-banner').classList.add('hidden');
    }
}

// -----------------------------------------------------
// 状態変化表示UI（育成中のバトルと同じ見た目・仕様で表示する）
// -----------------------------------------------------
function updateRealtimeStatusEffectUI(state) {
    const el = document.getElementById('player-status-effect-display');
    if (!el) return;

    const me = getRealtimeActiveUnit(state, REALTIME_BATTLE.mySlot);
    const opp = getRealtimeActiveUnit(state, REALTIME_BATTLE.oppSlot);
    if (!me) return;

    let showText = "";
    if (me.isGyakujoActive) {
        showText = "逆上";
    } else if (me.isSokojikaraActive) {
        showText = "底力";
    } else if (me.statusEffect === "闘魂" && opp && opp.guts > 70) {
        showText = "闘魂";
    } else if (me.isShuchuActive) {
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

// -----------------------------------------------------
// 対戦相手にも「HIT」「回避」等の演出が伝わるよう、ログのテキストから
// 育成中のバトルと同じ演出（showEffect / showDamagePopup / animateSprite）を再現する。
// リアルタイム対戦では行動結果がログ文字列としてのみ同期されるため、
// 文字列パターンから何が起きたかを判定し、双方のクライアントで同じ演出を出す。
// -----------------------------------------------------
function triggerRealtimeCombatEffects(entry) {
    if (!REALTIME_BATTLE.active || !entry || !entry.text) return;
    const text = entry.text;
    const isMyAction = entry.actor === REALTIME_BATTLE.mySlot;

    const defenderIcon = isMyAction ? 'battle-enemy-sprite-container' : 'battle-player-sprite-container';
    const defenderPopup = isMyAction ? 'enemy-dmg-popup' : 'player-dmg-popup';

    // ダメージ命中（通常／クリティカル）
    const dmgMatch = text.match(/に\s*(\d+)\s*ダメージ！$/);
    if (dmgMatch) {
        const isCrit = text.includes('クリティカル');
        showEffect(isCrit ? '💥 CRITICAL!! 💥' : (isMyAction ? '💥 HIT! 💥' : '⚡ 被弾!! ⚡'));
        showDamagePopup(defenderPopup, dmgMatch[1], isCrit);
        animateSprite(defenderIcon, 'shake');
        return;
    }

    // 回避（MISS）
    if (text.includes('しかし攻撃はかわされた')) {
        showEffect(isMyAction ? '💨 MISS 💨' : '💨 回避!! 💨');
        showDamagePopup(defenderPopup, 'MISS', false);
        return;
    }

    // 防御コマンド
    if (text.includes('防御の構えを取った')) {
        showEffect('🛡️ DEFENSE 🛡️');
        return;
    }

    // 交代コマンド
    if (text.includes('を引っ込め、【')) {
        showEffect('🔄 交代！ 🔄');
        return;
    }

    // 混乱により行動失敗
    if (text.includes('混乱していて、行動できなかった')) {
        showEffect('❓ 混乱... ❓');
        return;
    }
    // 混乱付与
    if (text.includes('は混乱状態になった')) {
        showEffect('❓ 混乱付与! ❓');
        return;
    }
    // 衰弱付与（ちから・かしこさ低下）
    if (text.includes('が3ターンの間10%低下した')) {
        showEffect('💢 衰弱... 💢');
        return;
    }
    // 次技威力アップ
    if (text.includes('次の技の威力が50%アップした')) {
        showEffect('✨ 威力UP! ✨');
        return;
    }

    // アイテム・技によるライフ回復
    if (/ライフが\s*\d+\s*回復した！$/.test(text)) {
        showEffect(isMyAction ? '🥭 回復! 🥭' : '💚 相手回復! 💚');
        return;
    }
    if (/ライフが\s*\d+\s*回復！$/.test(text)) {
        showEffect(isMyAction ? '💚 ライフ回復! 💚' : '💚 相手回復! 💚');
        return;
    }
    // クリティカル率上昇アイテム
    if (text.includes('クリティカル率が上昇する')) {
        showEffect('🌰 会心UP! 🌰');
        return;
    }
    // ちから・かしこさ上昇アイテム
    if (text.includes('ちから・かしこさが上昇')) {
        showEffect(isMyAction ? '🧪 パワーUP! 🧪' : '💪 相手の攻撃UP! 💪');
        return;
    }
    // ちからUP技
    if (text.includes('闘志がみなぎる') && text.includes('アップした')) {
        showEffect(isMyAction ? '💪 ちからUP! 💪' : '💪 相手の攻撃UP! 💪');
        return;
    }
}

// 根性などの一時的な状態変化の点滅表示（育成中のバトルと同じ演出）
function triggerRealtimeTemporaryStatusEffect(effectName) {
    const el = document.getElementById('player-status-effect-display');
    if (!el) return;
    el.textContent = effectName;
    el.classList.remove('hidden');
    el.dataset.temporaryActive = "true";
    setTimeout(() => {
        delete el.dataset.temporaryActive;
        if (REALTIME_BATTLE.cachedState) updateRealtimeStatusEffectUI(REALTIME_BATTLE.cachedState);
    }, 2500);
}

// -----------------------------------------------------
// 団体戦：チームアイコン表示（個人戦や、片方1体のみの場合は非表示）
// -----------------------------------------------------
function renderRealtimeTeamIcons(state) {
    const mySlot = REALTIME_BATTLE.mySlot;
    const oppSlot = REALTIME_BATTLE.oppSlot;
    const myTeam = state.teams[mySlot];
    const oppTeam = state.teams[oppSlot];
    const isTeam = (state.battleType === 'team') || myTeam.units.length > 1 || oppTeam.units.length > 1;

    const playerIcons = document.getElementById('player-team-icons');
    const enemyIcons = document.getElementById('enemy-team-icons');
    playerIcons.classList.toggle('hidden', !isTeam);
    enemyIcons.classList.toggle('hidden', !isTeam);
    if (!isTeam) return;

    const renderSide = (container, teamObj) => {
        container.innerHTML = '';
        teamObj.units.forEach((unit, idx) => {
            const isFainted = unit.life <= 0;
            const isActive = idx === teamObj.activeIdx;
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

    renderSide(playerIcons, myTeam);
    renderSide(enemyIcons, oppTeam);
}

function renderRealtimeBattleSkills(state) {
    const container = document.getElementById('battle-skills-container');
    container.innerHTML = '';

    const mySlot = REALTIME_BATTLE.mySlot;
    const me = getRealtimeActiveUnit(state, mySlot);
    const isMyTurn = state.status === 'active' && state.turnOwner === mySlot && !REALTIME_BATTLE.actionInProgress;
    const gutsVal = Math.floor(me.guts);

    me.skills.forEach(skKey => {
        const sk = getRealtimeEffectiveSkill(me, skKey);
        if (!sk) return;
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

        const canUse = isMyTurn && gutsVal >= sk.cost;

        // 技強化状態の判定（マスモン登録時に保存された強化データを反映。育成中のバトルと同じ表記にする）
        const enh = me.skillEnhancements && me.skillEnhancements[skKey];
        const isEnhanced = enh && enh.level > 0;
        const enhBorderClass = isEnhanced ? 'border-purple-400 shadow-[0_0_6px_2px_rgba(168,85,247,0.4)]' : style.borderClass;
        const enhBgClass = isEnhanced ? 'bg-[#1e0f3a] hover:bg-[#2a1558]' : style.bgClass;

        const btn = document.createElement('button');
        btn.className = `text-left p-2 rounded border transition-all active:scale-95 flex flex-col justify-between ${enhBgClass} ${enhBorderClass} ${style.textClass} ${canUse ? '' : 'opacity-40 pointer-events-none'}`;
        btn.onclick = () => executeRealtimeSkill(skKey);

        // 技の長押し／右クリックで詳細モーダルを表示（育成中のバトルと同じ操作）
        let longPressTimer;
        btn.ontouchstart = () => {
            longPressTimer = setTimeout(() => {
                openRealtimeSkillModal(skKey, state);
            }, 500);
        };
        btn.ontouchend = () => clearTimeout(longPressTimer);
        btn.onmousedown = (ev) => {
            if (ev.button === 2) {
                openRealtimeSkillModal(skKey, state);
            } else {
                longPressTimer = setTimeout(() => {
                    openRealtimeSkillModal(skKey, state);
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
            : `<span class="${style.textIntensity} text-[9px] font-bold font-mono">命中:${sk.hitRate}%</span>`;

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

    // --- 防御コマンド（技一覧に統合。被ダメ軽減のみ、ガッツ回復量の減は無し） ---
    const defendBtn = document.createElement('button');
    defendBtn.className = `text-left p-2 rounded border transition-all active:scale-95 flex flex-col justify-between bg-blue-950/40 border-blue-700 text-blue-200 ${isMyTurn ? '' : 'opacity-40 pointer-events-none'}`;
    defendBtn.onclick = () => executeRealtimeDefend();
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
    const switchCandidates = getRealtimeSwitchCandidates(state);
    if (switchCandidates.length > 0) {
        const switchBtn = document.createElement('button');
        switchBtn.className = `text-left p-2 rounded border transition-all active:scale-95 flex flex-col justify-between bg-emerald-950/40 border-emerald-700 text-emerald-200 ${isMyTurn ? '' : 'opacity-40 pointer-events-none'}`;
        switchBtn.onclick = () => openRealtimeSwitchMenu(state);
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
function getRealtimeSwitchCandidates(state) {
    const mySlot = REALTIME_BATTLE.mySlot;
    const myTeam = state.teams[mySlot];
    if (!myTeam || myTeam.units.length <= 1) return [];
    return myTeam.units
        .map((unit, idx) => ({ idx, unit }))
        .filter(({ idx, unit }) => idx !== myTeam.activeIdx && unit.life > 0);
}

// --- 交代先選択メニューを技一覧エリアに一時的に表示する ---
function openRealtimeSwitchMenu(state) {
    if (REALTIME_BATTLE.actionInProgress) return;
    const isMyTurn = state.status === 'active' && state.turnOwner === REALTIME_BATTLE.mySlot;
    if (!isMyTurn) return;

    const candidates = getRealtimeSwitchCandidates(state);
    if (candidates.length === 0) return;

    const container = document.getElementById('battle-skills-container');
    container.innerHTML = '';

    candidates.forEach(({ idx, unit }) => {
        const lifePct = Math.max(0, Math.floor((unit.life / unit.maxLife) * 100));
        const btn = document.createElement('button');
        btn.className = `text-left p-2 rounded border transition-all active:scale-95 flex flex-col justify-between bg-emerald-950/40 border-emerald-700 text-emerald-200`;
        btn.onclick = () => executeRealtimeSwitch(idx);
        btn.innerHTML = `
            <div class="flex justify-between items-center w-full">
                <span class="font-bold text-xs">${unit.name}</span>
                <span class="text-[9px] font-bold">HP ${unit.life}/${unit.maxLife} (${lifePct}%)</span>
            </div>
        `;
        container.appendChild(btn);
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.className = `text-left p-2 rounded border transition-all active:scale-95 flex items-center justify-center bg-[#1a120b] border-gray-600 text-gray-300 col-span-2`;
    cancelBtn.onclick = () => renderRealtimeBattleSkills(REALTIME_BATTLE.cachedState);
    cancelBtn.innerHTML = `<span class="font-bold text-xs">↩️ もどる</span>`;
    container.appendChild(cancelBtn);
}

// -----------------------------------------------------
// 技詳細モーダル（リアルタイム対戦用：育成中のバトルと同じ見た目のモーダルを、
// 現在のユニット／強化データに合わせて表示する）
// -----------------------------------------------------
function openRealtimeSkillModal(skKey, state) {
    const me = getRealtimeActiveUnit(state, REALTIME_BATTLE.mySlot);
    const opp = getRealtimeActiveUnit(state, REALTIME_BATTLE.oppSlot);
    if (!me) return;
    const sk = getRealtimeEffectiveSkill(me, skKey);
    if (!sk) return;

    const currentGuts = Math.floor(me.guts);
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
        } else if (opp) {
            let actualHit = Math.max(10, Math.min(99, (sk.hitRate + mods.hitMod) + (me.hit - opp.spd) * 0.5));
            if (me.isShuchuActive) actualHit = Math.min(99, actualHit * 1.5);
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

function renderRealtimeBattleItems(state) {
    const container = document.getElementById('battle-items-container');
    const mySlot = REALTIME_BATTLE.mySlot;
    const counts = state.items[mySlot] || { mango: 0, kuri: 0, toro: 0 };
    const initial = state.itemsInitial ? state.itemsInitial[mySlot] : counts;
    const broughtKeys = Object.keys(MASMON_ITEM_DB).filter(key => (initial[key] || 0) > 0);
    const isMyTurn = state.status === 'active' && state.turnOwner === mySlot && !REALTIME_BATTLE.actionInProgress;

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
        if (remaining <= 0 || !isMyTurn) {
            btn.classList.add('opacity-40', 'pointer-events-none');
        }
        btn.onclick = () => executeRealtimeItem(key);
        container.appendChild(btn);
    });
}

// -----------------------------------------------------
// 行動実行（技・防御・アイテム共通の同期処理）
// 行動した側のクライアントが結果を計算し、transactionで書き込む。
// 相手側はlistenerで結果を受け取るだけで、二重計算は行わない。
// 団体戦では、行動の結果いずれかの場のユニットが戦闘不能になった場合、
// この同じtransaction内で次の生存ユニットへの自動交代・全滅判定まで行う。
// -----------------------------------------------------
function executeRealtimeSkill(skKey) {
    performRealtimeAction({ kind: 'skill', key: skKey });
}
function executeRealtimeDefend() {
    performRealtimeAction({ kind: 'defend' });
}
function executeRealtimeItem(itemKey) {
    performRealtimeAction({ kind: 'item', key: itemKey });
}
function executeRealtimeSwitch(targetIdx) {
    performRealtimeAction({ kind: 'switch', targetIdx: targetIdx });
}

// --- チーム内で最初に見つかる生存ユニットのインデックスを返す（いなければ-1） ---
function findFirstAliveIdx(teamObj) {
    for (let i = 0; i < teamObj.units.length; i++) {
        if (teamObj.units[i].life > 0) return i;
    }
    return -1;
}

async function performRealtimeAction(action) {
    if (!REALTIME_BATTLE.active || REALTIME_BATTLE.actionInProgress) return;
    const cached = REALTIME_BATTLE.cachedState;
    if (!cached || cached.status !== 'active' || cached.turnOwner !== REALTIME_BATTLE.mySlot) return;

    const mySlot = REALTIME_BATTLE.mySlot;
    const oppSlot = REALTIME_BATTLE.oppSlot;
    const stateRef = REALTIME_BATTLE.ref.child('battleState');
    const logRef = REALTIME_BATTLE.ref.child('battleLog');

    REALTIME_BATTLE.actionInProgress = true;
    toggleMasmonSkillButtons(false);

    let resultLogs = [];
    let committedTurnNumber = cached.turnNumber || 1;

    try {
        const txResult = await stateRef.transaction(current => {
            if (!current || current.status !== 'active' || current.turnOwner !== mySlot) return; // abort：既に状況が変わっている

            resultLogs = [];
            const myTeam = current.teams[mySlot];
            const oppTeam = current.teams[oppSlot];
            const me = myTeam.units[myTeam.activeIdx];
            const opp = oppTeam.units[oppTeam.activeIdx];
            const myItems = current.items[mySlot];

            // 混乱状態（サケビ声などで受けた場合）：このターンは何を選んでも行動に失敗する
            if (me.isConfusedThisTurn) {
                me.isConfusedThisTurn = false;
                resultLogs.push(`❓ ${me.name} は混乱していて、行動できなかった！`);
            } else if (action.kind === 'skill') {
                const rawSk = SKILLS_DB[action.key];
                if (!rawSk || !me.skills.includes(action.key) || me.guts < rawSk.cost) return; // abort：無効な行動
                const sk = getRealtimeEffectiveSkill(me, action.key);
                const mods = getGutsModifiers(me.guts);
                me.guts -= sk.cost;
                resultLogs.push(`${me.name} の【${sk.name}】！`);

                if (sk.type === 'pow' || sk.type === 'int') {
                    const isCertain = sk.hitRate === 100;
                    let hitChance = isCertain ? 100 : Math.max(10, Math.min(99, (sk.hitRate + mods.hitMod) + (me.hit - opp.spd) * 0.5));
                    if (me.isShuchuActive && !isCertain) {
                        hitChance = Math.min(99, hitChance * 1.5);
                    }
                    let isHit;
                    let isGuaranteedDodge = false;
                    if (opp.dodgeNextGuaranteed) {
                        isHit = false;
                        isGuaranteedDodge = true;
                        opp.dodgeNextGuaranteed = false;
                    } else {
                        isHit = isCertain || (Math.random() * 100 < hitChance);
                    }

                    // 次技威力アップ（オーロラゲート等）の消費は命中判定に関わらず技を撃った時点で消費する
                    const usedForce = consumeForceBoost(me, sk.force);

                    if (isHit) {
                        const isPow = sk.type === 'pow';
                        const attackerStat = getWeakenedStat(me, isPow ? me.pow : me.int);
                        const defenderStat = opp.def;
                        const statCap = Math.max(30, defenderStat * 2.5);
                        const effectiveAttacker = attackerStat > statCap ? statCap + (attackerStat - statCap) * 0.2 : attackerStat;
                        const defenderGutsDefenseMod = getGutsDefenseModifier(opp.guts);
                        const rawDmg = (effectiveAttacker * usedForce * mods.dmgMod) - (defenderStat * 0.35);
                        let damage = Math.floor(Math.max(10, (rawDmg * (0.9 + Math.random() * 0.2)) * defenderGutsDefenseMod));

                        if (me.isSokojikaraActive) {
                            damage = Math.floor(damage * 1.5);
                        }
                        if (me.isShuchuActive) {
                            damage = Math.floor(damage * 1.2);
                        }
                        if (me.permaForceBoostActive) {
                            damage = Math.floor(damage * 1.2);
                        }

                        const critChance = 0.10 + (me.critBonusTurns > 0 ? 0.25 : 0);
                        const isCrit = Math.random() < critChance;
                        if (isCrit) damage = Math.floor(damage * 1.5);

                        if (opp.isDefending) {
                            damage = Math.floor(damage / 2);
                            resultLogs.push(`${opp.name} は防御の構えでダメージを半減した！`);
                        }

                        damage = Math.max(1, Math.floor(damage * MASMON_BATTLE_DAMAGE_MULTIPLIER));

                        // 九重神眼等のシールドによる被ダメージ吸収
                        const shieldResult = applyShieldAbsorption(opp, damage);
                        damage = shieldResult.finalDamage;

                        opp.life = Math.max(0, opp.life - damage);
                        resultLogs.push(isCrit ? `★クリティカル！ ${opp.name} に ${damage} ダメージ！` : `${opp.name} に ${damage} ダメージ！`);
                        if (shieldResult.absorbed > 0) {
                            resultLogs.push(`🛡️ ${opp.name} のシールドが ${shieldResult.absorbed} のダメージを吸収した！(シールド残量: ${opp.shieldValue})`);
                        }

                        // 根性・底力の発動判定（ダメージを受けた側）
                        if (opp.life === 0 && opp.statusEffect === "根性") {
                            if (Math.random() < 0.50) {
                                opp.life = 1;
                                resultLogs.push(`✨ 根性が発動！ ${opp.name} は力尽きず、ライフ 1 で耐え抜いた！`);
                            }
                        }
                        if (opp.statusEffect === "底力" && !opp.isSokojikaraFired) {
                            if (opp.life > 0 && opp.life < opp.maxLife * 0.3) {
                                opp.isSokojikaraFired = true;
                                opp.isSokojikaraActive = true;
                                resultLogs.push(`💪 底力が発動！ ${opp.name} は窮地に陥り、次の技のダメージが 1.5 倍に上昇！`);
                            }
                        }

                        let finalGutsDown = sk.gutsDown || 0;
                        if (me.isGyakujoActive && finalGutsDown > 0) {
                            finalGutsDown = Math.floor(finalGutsDown * 1.2);
                        }
                        if (finalGutsDown > 0) {
                            const actualGutsDown = Math.min(opp.guts, finalGutsDown);
                            opp.guts = Math.max(0, opp.guts - actualGutsDown);
                            if (actualGutsDown > 0) {
                                resultLogs.push(`相手のガッツを ${actualGutsDown} 奪った！(現在: ${Math.floor(opp.guts)})`);
                                // 逆上の発動判定（ガッツを奪われた側）
                                if (opp.statusEffect === "逆上" && !opp.isGyakujoActive && Math.random() < 0.65) {
                                    opp.isGyakujoActive = true;
                                    resultLogs.push(`💢 逆上が発動！ ${opp.name} のガッツ回復速度と与えるガッツダウン量が 1.2 倍に上昇！`);
                                }
                            }
                        }

                        // モノリスの技等が持つ追加効果（衰弱／混乱付与／次技威力アップ）
                        applySkillOnHitEffect(me, opp, sk).forEach(msg => resultLogs.push(msg));

                        // プラントの「ドレイン」等：与えたダメージの一部を自身のライフに変換
                        const drainHeal = getDrainHealAmount(sk, damage);
                        if (drainHeal > 0) {
                            me.life = Math.min(me.maxLife, me.life + drainHeal);
                            resultLogs.push(`🌿 ${me.name} は相手の生命力を吸収し、ライフが ${drainHeal} 回復した！`);
                        }

                        me.isSokojikaraActive = false;
                        me.isShuchuActive = false;
                    } else {
                        if (isGuaranteedDodge) {
                            resultLogs.push(`🌫️ ${opp.name} は陽炎の効果で攻撃を確実に回避した！`);
                        } else {
                            resultLogs.push(`しかし攻撃はかわされた！`);
                        }
                    }
                } else if (sk.type === 'buff_pow') {
                    me.pow += 15;
                    resultLogs.push(`${me.name} の闘志がみなぎる！ちからが15アップした！`);
                } else if (sk.type === 'heal') {
                    const healAmount = Math.floor(me.maxLife * 0.35);
                    me.life = Math.min(me.maxLife, me.life + healAmount);
                    resultLogs.push(`${me.name} は癒された！ライフが ${healAmount} 回復！`);
                }
            } else if (action.kind === 'defend') {
                me.isDefending = true;
                resultLogs.push(`${me.name} は身を守るため防御の構えを取った！（被ダメ半減／ガッツ回復ペナルティ無し）`);
            } else if (action.kind === 'switch') {
                const targetIdx = action.targetIdx;
                const target = myTeam.units[targetIdx];
                if (!target || targetIdx === myTeam.activeIdx || target.life <= 0) return; // abort：無効な交代先
                const prevName = me.name;
                myTeam.activeIdx = targetIdx;
                resultLogs.push(`${prevName} を引っ込め、【${target.name}】を繰り出した！`);
            } else if (action.kind === 'item') {
                const key = action.key;
                if (!myItems || !myItems[key] || myItems[key] <= 0) return; // abort：アイテム切れ
                myItems[key]--;
                const item = MASMON_ITEM_DB[key];
                if (key === 'mango') {
                    const heal = Math.floor(me.maxLife * 0.25);
                    me.life = Math.min(me.maxLife, me.life + heal);
                    resultLogs.push(`🥭 ${me.name} は【${item.name}】を使った！ライフが ${heal} 回復した！`);
                } else if (key === 'kuri') {
                    me.critBonusTurns = 3;
                    resultLogs.push(`🌰 ${me.name} は【${item.name}】を使った！3ターンの間クリティカル率が上昇する！`);
                } else if (key === 'toro') {
                    me.pow += 20;
                    me.int += 20;
                    const selfDmg = Math.floor(me.maxLife * 0.3);
                    me.life = Math.max(0, me.life - selfDmg);
                    resultLogs.push(`🧪 ${me.name} は【${item.name}】を使った！ちから・かしこさが上昇したが、反動で ${selfDmg} のダメージを受けた！`);
                }
            } else {
                return; // abort：不明な行動
            }

            // --- 戦闘不能判定＆自動交代（団体戦） ---
            let battleOver = false;
            const oppOwnerLabel = current.ownerNames ? current.ownerNames[oppSlot] : '相手';

            if (opp.life <= 0) {
                resultLogs.push(`💥 ${opp.name} は戦闘不能になった！`);
                const nextIdx = findFirstAliveIdx(oppTeam);
                if (nextIdx === -1) {
                    current.status = 'finished';
                    current.winner = mySlot;
                    current.winReason = 'ko';
                    resultLogs.push(`${me.name} の勝利！`);
                    battleOver = true;
                } else {
                    oppTeam.activeIdx = nextIdx;
                    const newOpp = oppTeam.units[nextIdx];
                    resultLogs.push(`${oppOwnerLabel} は【${newOpp.name}】を繰り出した！`);
                }
            }

            if (!battleOver && me.life <= 0) {
                resultLogs.push(`💥 ${me.name} は戦闘不能になった…`);
                const nextIdx = findFirstAliveIdx(myTeam);
                if (nextIdx === -1) {
                    current.status = 'finished';
                    current.winner = oppSlot;
                    current.winReason = 'ko';
                    battleOver = true;
                } else {
                    myTeam.activeIdx = nextIdx;
                    const newMe = myTeam.units[nextIdx];
                    resultLogs.push(`【${newMe.name}】を繰り出した！`);
                }
            }

            if (!battleOver) {
                // --- ターン交代：次に行動する相手側（場に出ているユニット）のガッツ回復・状態リセット ---
                const oppNowActive = oppTeam.units[oppTeam.activeIdx];
                if (oppNowActive.critBonusTurns > 0) oppNowActive.critBonusTurns--;
                oppNowActive.isDefending = false;
                // 衰弱・混乱の残ターン消化（混乱は次に行動を試みた時点で判定に使うフラグとして保存する）
                if (oppNowActive.weakenTurns > 0) oppNowActive.weakenTurns--;
                if (oppNowActive.confuseTurns > 0) {
                    oppNowActive.confuseTurns--;
                    oppNowActive.isConfusedThisTurn = Math.random() < 0.30;
                } else {
                    oppNowActive.isConfusedThisTurn = false;
                }
                let recovery = 30;
                if (oppNowActive.isGyakujoActive) {
                    recovery = Math.floor(recovery * 1.2);
                }
                if (oppNowActive.statusEffect === "闘魂" && myTeam.units[myTeam.activeIdx].guts > 70) {
                    recovery = Math.floor(recovery * 1.5);
                }
                oppNowActive.guts = Math.min(100, oppNowActive.guts + recovery);
                if (oppNowActive.statusEffect === "集中" && oppNowActive.guts > 90 && !oppNowActive.isShuchuActive) {
                    oppNowActive.isShuchuActive = true;
                    resultLogs.push(`🎯 ${oppNowActive.name} に集中が発動！次の技の命中率・ダメージが上昇！`);
                }
                current.turnOwner = oppSlot;
                current.turnNumber = (current.turnNumber || 1) + 1;
            }
            current.lastActionAt = Date.now();
            return current;
        });

        if (!txResult.committed || !txResult.snapshot.exists()) {
            showToast('その行動は選択できませんでした（タイミングがずれた可能性があります）。');
        } else {
            committedTurnNumber = txResult.snapshot.val().turnNumber || committedTurnNumber;
            for (const text of resultLogs) {
                await logRef.push({ turn: committedTurnNumber, actor: mySlot, text, ts: Date.now() });
            }
        }
    } catch (e) {
        console.error('[Firebase] リアルタイム行動エラー:', e);
        showToast('通信エラーが発生しました。');
    } finally {
        REALTIME_BATTLE.actionInProgress = false;
    }
}

// -----------------------------------------------------
// 切断検知（60秒応答無しで不戦勝を宣言できる）
// -----------------------------------------------------
function checkOpponentDisconnect() {
    if (!REALTIME_BATTLE.active) return;
    const state = REALTIME_BATTLE.cachedState;
    if (!state || state.status !== 'active') return;
    if (state.turnOwner !== REALTIME_BATTLE.oppSlot) return; // 自分のターン中は判定しない

    const age = Date.now() - (REALTIME_BATTLE.oppLastSeen || 0);
    const banner = document.getElementById('realtime-disconnect-banner');
    if (REALTIME_BATTLE.oppLastSeen > 0 && age > REALTIME_DISCONNECT_TIMEOUT_MS) {
        banner.classList.remove('hidden');
    } else {
        banner.classList.add('hidden');
    }
}

async function claimRealtimeDisconnectVictory() {
    if (!REALTIME_BATTLE.active) return;
    const mySlot = REALTIME_BATTLE.mySlot;
    const oppSlot = REALTIME_BATTLE.oppSlot;
    const stateRef = REALTIME_BATTLE.ref.child('battleState');

    try {
        const txResult = await stateRef.transaction(current => {
            if (!current || current.status !== 'active' || current.turnOwner !== oppSlot) return;
            current.status = 'finished';
            current.winner = mySlot;
            current.winReason = 'disconnect';
            current.lastActionAt = Date.now();
            return current;
        });
        if (!txResult.committed) {
            showToast('相手が行動を再開したようです。');
        }
    } catch (e) {
        console.error('[Firebase] 不戦勝判定エラー:', e);
        showToast('通信エラーが発生しました。');
    }
}

// -----------------------------------------------------
// 投了
// -----------------------------------------------------
async function surrenderRealtimeBattle() {
    if (!REALTIME_BATTLE.active) return;
    if (!confirm('投了すると敗北になります。よろしいですか？')) return;

    const mySlot = REALTIME_BATTLE.mySlot;
    const oppSlot = REALTIME_BATTLE.oppSlot;
    const stateRef = REALTIME_BATTLE.ref.child('battleState');

    try {
        await stateRef.transaction(current => {
            if (!current || current.status !== 'active') return;
            current.status = 'finished';
            current.winner = oppSlot;
            current.winReason = 'surrender';
            current.lastActionAt = Date.now();
            return current;
        });
    } catch (e) {
        console.error('[Firebase] 投了エラー:', e);
        showToast('通信エラーが発生しました。');
    }
}

// -----------------------------------------------------
// バトル終了処理
// -----------------------------------------------------
function handleRealtimeBattleEnd(state) {
    if (!REALTIME_BATTLE.active) return; // 二重処理防止
    REALTIME_BATTLE.active = false;

    detachRealtimeBattleListeners();

    const mySlot = REALTIME_BATTLE.mySlot;
    const isWin = state.winner === mySlot;
    const reasonText = state.winReason === 'disconnect' ? '（相手の通信切断による不戦勝）'
        : state.winReason === 'surrender' ? (isWin ? '（相手の投了）' : '（投了）')
        : '';

    showEffect(isWin ? '🏆 WIN!! 🏆' : '💀 LOSE... 💀');
    setTimeout(() => showRealtimeBattleResult(state, isWin, reasonText), 1200);
}

function showRealtimeBattleResult(state, isWin, reasonText) {
    ACTIVE_BATTLE_MODE = 'adventure';

    const mySlot = REALTIME_BATTLE.mySlot;
    const oppSlot = REALTIME_BATTLE.oppSlot;
    const myTeam = state.teams[mySlot];
    const oppTeam = state.teams[oppSlot];
    const me = myTeam.units[myTeam.activeIdx];
    const opp = oppTeam.units[oppTeam.activeIdx];
    const oppOwnerName = state.ownerNames ? state.ownerNames[oppSlot] : '対戦相手';
    const isTeam = state.battleType === 'team';

    const myNames = myTeam.units.map(u => u.name).join('、');
    const oppNames = oppTeam.units.map(u => u.name).join('、');

    const badge = document.getElementById('masmon-result-badge');
    const title = document.getElementById('masmon-result-title');
    const subtitle = document.getElementById('masmon-result-subtitle');
    const detail = document.getElementById('masmon-result-detail');

    if (isWin) {
        badge.textContent = '🏆';
        title.textContent = 'VICTORY!';
        title.className = 'text-2xl font-black text-amber-500 pixel-font';
        subtitle.textContent = isTeam
            ? `【${myNames}】のチームが【${oppOwnerName}】のチームを打ち破った！${reasonText}`
            : `【${me.name}】が【${oppOwnerName}】の【${opp.name}】を倒した！${reasonText}`;
    } else {
        badge.textContent = '💀';
        title.textContent = 'DEFEAT...';
        title.className = 'text-2xl font-black text-red-500 pixel-font';
        subtitle.textContent = isTeam
            ? `【${myNames}】のチームは【${oppOwnerName}】のチームに敗れた…${reasonText}`
            : `【${me.name}】は【${oppOwnerName}】の【${opp.name}】に敗れた…${reasonText}`;
    }

    const survivedTeam = isWin ? myTeam : oppTeam;
    const survivedCount = survivedTeam.units.filter(u => u.life > 0).length;

    detail.innerHTML = `
        <div class="text-xs text-sky-300 font-bold border-b border-sky-800 pb-1 mb-1">リアルタイム${isTeam ? '団体戦' : '対戦'}結果</div>
        <div class="flex justify-between text-xs"><span class="text-gray-400">あなたの${isTeam ? 'チーム' : 'マスモン'}:</span><span class="text-white font-bold">${myNames}</span></div>
        <div class="flex justify-between text-xs"><span class="text-gray-400">対戦相手:</span><span class="text-white font-bold">${oppOwnerName} の ${oppNames}</span></div>
        ${isTeam ? `<div class="flex justify-between text-xs"><span class="text-gray-400">生存数:</span><span class="text-white font-bold">${survivedCount}/${survivedTeam.units.length}</span></div>` : ''}
        <div class="flex justify-between text-xs"><span class="text-gray-400">経過ターン数:</span><span class="text-white font-bold">${state.turnNumber || 1}</span></div>
    `;

    // 使用済みのバトルルームを片付ける（相手が先に退出済みでも問題無い）
    if (REALTIME_BATTLE.ref) {
        REALTIME_BATTLE.ref.remove().catch(() => {});
    }
    resetRealtimeBattleClientState();
    resetRealtimeRoomState();

    changeScreen('screen-masmon-battle-result');
}

// -----------------------------------------------------
// リスナー・タイマーの後始末
// -----------------------------------------------------
function detachRealtimeBattleListeners() {
    if (REALTIME_BATTLE.ref) {
        if (REALTIME_BATTLE.stateListener) REALTIME_BATTLE.ref.child('battleState').off('value', REALTIME_BATTLE.stateListener);
        if (REALTIME_BATTLE.logListener) REALTIME_BATTLE.ref.child('battleLog').off('child_added', REALTIME_BATTLE.logListener);
        if (REALTIME_BATTLE.oppLastSeenListener) REALTIME_BATTLE.ref.child(`${REALTIME_BATTLE.oppSlot}/lastSeen`).off('value', REALTIME_BATTLE.oppLastSeenListener);
    }
    if (REALTIME_BATTLE.disconnectTimer) {
        clearInterval(REALTIME_BATTLE.disconnectTimer);
        REALTIME_BATTLE.disconnectTimer = null;
    }
}

function resetRealtimeBattleClientState() {
    detachRealtimeBattleListeners();
    REALTIME_BATTLE.active = false;
    REALTIME_BATTLE.ref = null;
    REALTIME_BATTLE.keyword = null;
    REALTIME_BATTLE.mySlot = null;
    REALTIME_BATTLE.oppSlot = null;
    REALTIME_BATTLE.stateListener = null;
    REALTIME_BATTLE.logListener = null;
    REALTIME_BATTLE.oppLastSeenListener = null;
    REALTIME_BATTLE.oppLastSeen = 0;
    REALTIME_BATTLE.cachedState = null;
    REALTIME_BATTLE.actionInProgress = false;
    REALTIME_BATTLE.seenLogKeys = {};

    document.getElementById('battle-endturn-controls').classList.remove('hidden');
    document.getElementById('realtime-surrender-btn').classList.add('hidden');
    document.getElementById('realtime-turn-indicator').classList.add('hidden');
    document.getElementById('realtime-disconnect-banner').classList.add('hidden');
    document.getElementById('player-team-icons').classList.add('hidden');
    document.getElementById('player-team-icons').innerHTML = '';
    document.getElementById('enemy-team-icons').classList.add('hidden');
    document.getElementById('enemy-team-icons').innerHTML = '';
    const rtBattleItemsEl = document.getElementById('battle-items-container');
    rtBattleItemsEl.classList.add('hidden');
    rtBattleItemsEl.innerHTML = '';
    const beginBtn = document.getElementById('realtime-begin-battle-btn');
    if (beginBtn) {
        beginBtn.disabled = false;
        beginBtn.textContent = '⚔️ バトル開始';
    }
}
