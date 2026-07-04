// =====================================================
// マスモン リアルタイム対戦：マッチング基盤（フェーズ4）
// Firebase Realtime Database: battle_rooms/{keyword}
//
// このファイルが担当する範囲（フェーズ4）:
//   ・2人のブリーダーが同じ「合言葉」を入力してルームを作成／参加する
//   ・待機中ルームはキャンセルされるまで残り続ける
//   ・マッチング成立後の土台（プレイヤー情報の同期・生存確認用ハートビート）
//
// 実際のターン制バトル同期ロジック（1行動→相手ターン、防御の技一覧統合など）は
// フェーズ⑤で battle_rooms/{keyword}/battleState 以下に実装予定。
// 対戦中の切断・無応答検知（60秒で不戦勝）もフェーズ⑤でこのハートビート基盤を使って実装する。
// =====================================================

const REALTIME_HEARTBEAT_INTERVAL_MS = 15000;   // 15秒ごとに生存通知
const REALTIME_DISCONNECT_TIMEOUT_MS = 60000;   // フェーズ⑤で使用：対戦中60秒無応答で不戦勝

let realtimeRoomKeyword = null;
let realtimeRoomRef = null;
let realtimeRoomListener = null;
let realtimeMySlot = null;      // 'player1' | 'player2'
let realtimeHeartbeatTimer = null;
let realtimePendingMasmon = null;
let realtimePendingItems = [];

// -----------------------------------------------------
// 対戦アイテム選択画面 → リアルタイム対戦への橋渡し
// （現状はソロ／個人戦のみ対応。団体戦のリアルタイム対戦はフェーズ⑥で対応予定）
// -----------------------------------------------------
function proceedToRealtimeFromItemSelect() {
    if (!PENDING_MASMON_BATTLE || PENDING_MASMON_BATTLE.type !== 'solo') {
        showToast('リアルタイム対戦は現在、個人戦のみ対応しています。');
        return;
    }
    const masmon = PENDING_MASMON_BATTLE.masmon;
    const itemLoadout = masmonItemSlots.filter(k => k !== null);
    PENDING_MASMON_BATTLE = null;
    showRealtimeKeywordScreen(masmon, itemLoadout);
}

// -----------------------------------------------------
// キーワード入力画面
// -----------------------------------------------------
function showRealtimeKeywordScreen(masmon, itemLoadout) {
    realtimePendingMasmon = masmon;
    realtimePendingItems = itemLoadout || [];

    const preview = document.getElementById('realtime-selected-masmon-preview');
    preview.innerHTML = '';
    const iconWrap = document.createElement('div');
    iconWrap.className = 'w-10 h-10 flex items-center justify-center text-2xl flex-shrink-0 bg-[#1a120b] rounded-full border border-sky-900/40';
    renderMonsterVisual(iconWrap, masmon.monsterBaseName, masmon.emoji, false);
    const info = document.createElement('div');
    info.className = 'flex-1 min-w-0';
    const itemNames = (itemLoadout && itemLoadout.length > 0)
        ? itemLoadout.map(k => MASMON_ITEM_DB[k].emoji).join(' ')
        : 'なし';
    info.innerHTML = `
        <div class="text-xs font-bold text-sky-200 truncate">出撃マスモン: ${masmon.name}</div>
        <div class="text-[9px] text-gray-400 mt-0.5">持ち込みアイテム: ${itemNames}</div>
    `;
    preview.appendChild(iconWrap);
    preview.appendChild(info);

    document.getElementById('realtime-keyword-input').value = '';
    document.getElementById('realtime-keyword-status').textContent = '';
    document.getElementById('realtime-keyword-submit-btn').disabled = false;

    changeScreen('screen-masmon-realtime-keyword');
}

function cancelRealtimeSetup() {
    realtimePendingMasmon = null;
    realtimePendingItems = [];
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
        masmon: {
            name: realtimePendingMasmon.name,
            emoji: realtimePendingMasmon.emoji,
            monsterBaseName: realtimePendingMasmon.monsterBaseName,
            stats: realtimePendingMasmon.stats,
            skills: realtimePendingMasmon.skills
        },
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
                    createdAt: now,
                    player1: { ...myPayload, lastSeen: now },
                    player2: null
                };
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
        statusEl.textContent = 'この合言葉は既に他の組で使用中です。別の合言葉をお試しください。';
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

    const detail = document.getElementById('realtime-matched-detail');
    detail.innerHTML = `
        <div class="text-xs text-sky-300 font-bold border-b border-sky-800 pb-1 mb-1">対戦カード</div>
        <div class="flex justify-between text-xs"><span class="text-gray-400">あなた:</span><span class="text-white font-bold">${myData.name} の ${myData.masmon.name}</span></div>
        <div class="flex justify-between text-xs"><span class="text-gray-400">対戦相手:</span><span class="text-white font-bold">${opponentData.name} の ${opponentData.masmon.name}</span></div>
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
// ハートビート（生存通知）：フェーズ⑤の切断検知の土台
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
    realtimePendingMasmon = null;
    realtimePendingItems = [];
}
