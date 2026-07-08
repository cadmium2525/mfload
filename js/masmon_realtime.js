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
const RANDOM_QUEUE_STALE_MS = 20000;            // 20秒以上更新の無い待機枠は無効（相手の離脱等）とみなし上書きする

let realtimeRoomKeyword = null;
let realtimeRoomRef = null;
let realtimeRoomListener = null;
let realtimeMySlot = null;      // 'player1' | 'player2'
let realtimeHeartbeatTimer = null;
let realtimePendingTeam = [];   // 持ち込みマスモン配列（個人戦なら要素1、団体戦なら最大3）
let realtimePendingType = 'solo'; // 'solo' | 'team'
let realtimePendingItems = [];
let realtimeIsRandomMatch = false;    // ランダムマッチング（合言葉なし）で成立した対戦かどうか
let realtimeRandomQueueRef = null;    // 自分がランダムマッチの待機枠を持っている場合の参照（キャンセル時のクリア用）
let realtimeRandomQueueRoomKey = null; // 自分が発行した待機枠のマッチID（他人に奪われていないか確認用）
let realtimeRandomQueueListener = null; // 待機中、random_queueへ相手が来たかを監視するリスナー（player1側のみ使用）

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
        renderMonsterVisual(iconWrap, m.monsterBaseName, m.emoji, !!m.isAwakened, true);
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
    document.getElementById('realtime-random-match-btn').disabled = false;

    changeScreen('screen-masmon-realtime-keyword');
    if (typeof renderRealtimeMyRatingBadge === 'function') renderRealtimeMyRatingBadge();
}

function cancelRealtimeSetup() {
    resetRealtimeRoomState();
    showMasmonList();
}

