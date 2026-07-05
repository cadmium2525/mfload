// =====================================================
// game_ranking.js
// Firebase 設定とランキング機能：
//   ・Firebase初期化
//   ・スコアランキングの表示・難易度/モンスター別フィルタ
// =====================================================

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
        'モノリス': { id: 'rank-tab-monolith', active: 'bg-stone-700 border-stone-400 text-stone-200', inactive: 'bg-[#2a1b15] border-amber-900 text-gray-400' },
        'プラント': { id: 'rank-tab-plant', active: 'bg-pink-900 border-pink-500 text-pink-200', inactive: 'bg-[#2a1b15] border-amber-900 text-gray-400' },
        'キュービ': { id: 'rank-tab-kyubi', active: 'bg-orange-900 border-orange-500 text-orange-200', inactive: 'bg-[#2a1b15] border-amber-900 text-gray-400' },
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
        const monsterEmojiMap = { 'モッチー': '🍪', 'スエゾー': '👁️', 'ディノ': '🦖', 'モノリス': '🗿', 'プラント': '🌸', 'キュービ': '🦊' };

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
            const mImageName = (mName === 'プラント') ? 'Rプラント' : mName;
            const monsterIcon = '<img src="images/' + mImageName + '.png"'
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


