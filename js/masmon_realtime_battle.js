// =====================================================
// マスモン リアルタイム対戦：ターン同期バトルロジック（フェーズ⑤）
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
        monsterBaseName: masmon.monsterBaseName,
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
        skills: [...(masmon.skills || [])]
    };
}

function buildInitialRealtimeBattleState(roomData) {
    const p1Unit = convertRoomMasmonToRealtimeUnit(roomData.player1.masmon);
    const p2Unit = convertRoomMasmonToRealtimeUnit(roomData.player2.masmon);
    const turnOwner = p2Unit.spd > p1Unit.spd ? 'player2' : 'player1';

    const p1Items = roomData.player1.items || { mango: 0, kuri: 0, toro: 0 };
    const p2Items = roomData.player2.items || { mango: 0, kuri: 0, toro: 0 };

    return {
        status: 'active',
        turnOwner: turnOwner,
        turnNumber: 1,
        winner: null,
        winReason: null,
        ownerNames: {
            player1: roomData.player1.name || 'ブリーダー1',
            player2: roomData.player2.name || 'ブリーダー2'
        },
        units: { player1: p1Unit, player2: p2Unit },
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
        if (entry && entry.text) addLog(entry.text);
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
    document.getElementById('player-team-icons').classList.add('hidden');
    document.getElementById('enemy-team-icons').classList.add('hidden');
    document.getElementById('realtime-disconnect-banner').classList.add('hidden');

    const oppName = state.ownerNames ? state.ownerNames[REALTIME_BATTLE.oppSlot] : '対戦相手';
    document.getElementById('battle-floor-indicator').textContent = `🌐 リアルタイム対戦 vs ${oppName}`;

    const log = document.getElementById('battle-log');
    log.innerHTML = `<div>マッチング成立！ ${state.units.player1.name} と ${state.units.player2.name} のバトル開始！</div>`;

    changeScreen('screen-battle');
}

// -----------------------------------------------------
// 画面描画
// -----------------------------------------------------
function renderRealtimeBattleUI(state) {
    if (!REALTIME_BATTLE.active) return;

    const mySlot = REALTIME_BATTLE.mySlot;
    const oppSlot = REALTIME_BATTLE.oppSlot;
    const me = state.units[mySlot];
    const opp = state.units[oppSlot];
    const oppOwnerName = state.ownerNames ? state.ownerNames[oppSlot] : '対戦相手';
    const isMyTurn = state.status === 'active' && state.turnOwner === mySlot;

    document.getElementById('battle-turn-counter').textContent = state.turnNumber || 1;

    document.getElementById('enemy-name').textContent = `${opp.name}（${oppOwnerName}）`;
    renderMonsterVisual(document.getElementById('battle-enemy-icon'), opp.name, opp.emoji, false);
    document.getElementById('battle-enemy-type').textContent = opp.name;
    document.getElementById('enemy-hp-text').textContent = `HP: ${opp.life}/${opp.maxLife}`;
    document.getElementById('enemy-hp-bar').style.width = `${Math.max(0, (opp.life / opp.maxLife) * 100)}%`;
    document.getElementById('enemy-guts-text').textContent = Math.floor(opp.guts);
    document.getElementById('enemy-guts-bar').style.width = `${opp.guts}%`;

    renderMonsterVisual(document.getElementById('battle-player-icon'), me.name, me.emoji, false);
    document.getElementById('battle-player-name').textContent = me.name;
    document.getElementById('player-hp-text').textContent = `${me.life}/${me.maxLife}`;
    document.getElementById('player-hp-bar').style.width = `${Math.max(0, (me.life / me.maxLife) * 100)}%`;
    document.getElementById('guts-number').textContent = Math.floor(me.guts);
    document.getElementById('guts-progress-bar').style.width = `${me.guts}%`;

    document.getElementById('player-defense-shield').classList.toggle('hidden', !me.isDefending);

    const turnIndicator = document.getElementById('realtime-turn-indicator');
    if (state.status === 'active') {
        turnIndicator.textContent = isMyTurn ? '🟢 あなたのターン' : '🔴 相手のターン';
        turnIndicator.className = `text-white font-bold text-[9px] px-1.5 py-0.5 rounded ${isMyTurn ? 'bg-emerald-700' : 'bg-red-900'}`;
    } else {
        turnIndicator.classList.add('hidden');
    }

    const recoveryVal = Math.floor((me.gutsSpeed || 14) + 30);
    document.getElementById('turn-guts-notice').textContent = isMyTurn
        ? `💡 あなたのターンです！行動を選んでください（GUTS回復:+${recoveryVal}）`
        : `⏳ 対戦相手の行動を待っています…`;

    renderRealtimeBattleSkills(state);
    renderRealtimeBattleItems(state);

    // 相手のターンが続いている間だけ切断バナーの判定対象にする
    if (isMyTurn || state.status !== 'active') {
        document.getElementById('realtime-disconnect-banner').classList.add('hidden');
    }
}

function renderRealtimeBattleSkills(state) {
    const container = document.getElementById('battle-skills-container');
    container.innerHTML = '';

    const mySlot = REALTIME_BATTLE.mySlot;
    const me = state.units[mySlot];
    const isMyTurn = state.status === 'active' && state.turnOwner === mySlot && !REALTIME_BATTLE.actionInProgress;
    const gutsVal = Math.floor(me.guts);

    me.skills.forEach(skKey => {
        const sk = SKILLS_DB[skKey];
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
        const btn = document.createElement('button');
        btn.className = `text-left p-2 rounded border transition-all active:scale-95 flex flex-col justify-between ${style.bgClass} ${style.borderClass} ${style.textClass} ${canUse ? '' : 'opacity-40 pointer-events-none'}`;
        btn.onclick = () => executeRealtimeSkill(skKey);

        let typeIcon = '💥';
        if (sk.type === 'int') typeIcon = '🔮';
        if (sk.type.startsWith('buff')) typeIcon = '⭐';
        if (sk.type === 'heal') typeIcon = '💖';

        const hitRateDisplay = (sk.type === 'heal' || sk.type.startsWith('buff'))
            ? `<span class="text-emerald-700 text-[9px] font-bold">必中</span>`
            : `<span class="${style.textIntensity} text-[9px] font-bold font-mono">命中:${sk.hitRate}%</span>`;

        btn.innerHTML = `
            <div class="flex justify-between items-center w-full">
                <span class="font-bold text-xs">${sk.name} ${typeIcon} <span class="ml-1 text-[10px] ${rankColor} bg-[#1a120b]/10 px-1 py-0.2 rounded">ランク:${rank}</span></span>
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
            const me = current.units[mySlot];
            const opp = current.units[oppSlot];
            const myItems = current.items[mySlot];

            if (action.kind === 'skill') {
                const sk = SKILLS_DB[action.key];
                if (!sk || !me.skills.includes(action.key) || me.guts < sk.cost) return; // abort：無効な行動
                const mods = getGutsModifiers(me.guts);
                me.guts -= sk.cost;
                resultLogs.push(`${me.name} の【${sk.name}】！`);

                if (sk.type === 'pow' || sk.type === 'int') {
                    const isCertain = sk.hitRate === 100;
                    const hitChance = isCertain ? 100 : Math.max(10, Math.min(99, (sk.hitRate + mods.hitMod) + (me.hit - opp.spd) * 0.5));
                    const isHit = isCertain || (Math.random() * 100 < hitChance);

                    if (isHit) {
                        const isPow = sk.type === 'pow';
                        const attackerStat = isPow ? me.pow : me.int;
                        const defenderStat = opp.def;
                        const statCap = Math.max(30, defenderStat * 2.5);
                        const effectiveAttacker = attackerStat > statCap ? statCap + (attackerStat - statCap) * 0.2 : attackerStat;
                        const defenderGutsDefenseMod = getGutsDefenseModifier(opp.guts);
                        const rawDmg = (effectiveAttacker * sk.force * mods.dmgMod) - (defenderStat * 0.35);
                        let damage = Math.floor(Math.max(10, (rawDmg * (0.9 + Math.random() * 0.2)) * defenderGutsDefenseMod));

                        const critChance = 0.10 + (me.critBonusTurns > 0 ? 0.25 : 0);
                        const isCrit = Math.random() < critChance;
                        if (isCrit) damage = Math.floor(damage * 1.5);

                        if (opp.isDefending) {
                            damage = Math.floor(damage / 2);
                            resultLogs.push(`${opp.name} は防御の構えでダメージを半減した！`);
                        }

                        opp.life = Math.max(0, opp.life - damage);
                        resultLogs.push(isCrit ? `★クリティカル！ ${opp.name} に ${damage} ダメージ！` : `${opp.name} に ${damage} ダメージ！`);

                        if (sk.gutsDown > 0) {
                            const actualGutsDown = Math.min(opp.guts, sk.gutsDown);
                            opp.guts = Math.max(0, opp.guts - actualGutsDown);
                            if (actualGutsDown > 0) resultLogs.push(`相手のガッツを ${actualGutsDown} 奪った！(現在: ${Math.floor(opp.guts)})`);
                        }
                    } else {
                        resultLogs.push(`しかし攻撃はかわされた！`);
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

            // --- 決着判定 ---
            if (opp.life <= 0) {
                current.status = 'finished';
                current.winner = mySlot;
                current.winReason = 'ko';
                resultLogs.push(`💥 ${opp.name} は戦闘不能になった！${me.name} の勝利！`);
            } else if (me.life <= 0) {
                current.status = 'finished';
                current.winner = oppSlot;
                current.winReason = 'ko';
                resultLogs.push(`💥 ${me.name} は戦闘不能になった…`);
            } else {
                // --- ターン交代：次の相手のガッツ回復・クリティカル効果減少・防御解除 ---
                if (opp.critBonusTurns > 0) opp.critBonusTurns--;
                opp.isDefending = false;
                const recovery = Math.floor((opp.gutsSpeed || 14) + 30);
                opp.guts = Math.min(100, opp.guts + recovery);
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
    const me = state.units[mySlot];
    const opp = state.units[oppSlot];
    const oppOwnerName = state.ownerNames ? state.ownerNames[oppSlot] : '対戦相手';

    const badge = document.getElementById('masmon-result-badge');
    const title = document.getElementById('masmon-result-title');
    const subtitle = document.getElementById('masmon-result-subtitle');
    const detail = document.getElementById('masmon-result-detail');

    if (isWin) {
        badge.textContent = '🏆';
        title.textContent = 'VICTORY!';
        title.className = 'text-2xl font-black text-amber-500 pixel-font';
        subtitle.textContent = `【${me.name}】が【${oppOwnerName}】の【${opp.name}】を倒した！${reasonText}`;
    } else {
        badge.textContent = '💀';
        title.textContent = 'DEFEAT...';
        title.className = 'text-2xl font-black text-red-500 pixel-font';
        subtitle.textContent = `【${me.name}】は【${oppOwnerName}】の【${opp.name}】に敗れた…${reasonText}`;
    }

    detail.innerHTML = `
        <div class="text-xs text-sky-300 font-bold border-b border-sky-800 pb-1 mb-1">リアルタイム対戦結果</div>
        <div class="flex justify-between text-xs"><span class="text-gray-400">あなたのマスモン:</span><span class="text-white font-bold">${me.name}</span></div>
        <div class="flex justify-between text-xs"><span class="text-gray-400">対戦相手:</span><span class="text-white font-bold">${oppOwnerName} の ${opp.name}</span></div>
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
    const beginBtn = document.getElementById('realtime-begin-battle-btn');
    if (beginBtn) {
        beginBtn.disabled = false;
        beginBtn.textContent = '⚔️ バトル開始';
    }
}