// -----------------------------------------------------
// マッチング用の自分側ペイロード（合言葉マッチ／ランダムマッチ共通）
// -----------------------------------------------------
function buildRealtimeMyPayload() {
    return {
        id: getMyPlayerId(),
        name: GAME_STATE.playerName || 'ブリーダー',
        battleType: realtimePendingType,
        team: realtimePendingTeam.map(m => ({
            name: m.name,
            emoji: m.emoji,
            monsterBaseName: m.monsterBaseName,
            stats: m.stats,
            skills: m.skills,
            skillEnhancements: m.skillEnhancements || {},
            statusEffect: m.statusEffect || null,
            isAwakened: !!m.isAwakened,
            aura: m.aura || null,
            equip: m.equip || null
        })),
        items: buildItemCounts(realtimePendingItems),
        lastSeen: getFirebaseServerNow()
    };
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
    document.getElementById('realtime-random-match-btn').disabled = true;
    statusEl.textContent = 'マッチングを試みています...';
    statusEl.className = 'text-[10px] text-center text-gray-400';

    const myId = getMyPlayerId();
    const myPayload = buildRealtimeMyPayload();

    const safeKeyword = encodeURIComponent(keyword).replace(/\./g, '%2E');
    const path = `battle_rooms/${safeKeyword}`;
    const ref = firebaseDb.ref(path);

    let txResult;
    try {
        txResult = await ref.transaction(current => {
            const now = getFirebaseServerNow();
            // 前回の対戦が正常終了時のルーム削除（remove()）を経ずに残ってしまった場合
            // （通信切断・アプリ強制終了等）、battleState が「終了済み(finished)」のまま
            // 残っていることがある。これを使い回すと ratingApplied 等の終了済みフラグまで
            // 引き継がれ、2試合目以降のレート・対戦履歴が一切記録されなくなるため、
            // その場合は新規ルームとして初期化し直す。
            if (current && current.battleState && current.battleState.status === 'finished') {
                current = null;
            }
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
        document.getElementById('realtime-random-match-btn').disabled = false;
        return;
    }

    if (!txResult.committed) {
        statusEl.textContent = 'この合言葉は既に他の組で使用中か、個人戦／団体戦の編成が一致しません。別の合言葉をお試しください。';
        statusEl.className = 'text-[10px] text-center text-red-400';
        document.getElementById('realtime-keyword-submit-btn').disabled = false;
        document.getElementById('realtime-random-match-btn').disabled = false;
        return;
    }

    const roomData = txResult.snapshot.val();
    realtimeRoomKeyword = safeKeyword;
    realtimeRoomRef = ref;
    realtimeMySlot = (roomData.player1 && roomData.player1.id === myId) ? 'player1' : 'player2';
    realtimeIsRandomMatch = false;

    startRealtimeHeartbeat();

    if (roomData.status === 'matched') {
        // 自分が2人目としてマッチング成立
        enterRealtimeMatchedScreen(roomData);
    } else {
        // 自分が1人目 → 待機画面へ。相手が来るのをリアルタイム監視する。
        document.getElementById('realtime-waiting-keyword').textContent = keyword;
        document.getElementById('realtime-waiting-keyword-text').classList.remove('hidden');
        document.getElementById('realtime-waiting-random-text').classList.add('hidden');
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
// ランダムマッチング（合言葉なし）開始
// 同じ編成タイプ（個人戦/団体戦）で待機している他のブリーダーとその場でマッチングする。
// キューノード random_queue/{battleType} に「今待機している1組」の情報を持たせ、
// トランザクションで「誰もいない→自分が待機枠を作る」「誰かいる→自分が2人目として成立」を判定する。
//
// ポイント：待機枠の作成 と マッチング成立（相手情報の書き込み）を
// 同じ1回のトランザクションで行う。以前は「1人目が待機枠を確保→別の通信で
// battle_rooms にルームを作成→2人目がそのルームに参加を試みる」という2段階の
// 処理だったため、1人目側のルーム作成がわずかに遅れただけで2人目の参加が
// タイムアウトし「対戦相手との接続に失敗しました」になっていた（レースコンディション）。
// このトランザクション内で相手の有無とマッチング確定を同時に扱うことで、
// 2人目はトランザクションが成立した時点で既に相手の情報も含めて確定済みとなり、
// 「相手のルーム作成待ち」自体が発生しなくなる。
// -----------------------------------------------------
async function startRandomMatching() {
    const statusEl = document.getElementById('realtime-keyword-status');

    if (!initFirebase()) {
        statusEl.textContent = 'Firebase未設定のため対戦できません。';
        statusEl.className = 'text-[10px] text-center text-red-400';
        return;
    }

    document.getElementById('realtime-keyword-submit-btn').disabled = true;
    document.getElementById('realtime-random-match-btn').disabled = true;
    statusEl.textContent = 'ランダムマッチングを試みています...';
    statusEl.className = 'text-[10px] text-center text-gray-400';

    const myId = getMyPlayerId();
    const myPayload = buildRealtimeMyPayload();
    const battleType = realtimePendingType;
    const queueRef = firebaseDb.ref(`random_queue/${battleType}`);

    let myMatchId = null;
    let iAmFirst = false;

    let txResult;
    try {
        txResult = await queueRef.transaction(current => {
            const now = getFirebaseServerNow();
            if (!current || current.claimed || (now - current.createdAt) > RANDOM_QUEUE_STALE_MS) {
                // 誰も待機していない（または古い/使用済みの待機枠）→ 自分が新しい待機枠を作る
                myMatchId = 'rand_' + now.toString(36) + Math.random().toString(36).slice(2, 8);
                iAmFirst = true;
                return {
                    matchId: myMatchId,
                    createdAt: now,
                    waitingId: myId,
                    claimed: false,
                    battleType,
                    player1: { ...myPayload, lastSeen: now },
                    player2: null
                };
            }
            if (current.waitingId === myId) {
                // 自分自身が既に待機中（多重タップ等）→ そのまま維持
                myMatchId = current.matchId;
                iAmFirst = true;
                return current;
            }
            // 他の誰かが待機中 → この場で自分が2人目として書き込み、マッチングを確定する
            myMatchId = current.matchId;
            iAmFirst = false;
            current.claimed = true;
            current.player2 = { ...myPayload, lastSeen: now };
            current.matchedAt = now;
            return current;
        });
    } catch (e) {
        console.error('[Firebase] ランダムマッチングエラー:', e);
        statusEl.textContent = '通信エラーが発生しました。もう一度お試しください。';
        statusEl.className = 'text-[10px] text-center text-red-400';
        document.getElementById('realtime-keyword-submit-btn').disabled = false;
        document.getElementById('realtime-random-match-btn').disabled = false;
        return;
    }

    if (!txResult.committed || !myMatchId) {
        statusEl.textContent = '混み合っています。もう一度お試しください。';
        statusEl.className = 'text-[10px] text-center text-red-400';
        document.getElementById('realtime-keyword-submit-btn').disabled = false;
        document.getElementById('realtime-random-match-btn').disabled = false;
        return;
    }

    realtimeIsRandomMatch = true;
    const queueSnapshotVal = txResult.snapshot.val();
    const roomRef = firebaseDb.ref(`battle_rooms/${myMatchId}`);

    if (iAmFirst) {
        // 自分が1人目 → 待機枠を確保。相手が同じトランザクションでplayer2を
        // 書き込んでくれるのを、random_queue自体をリアルタイム監視して待つ。
        realtimeRandomQueueRef = queueRef;
        realtimeRandomQueueRoomKey = myMatchId;

        realtimeRoomKeyword = myMatchId;
        realtimeRoomRef = roomRef;
        realtimeMySlot = 'player1';

        startRealtimeHeartbeat();

        document.getElementById('realtime-waiting-keyword-text').classList.add('hidden');
        document.getElementById('realtime-waiting-random-text').classList.remove('hidden');
        changeScreen('screen-masmon-realtime-waiting');

        realtimeRandomQueueListener = queueRef.on('value', snap => {
            const data = snap.val();
            if (!data || data.matchId !== myMatchId || !data.player2) return;
            queueRef.off('value', realtimeRandomQueueListener);
            realtimeRandomQueueListener = null;

            const finalRoom = {
                status: 'matched',
                battleType,
                createdAt: data.createdAt,
                matchedAt: data.matchedAt || getFirebaseServerNow(),
                isRandomMatch: true,
                player1: data.player1,
                player2: data.player2
            };
            // 実際の対戦（ターン同期）用に、確定した情報を専用ルームへ書き込む。
            // 2人目側も同じ内容を書き込むため、どちらが先でも問題ない（冪等）。
            roomRef.set(finalRoom).catch(e => console.error('[Firebase] ランダムマッチ ルーム確定エラー:', e));

            realtimeRoomListener = roomRef.on('value', snap2 => {
                const roomData = snap2.val();
                if (roomData && roomData.status === 'matched' && roomData.player2) {
                    enterRealtimeMatchedScreen(roomData);
                }
            });
        });
    } else {
        // 自分が2人目 → トランザクション成立と同時に相手の情報も確定済み。
        // 相手のルーム作成を待つ必要がないため、ここで接続失敗は発生しない。
        realtimeRoomKeyword = myMatchId;
        realtimeRoomRef = roomRef;
        realtimeMySlot = 'player2';

        const finalRoom = {
            status: 'matched',
            battleType,
            createdAt: queueSnapshotVal.createdAt,
            matchedAt: queueSnapshotVal.matchedAt || getFirebaseServerNow(),
            isRandomMatch: true,
            player1: queueSnapshotVal.player1,
            player2: queueSnapshotVal.player2
        };

        try {
            await roomRef.set(finalRoom);
        } catch (e) {
            // ルームへの反映に失敗しても、マッチング自体（相手の確定）は既に成立している。
            console.error('[Firebase] ランダムマッチ ルーム確定エラー:', e);
        }

        startRealtimeHeartbeat();
        enterRealtimeMatchedScreen(finalRoom);
    }
}

// -----------------------------------------------------
// 自分が発行したランダムマッチの待機枠が、まだ誰にも使われていなければ削除する
// （キャンセル時に他のプレイヤーが古い待機枠のタイムアウトを待たされないようにするため）
// -----------------------------------------------------
async function clearMyRandomQueueEntryIfMine() {
    if (realtimeRandomQueueListener && realtimeRandomQueueRef) {
        realtimeRandomQueueRef.off('value', realtimeRandomQueueListener);
        realtimeRandomQueueListener = null;
    }
    if (!realtimeRandomQueueRef || !realtimeRandomQueueRoomKey) return;
    const myMatchId = realtimeRandomQueueRoomKey;
    try {
        await realtimeRandomQueueRef.transaction(current => {
            if (current && current.matchId === myMatchId && !current.claimed) {
                return null; // 削除：次の人がすぐに新しい待機枠を作れるようにする
            }
            return current; // 既に他の人にマッチングされている等 → そのまま
        });
    } catch (e) {
        console.error('[Firebase] ランダムマッチ待機枠クリアエラー:', e);
    }
    realtimeRandomQueueRef = null;
    realtimeRandomQueueRoomKey = null;
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
    await clearMyRandomQueueEntryIfMine();
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
        <div class="text-xs text-sky-300 font-bold border-b border-sky-800 pb-1 mb-1">対戦カード（${isTeam ? '団体戦' : '個人戦'}）${realtimeIsRandomMatch ? '<span class="ml-1 text-[9px] text-purple-300">🎲 ランダムマッチング</span>' : ''}</div>
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
    await clearMyRandomQueueEntryIfMine();
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
        realtimeRoomRef.child(`${realtimeMySlot}/lastSeen`).set(getFirebaseServerNow()).catch(() => {});
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
    realtimeIsRandomMatch = false;
    realtimeRandomQueueRef = null;
    realtimeRandomQueueRoomKey = null;
    realtimeRandomQueueListener = null;
}
