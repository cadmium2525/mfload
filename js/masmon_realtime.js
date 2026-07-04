// =====================================================
// マスモン リアルタイム対戦：マッチング基盤（フェーズ4、フェーズ⑥で団体戦対応）
// Firebase Realtime Database: battle_rooms/{keyword}
//
// このファイルが担当する範囲:
//   ・2人のブリーダーが同じ「合言葉」を入力してルームを作成／参加する
//   ・待機中ルームはキャンセルされるまで残り続ける
//   ・マッチング成立後の土台（プレイヤー情報の同期・生存確認用ハートビート）
//   ・個人戦（1体）／団体戦（最大3体）どちらの持ち込み編成にも対応（フェーズ⑥）
//
// 実際のターン制バトル同期ロジック（1行動→相手ターン、防御の技一覧統合、
// 団体戦の交代処理など）は battle_rooms/{keyword}/battleState 以下、
// js/masmon_realtime_battle.js で実装している。
// =====================================================

const REALTIME_HEARTBEAT_INTERVAL_MS = 15000;   // 15秒ごとに生存通知
const REALTIME_DISCONNECT_TIMEOUT_MS = 60000;   // 対戦中60秒無応答で不戦勝

let realtimeRoomKeyword = null;
let realtimeRoomRef = null;
let realtimeRoomListener = null;
let realtimeMySlot = null;      // 'player1' | 'player2'
let realtimeHeartbeatTimer = null;
let realtimePendingTeam = [];   // 持ち込みマスモン配列（個人戦なら要素1、団体戦なら最大3）
let realtimePendingType = 'solo'; // 'solo' | 'team'
let realtimePendingItems = [];

// -----------------------------------------------------
// 対戦アイテム選択画面 → リアルタイム対戦への橋渡し
// フェーズ⑥より個人戦（solo）・団体戦（team）の両方に対応
// -----------------------------------------------------
function proceedToRealtimeFromItemSelect() {
    if (!PENDING_MASMON_BATTLE || (PENDING_MASMON_BATTLE.type !== 'solo' && PENDING_MASMON_BATTLE.type !== 'team')) {
        showToast('編成情報が見つかりませんでした。');
        return;
    }
    const itemLoadout = masmonItemSlots.filter(k => k !== null);

    if (PENDING_MASMON_BATTLE.type === 'solo') {
        realtimePendingType = 'solo';
        realtimePendingTeam = [PENDING_MASMON_BATTLE.masmon];
    } else {
        realtimePendingType = 'team';
        realtimePendingTeam = [...PENDING_MASMON_BATTLE.masmons];
    }

    PENDING_MASMON_BATTLE = null;
    showRealtimeKeywordScreen(realtimePendingTeam, itemLoadout, realtimePendingType);
}

// -----------------------------------------------------
// キーワード入力画面
// -----------------------------------------------------
function showRealtimeKeywordScreen(team, itemLoadout, battleType) {
    realtimePendingTeam = team;
    realtimePendingType = battleType || (team.length > 1 ? 'team' : 'solo');
    realtimePendingItems = itemLoadout || [];

    const preview = document.getElementById('realtime-selected-masmon-preview');
    preview.innerHTML = '';
    preview.className = 'bg-[#2a1b15] border border-sky-900/50 rounded-xl p-2.5 space-y-2';

    const isTeam = realtimePendingType === 'team';
    const header = document.createElement('div');
    header.className = 'text-[10px] text-sky-300 font-bold';
    header.textContent = isTeam ? `🛡️⚔️🛡️ 団体戦編成（${team.length}体）` : '⚔️ 個人戦編成';
    preview.appendChild(header);

    team.forEach(m => {
        const row = document.createElement('div');
        row.className = 'flex items-center space-x-2';
        const iconWrap = document.createElement('div');
        iconWrap.className = 'w-9 h-9 flex items-center justify-center text-xl flex-shrink-0 bg-[#1a120b] rounded-full border border-sky-900/40';
        renderMonsterVisual(iconWrap, m.monsterBaseName, m.emoji, !!m.isAwakened);
        const info = document.createElement('div');
        info.className = 'flex-1 min-w-0';
        info.innerHTML = `<div class="text-xs font-bold text-sky-200 truncate">${m.name}<span class="text-[9px] text-gray-400 ml-1">（${m.monsterBaseName}）</span></div>`;
        row.appendChild(iconWrap);
        row.appendChild(info);
        preview.appendChild(row);
    });

    const itemNames = (itemLoadout && itemLoadout.length > 0)
        ? itemLoadout.map(k => MASMON_ITEM_DB[k].emoji).join(' ')
        : 'なし';
    const itemRow = document.createElement('div');
    itemRow.className = 'text-[9px] text-gray-400 pt-1 border-t border-sky-950';
    itemRow.textContent = `持ち込みアイテム: ${itemNames}`;
    preview.appendChild(itemRow);

    document.getElementById('realtime-keyword-input').value = '';
    document.getElementById('realtime-keyword-status').textContent = '';
    document.getElementById('realtime-keyword-submit-btn').disabled = false;

    changeScreen('screen-masmon-realtime-keyword');
}

