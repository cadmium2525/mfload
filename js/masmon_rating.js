// =====================================================
// masmon_rating.js
// PvP（リアルタイム対戦）向け Elo レーティング・ランキング機能
//
// 対応要件:
//   ・初期レート 1500 / Elo方式 / K=32
//   ・勝敗・切断負け（不戦勝/不戦敗）に対応
//   ・レートランキング TOP100（個人戦・団体戦を別集計）
//   ・勝率・勝敗数の表示
//   ・シーズン制（1ヶ月単位。カレンダー月が変わると自動的に新シーズンになる）
//   ・対戦履歴の保存（プレイヤーごとに直近50件）
//
// Firebase Realtime Database 構造:
//   player_ratings/{mode}/{season}/{playerId} = { name, rating, wins, losses, disconnectLosses, gamesPlayed, lastUpdated }
//   player_match_history/{mode}/{playerId}/{pushId} = { opponentId, opponentName, result, reason, ratingBefore, ratingAfter, delta, season, ts }
//     mode   = 'solo' | 'team'（個人戦 / 団体戦で別集計）
//     season = 'YYYY-MM'（暦月単位。1ヶ月ごとに新しいキーとなり、自然にシーズンがリセットされる）
//
// 実際のマッチ結果反映（js/masmon_realtime_battle.js から呼び出される）は、
// 両クライアントが同時に処理を試みても二重に反映されないよう、
// battleState/ratingApplied への transaction（先着1回のみ成立）でガードしている。
// =====================================================

const PVP_RATING_INITIAL = 1500;
const PVP_RATING_K = 32;
const PVP_MATCH_HISTORY_LIMIT = 50;

// --- シーズンキー（YYYY-MM）。暦月が変われば自動的に新しいシーズンになる ---
function getPvpSeasonKey(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
}

// --- 過去数シーズン分のキー・表示ラベル一覧（シーズン選択UI用） ---
function listRecentPvpSeasons(count = 6) {
    const seasons = [];
    const now = new Date();
    for (let i = 0; i < count; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        seasons.push({ key: getPvpSeasonKey(d), label: `${d.getFullYear()}年${d.getMonth() + 1}月` });
    }
    return seasons;
}

// --- Elo方式によるレート変動量の計算（K=32） ---
// myScore: 勝ち=1, 負け=0（引き分けは本アプリの対戦仕様上発生しないが 0.5 も一応許容）
function computePvpEloDelta(myRating, oppRating, myScore) {
    const expected = 1 / (1 + Math.pow(10, (oppRating - myRating) / 400));
    return Math.round(PVP_RATING_K * (myScore - expected));
}

// --- プレイヤーの現在レートを取得（未登録なら初期レート1500を返す） ---
async function fetchPvpPlayerRating(mode, season, playerId) {
    if (!initFirebase()) return PVP_RATING_INITIAL;
    try {
        const snap = await firebaseDb.ref(`player_ratings/${mode}/${season}/${playerId}/rating`).once('value');
        const v = snap.val();
        return (typeof v === 'number') ? v : PVP_RATING_INITIAL;
    } catch (e) {
        console.error('[PvPレート] 取得エラー:', e);
        return PVP_RATING_INITIAL;
    }
}

// --- プレイヤーの成績（レート・勝敗数）を取得 ---
async function fetchPvpPlayerStats(mode, season, playerId) {
    if (!initFirebase()) return null;
    try {
        const snap = await firebaseDb.ref(`player_ratings/${mode}/${season}/${playerId}`).once('value');
        const val = snap.val();
        if (!val) return { rating: PVP_RATING_INITIAL, wins: 0, losses: 0, disconnectLosses: 0, gamesPlayed: 0 };
        return val;
    } catch (e) {
        console.error('[PvP成績] 取得エラー:', e);
        return null;
    }
}

// --- レートランキング TOP N を取得（デフォルト100件、レート降順） ---
async function fetchPvpRanking(mode, season, limit = 100) {
    if (!initFirebase()) return [];
    try {
        const snap = await firebaseDb.ref(`player_ratings/${mode}/${season}`)
            .orderByChild('rating')
            .limitToLast(limit)
            .once('value');
        const list = [];
        snap.forEach(child => {
            const val = child.val();
            if (val) list.push({ id: child.key, ...val });
        });
        list.sort((a, b) => (b.rating || 0) - (a.rating || 0));
        return list;
    } catch (e) {
        console.error('[PvPランキング] 取得エラー:', e);
        return [];
    }
}

// --- 自分の対戦履歴を取得（直近N件、新しい順） ---
async function fetchMyPvpMatchHistory(mode, playerId, limit = 30) {
    if (!initFirebase()) return [];
    try {
        const snap = await firebaseDb.ref(`player_match_history/${mode}/${playerId}`)
            .orderByChild('ts')
            .limitToLast(limit)
            .once('value');
        const list = [];
        snap.forEach(child => list.push({ key: child.key, ...child.val() }));
        list.sort((a, b) => (b.ts || 0) - (a.ts || 0));
        return list;
    } catch (e) {
        console.error('[PvP対戦履歴] 取得エラー:', e);
        return [];
    }
}

// --- レート・勝敗数レコードの更新（transactionで安全に加算） ---
async function updatePvpRatingRecord(mode, season, playerId, playerName, delta, isWin, reason) {
    const ref = firebaseDb.ref(`player_ratings/${mode}/${season}/${playerId}`);
    await ref.transaction(current => {
        const base = current || { name: playerName, rating: PVP_RATING_INITIAL, wins: 0, losses: 0, disconnectLosses: 0, gamesPlayed: 0 };
        base.name = playerName || base.name || 'ブリーダー';
        const prevRating = (typeof base.rating === 'number') ? base.rating : PVP_RATING_INITIAL;
        base.rating = Math.round(prevRating + delta);
        base.gamesPlayed = (base.gamesPlayed || 0) + 1;
        if (isWin) {
            base.wins = (base.wins || 0) + 1;
        } else {
            base.losses = (base.losses || 0) + 1;
            if (reason === 'disconnect') base.disconnectLosses = (base.disconnectLosses || 0) + 1;
        }
        base.lastUpdated = Date.now();
        return base;
    });
}

// --- 対戦履歴を1件保存し、直近50件を超えた古い記録を削除する ---
async function recordPvpMatchHistory(mode, season, playerId, playerName, oppId, oppName, isWin, reason, ratingBefore, delta) {
    const ref = firebaseDb.ref(`player_match_history/${mode}/${playerId}`);
    await ref.push({
        opponentId: oppId || null,
        opponentName: oppName || '対戦相手',
        result: isWin ? 'win' : 'loss',
        reason: reason || 'ko',
        ratingBefore: Math.round(ratingBefore),
        ratingAfter: Math.round(ratingBefore + delta),
        delta: delta,
        season,
        ts: Date.now()
    });

    try {
        const snap = await ref.once('value');
        const items = [];
        snap.forEach(child => items.push({ key: child.key, ts: (child.val() || {}).ts || 0 }));
        if (items.length > PVP_MATCH_HISTORY_LIMIT) {
            items.sort((a, b) => a.ts - b.ts);
            const toDelete = items.slice(0, items.length - PVP_MATCH_HISTORY_LIMIT);
            for (const item of toDelete) {
                await ref.child(item.key).remove();
            }
        }
    } catch (e) {
        console.error('[PvP対戦履歴] 整理エラー:', e);
    }
}