function cancelRealtimeSetup() {
    resetRealtimeRoomState();
    showMasmonList();
}

// -----------------------------------------------------
// マッチング開始（ルーム作成 or 参加）
// -----------------------------------------------------
async function startRealtimeMatching() {
    const input = document.getElementById('realtime-keyword-input');
    const statusEl = document.getElementById('realtime-keyword-status');
    const keyword = (input.value || '').trim();

    if (keyword.length < 2) {
        statusEl.textContent = '合言葉は2文字以上で入力してください。';
        statusEl.className = 'text-[10px] text-center text-red-400';
        return;
    }
    // Firebaseのキーとして使えない文字を除外
    if (/[.#$\[\]\/]/.test(keyword)) {
        statusEl.textContent = '使用できない記号が含まれています（. # $ [ ] /）。';
        statusEl.className = 'text-[10px] text-center text-red-400';
        return;
    }

    if (!initFirebase()) {
        statusEl.textContent = 'Firebase未設定のため対戦できません。';
        statusEl.className = 'text-[10px] text-center text-red-400';
        return;
    }

    document.getElementById('realtime-keyword-submit-btn').disabled = true;
    statusEl.textContent = 'マッチングを試みています...';
    statusEl.className = 'text-[10px] text-center text-gray-400';

    const myId = getMyPlayerId();
    const myPayload = {
        id: myId,
        name: GAME_STATE.playerName || 'ブリーダー',
        battleType: realtimePendingType,
        team: realtimePendingTeam.map(m => ({
            name: m.name,
            emoji: m.emoji,
            monsterBaseName: m.monsterBaseName,
            stats: m.stats,
            skills: m.skills
        })),
        items: buildItemCounts(realtimePendingItems),
        lastSeen: Date.now()
    };

    const safeKeyword = encodeURIComponent(keyword).replace(/\./g, '%2E');
    const path = `battle_rooms/${safeKeyword}`;
    const ref = firebaseDb.ref(path);

    let txResult;
    try {
        txResult = await ref.transaction(current => {
            const now = Date.now();
            if (!current) {
                return {
                    status: 'waiting',
                    battleType: myPayload.battleType,
                    createdAt: now,
                    player1: { ...myPayload, lastSeen: now },
                    player2: null
                };
            }
            // 合言葉は「編成タイプ（個人戦/団体戦）」が一致する相手同士のみマッチングする
            if (current.battleType && current.battleType !== myPayload.battleType &&
                !(current.player1 && current.player1.id === myId) && !(current.player2 && current.player2.id === myId)) {
                return; // abort：編成タイプ不一致
            }
            if (current.player1 && current.player1.id === myId) {
                current.player1 = { ...myPayload, lastSeen: now };
                return current;
            }
            if (current.player2 && current.player2.id === myId) {
                current.player2 = { ...myPayload, lastSeen: now };
                return current;
            }
            if (current.status === 'waiting' && current.player1 && !current.player2) {
                current.player2 = { ...myPayload, lastSeen: now };
                current.status = 'matched';
                current.matchedAt = now;
                return current;
            }
            // 既に2人揃っている（他の組が使用中）→ 中断
            return; // undefinedを返すとトランザクション中断
        });
    } catch (e) {
        console.error('[Firebase] マッチングエラー:', e);
        statusEl.textContent = '通信エラーが発生しました。もう一度お試しください。';
        statusEl.className = 'text-[10px] text-center text-red-400';
        document.getElementById('realtime-keyword-submit-btn').disabled = false;
        return;
    }

    if (!txResult.committed) {
        statusEl.textContent = 'この合言葉は既に他の組で使用中か、個人戦／団体戦の編成が一致しません。別の合言葉をお試しください。';
        statusEl.className = 'text-[10px] text-center text-red-400';
        document.getElementById('realtime-keyword-submit-btn').disabled = false;
        return;
    }

    const roomData = txResult.snapshot.val();
    realtimeRoomKeyword = safeKeyword;
    realtimeRoomRef = ref;
    realtimeMySlot = (roomData.player1 && roomData.player1.id === myId) ? 'player1' : 'player2';

    startRealtimeHeartbeat();

    if (roomData.status === 'matched') {
        // 自分が2人目としてマッチング成立
        enterRealtimeMatchedScreen(roomData);
    } else {
        // 自分が1人目 → 待機画面へ。相手が来るのをリアルタイム監視する。
        document.getElementById('realtime-waiting-keyword').textContent = keyword;
        changeScreen('screen-masmon-realtime-waiting');

        realtimeRoomListener = ref.on('value', snap => {
            const data = snap.val();
            if (!data) {
                // ルームが削除された（想定外）
                return;
            }
            if (data.status === 'matched' && data.player2) {
                enterRealtimeMatchedScreen(data);
            }
        });
    }
}

// -----------------------------------------------------
// マッチング待機のキャンセル
// -----------------------------------------------------
async function cancelRealtimeMatching() {
    stopRealtimeHeartbeat();
    detachRealtimeListener();

    if (realtimeRoomRef) {
        try {
            await realtimeRoomRef.remove();
        } catch (e) {
            console.error('[Firebase] ルーム削除エラー:', e);
        }
    }
    resetRealtimeRoomState();
    showToast('マッチングをキャンセルしました。');
    showMasmonList();
}

// -----------------------------------------------------
// マッチング成立画面へ遷移
// -----------------------------------------------------
function enterRealtimeMatchedScreen(roomData) {
    detachRealtimeListener();

    const myData = roomData[realtimeMySlot];
    const opponentSlot = realtimeMySlot === 'player1' ? 'player2' : 'player1';
    const opponentData = roomData[opponentSlot];
    const isTeam = roomData.battleType === 'team';

    const myNames = (myData.team || []).map(m => m.name).join('、');
    const oppNames = (opponentData.team || []).map(m => m.name).join('、');

    const detail = document.getElementById('realtime-matched-detail');
    detail.innerHTML = `
        <div class="text-xs text-sky-300 font-bold border-b border-sky-800 pb-1 mb-1">対戦カード（${isTeam ? '団体戦' : '個人戦'}）</div>
        <div class="flex justify-between text-xs"><span class="text-gray-400">あなた:</span><span class="text-white font-bold">${myData.name} の ${myNames}</span></div>
        <div class="flex justify-between text-xs"><span class="text-gray-400">対戦相手:</span><span class="text-white font-bold">${opponentData.name} の ${oppNames}</span></div>
    `;

    changeScreen('screen-masmon-realtime-matched');

    // マッチング成立後、相手が退出してルームが消えた場合を検知（バトル開始前の簡易対応）
    realtimeRoomListener = realtimeRoomRef.on('value', snap => {
        const data = snap.val();
        if (!data) {
            detachRealtimeListener();
            stopRealtimeHeartbeat();
            resetRealtimeRoomState();
            showToast('対戦相手が退出したため、マッチングを終了しました。');
            showMasmonList();
        }
    });
}

// -----------------------------------------------------
// マッチング成立画面から退出（ルームをたたむ）
// -----------------------------------------------------
async function leaveRealtimeRoom() {
    stopRealtimeHeartbeat();
    detachRealtimeListener();

    if (realtimeRoomRef) {
        try {
            await realtimeRoomRef.remove();
        } catch (e) {
            console.error('[Firebase] ルーム削除エラー:', e);
        }
    }
    resetRealtimeRoomState();
    showMasmonList();
}

// -----------------------------------------------------
// ハートビート（生存通知）：切断検知の土台
// -----------------------------------------------------
function startRealtimeHeartbeat() {
    stopRealtimeHeartbeat();
    realtimeHeartbeatTimer = setInterval(() => {
        if (!realtimeRoomRef || !realtimeMySlot) return;
        realtimeRoomRef.child(`${realtimeMySlot}/lastSeen`).set(Date.now()).catch(() => {});
    }, REALTIME_HEARTBEAT_INTERVAL_MS);
}

function stopRealtimeHeartbeat() {
    if (realtimeHeartbeatTimer) {
        clearInterval(realtimeHeartbeatTimer);
        realtimeHeartbeatTimer = null;
    }
}

function detachRealtimeListener() {
    if (realtimeRoomRef && realtimeRoomListener) {
        realtimeRoomRef.off('value', realtimeRoomListener);
    }
    realtimeRoomListener = null;
}

function resetRealtimeRoomState() {
    realtimeRoomKeyword = null;
    realtimeRoomRef = null;
    realtimeMySlot = null;
    realtimePendingTeam = [];
    realtimePendingType = 'solo';
    realtimePendingItems = [];
}