// -----------------------------------------------------
// マッチ結果のレート反映（js/masmon_realtime_battle.js の
// handleRealtimeBattleEnd から、バトル終了を検知した両クライアントが呼び出す）
//
// 両クライアントが同時に呼んでも二重反映されないよう、
// battleState/ratingApplied への transaction（先着1回のみ成立）でガードする。
// -----------------------------------------------------
async function applyRealtimeMatchRating(roomRef, state) {
    if (!roomRef || !state || state.status !== 'finished' || !state.winner) return;
    if (!state.playerIds || !state.playerIds.player1 || !state.playerIds.player2) return; // 後方互換：情報が無い対戦は何もしない
    if (!initFirebase()) return;

    let claim;
    try {
        claim = await roomRef.child('battleState/ratingApplied').transaction(current => {
            if (current) return; // 既に処理済み → 中断（相手クライアントが処理中/済み）
            return true;
        });
    } catch (e) {
        console.error('[PvPレート] 更新権の取得エラー:', e);
        return;
    }
    if (!claim.committed) return; // 相手クライアント側が既に処理済み

    const mode = state.ratingMode || (state.battleType === 'team' ? 'team' : 'solo');
    const season = state.ratingSeason || getPvpSeasonKey();
    const ids = state.playerIds;
    const names = state.ownerNames || {};
    const ratingsAtStart = state.ratingsAtStart || {};
    const p1Start = (typeof ratingsAtStart.player1 === 'number') ? ratingsAtStart.player1 : PVP_RATING_INITIAL;
    const p2Start = (typeof ratingsAtStart.player2 === 'number') ? ratingsAtStart.player2 : PVP_RATING_INITIAL;

    const p1Win = state.winner === 'player1';
    const p1Delta = computePvpEloDelta(p1Start, p2Start, p1Win ? 1 : 0);
    const p2Delta = -p1Delta; // K同一のEloでは常に対称になる
    const reason = state.winReason || 'ko';

    try {
        await Promise.all([
            updatePvpRatingRecord(mode, season, ids.player1, names.player1, p1Delta, p1Win, reason),
            updatePvpRatingRecord(mode, season, ids.player2, names.player2, p2Delta, !p1Win, reason)
        ]);
        await Promise.all([
            recordPvpMatchHistory(mode, season, ids.player1, names.player1, ids.player2, names.player2, p1Win, reason, p1Start, p1Delta),
            recordPvpMatchHistory(mode, season, ids.player2, names.player2, ids.player1, names.player1, !p1Win, reason, p2Start, p2Delta)
        ]);
    } catch (e) {
        console.error('[PvPレート] 反映エラー:', e);
    }
}

// =====================================================
// PvPランキング画面 UI
// =====================================================
let pvpRankingMode = 'solo';
let pvpRankingSeason = getPvpSeasonKey();

function showPvpRanking() {
    pvpRankingMode = 'solo';
    pvpRankingSeason = getPvpSeasonKey();
    changeScreen('screen-pvp-ranking');
    renderPvpSeasonOptions();
    switchPvpRankingMode('solo');
}

function renderPvpSeasonOptions() {
    const select = document.getElementById('pvp-season-select');
    if (!select) return;
    const seasons = listRecentPvpSeasons(6);
    select.innerHTML = seasons.map((s, i) =>
        `<option value="${s.key}">${s.label}${i === 0 ? '（今シーズン）' : ''}</option>`
    ).join('');
    select.value = pvpRankingSeason;
}

function onPvpSeasonChange() {
    const select = document.getElementById('pvp-season-select');
    if (!select) return;
    pvpRankingSeason = select.value;
    loadPvpRankingView();
}

function switchPvpRankingMode(mode) {
    pvpRankingMode = mode;
    const soloBtn = document.getElementById('pvp-tab-solo');
    const teamBtn = document.getElementById('pvp-tab-team');
    if (soloBtn && teamBtn) {
        if (mode === 'solo') {
            soloBtn.className = 'flex-1 py-2 text-xs font-bold rounded-lg border transition-all bg-sky-900 border-sky-600 text-sky-300';
            teamBtn.className = 'flex-1 py-2 text-xs font-bold rounded-lg border transition-all bg-[#2a1b15] border-indigo-900 text-gray-400';
        } else {
            teamBtn.className = 'flex-1 py-2 text-xs font-bold rounded-lg border transition-all bg-indigo-900 border-indigo-600 text-indigo-300';
            soloBtn.className = 'flex-1 py-2 text-xs font-bold rounded-lg border transition-all bg-[#2a1b15] border-sky-900 text-gray-400';
        }
    }
    loadPvpRankingView();
}

async function loadPvpRankingView() {
    const myCard = document.getElementById('pvp-my-stats-card');
    const listEl = document.getElementById('pvp-ranking-list-container');
    if (!myCard || !listEl) return;

    myCard.innerHTML = '<div class="text-center text-gray-500 text-[10px] py-2">読み込み中...</div>';
    listEl.innerHTML = '<div class="text-center text-gray-500 text-xs py-8">読み込み中...</div>';

    if (!initFirebase()) {
        myCard.innerHTML = '';
        listEl.innerHTML = '<div class="text-center text-gray-500 text-xs py-8 leading-relaxed">Firebase未設定のため<br>ランキングを表示できません。</div>';
        return;
    }

    const mode = pvpRankingMode;
    const season = pvpRankingSeason;
    const myId = getMyPlayerId();

    const [ranking, myStats] = await Promise.all([
        fetchPvpRanking(mode, season, 100),
        fetchPvpPlayerStats(mode, season, myId)
    ]);

    const myRankIdx = ranking.findIndex(r => r.id === myId);
    const myRank = myRankIdx >= 0 ? myRankIdx + 1 : null;

    const stats = myStats || { rating: PVP_RATING_INITIAL, wins: 0, losses: 0, gamesPlayed: 0 };
    const games = stats.gamesPlayed || 0;
    const winRate = games > 0 ? Math.round((stats.wins / games) * 1000) / 10 : 0;
    const modeLabel = mode === 'solo' ? '個人戦' : '団体戦';

    myCard.innerHTML = `
        <div class="flex items-center justify-between">
            <div>
                <div class="text-[9px] text-gray-400">あなたのレート（${modeLabel}）</div>
                <div class="text-xl font-black text-amber-300 pixel-font">${Math.round(stats.rating || PVP_RATING_INITIAL)}</div>
            </div>
            <div class="text-right text-[10px] text-gray-300 leading-relaxed">
                <div>順位: ${myRank ? `${myRank}位 / TOP100` : (games > 0 ? '圏外' : '未参加')}</div>
                <div>${stats.wins || 0}勝 ${stats.losses || 0}敗（勝率 ${winRate}%）</div>
            </div>
        </div>
        <button onclick="openPvpHistoryModal()" class="mt-2 w-full py-1.5 bg-[#1a120b] hover:bg-[#2a1b15] text-[10px] text-gray-300 font-bold rounded-lg border border-amber-900 transition-all active:scale-95">
            📜 対戦履歴を見る
        </button>
    `;

    if (ranking.length === 0) {
        listEl.innerHTML = '<div class="text-center text-gray-500 text-xs py-8">このシーズンの対戦記録はまだありません。</div>';
        return;
    }

    const rankIcons = ['\u{1F947}', '\u{1F948}', '\u{1F949}'];
    listEl.innerHTML = ranking.map((entry, i) => {
        const rankIcon = rankIcons[i] !== undefined ? rankIcons[i] : ((i + 1) + '位');
        const g = entry.gamesPlayed || 0;
        const wr = g > 0 ? Math.round(((entry.wins || 0) / g) * 1000) / 10 : 0;
        const isMe = entry.id === myId;
        const safeName = (entry.name || 'ブリーダー').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `
            <div class="bg-[#2a1b15] border ${isMe ? 'border-amber-500' : 'border-amber-900/50'} rounded-xl p-2.5 flex items-center space-x-2">
                <div class="text-sm w-9 text-center flex-shrink-0 font-bold">${rankIcon}</div>
                <div class="flex-1 min-w-0">
                    <div class="text-xs font-bold ${isMe ? 'text-amber-300' : 'text-white'} truncate">${safeName}${isMe ? '（あなた）' : ''}</div>
                    <div class="text-[9px] text-gray-400">${entry.wins || 0}勝 ${entry.losses || 0}敗 / 勝率 ${wr}%</div>
                </div>
                <div class="text-right flex-shrink-0">
                    <div class="text-sm font-black text-amber-400 pixel-font">${Math.round(entry.rating || 0)}</div>
                </div>
            </div>
        `;
    }).join('');
}

async function openPvpHistoryModal() {
    const modal = document.getElementById('pvp-history-modal');
    const listEl = document.getElementById('pvp-history-list');
    const titleEl = document.getElementById('pvp-history-modal-title');
    if (!modal || !listEl) return;

    if (titleEl) titleEl.textContent = `対戦履歴（${pvpRankingMode === 'solo' ? '個人戦' : '団体戦'}）`;
    listEl.innerHTML = '<div class="text-center text-gray-500 text-xs py-6">読み込み中...</div>';
    modal.classList.remove('hidden');

    const history = await fetchMyPvpMatchHistory(pvpRankingMode, getMyPlayerId(), 30);
    if (history.length === 0) {
        listEl.innerHTML = '<div class="text-center text-gray-500 text-xs py-6">対戦履歴はまだありません。</div>';
        return;
    }

    const reasonLabel = { ko: '通常勝敗', surrender: '投了', disconnect: '通信切断（不戦勝/不戦敗）' };
    listEl.innerHTML = history.map(h => {
        const d = new Date(h.ts);
        const dateStr = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        const isWin = h.result === 'win';
        const delta = h.delta || 0;
        const deltaStr = delta > 0 ? `+${delta}` : `${delta}`;
        const safeOpp = (h.opponentName || '対戦相手').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `
            <div class="bg-[#2a1b15] border ${isWin ? 'border-emerald-800' : 'border-red-900'} rounded-lg p-2 flex items-center justify-between">
                <div class="min-w-0">
                    <div class="text-xs font-bold ${isWin ? 'text-emerald-400' : 'text-red-400'}">${isWin ? '勝利' : '敗北'} <span class="text-[9px] text-gray-500 font-normal">（${reasonLabel[h.reason] || h.reason || ''}）</span></div>
                    <div class="text-[9px] text-gray-400 truncate">vs ${safeOpp}</div>
                    <div class="text-[8px] text-gray-600">${dateStr}</div>
                </div>
                <div class="text-right flex-shrink-0">
                    <div class="text-xs font-bold ${delta >= 0 ? 'text-sky-400' : 'text-orange-400'}">${deltaStr}</div>
                    <div class="text-[8px] text-gray-500">${h.ratingBefore} → ${h.ratingAfter}</div>
                </div>
            </div>
        `;
    }).join('');
}

function closePvpHistoryModal() {
    const modal = document.getElementById('pvp-history-modal');
    if (modal) modal.classList.add('hidden');
}

// -----------------------------------------------------
// リアルタイム対戦：合言葉入力画面に自分の現在レートを表示する（任意の補助表示）
// -----------------------------------------------------
async function renderRealtimeMyRatingBadge() {
    const el = document.getElementById('realtime-my-rating-display');
    if (!el) return;
    if (!initFirebase()) {
        el.textContent = '';
        return;
    }
    const mode = (realtimePendingType === 'team') ? 'team' : 'solo';
    const season = getPvpSeasonKey();
    const rating = await fetchPvpPlayerRating(mode, season, getMyPlayerId());
    el.textContent = `📊 現在のレート（${mode === 'solo' ? '個人戦' : '団体戦'}）: ${Math.round(rating)}`;
}
