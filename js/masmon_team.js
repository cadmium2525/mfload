// =====================================================
// マスモン団体戦（3vs3）チーム選択 ＆ 対戦アイテム選択機能
// フェーズ3
// =====================================================

// 保留中のバトル情報（アイテム選択画面を経由して実際のバトル開始関数へ橋渡しする）
let PENDING_MASMON_BATTLE = null; // { type: 'solo', masmon } | { type: 'team', masmons: [...] }
let masmonTeamSelectList = [];
let masmonTeamSelected = []; // 選択中のマスモン（出撃順）

// -----------------------------------------------------
// 団体戦：チーム選択画面
// -----------------------------------------------------
async function showMasmonTeamSelect() {
    changeScreen('screen-masmon-team-select');
    masmonTeamSelected = [];
    updateMasmonTeamSelectCount();

    const container = document.getElementById('masmon-team-select-container');
    container.innerHTML = '<div class="text-center text-gray-500 text-xs py-8">読み込み中...</div>';

    if (!initFirebase()) {
        container.innerHTML = '<div class="text-center text-gray-500 text-xs py-8 leading-relaxed">Firebase未設定のため<br>団体戦に参加できません。</div>';
        return;
    }

    try {
        masmonTeamSelectList = await fetchMyMasmons();
    } catch (e) {
        console.error('[Firebase] マスモン取得エラー:', e);
        container.innerHTML = '<div class="text-center text-red-400 text-xs py-8">取得に失敗しました。</div>';
        return;
    }

    if (masmonTeamSelectList.length === 0) {
        container.innerHTML = '<div class="text-center text-gray-500 text-xs py-8 leading-relaxed">まだマスモンがいません。<br>ダンジョンをクリアして登録しよう！</div>';
        return;
    }

    renderMasmonTeamSelectList();
}

function renderMasmonTeamSelectList() {
    const container = document.getElementById('masmon-team-select-container');
    container.innerHTML = '';

    masmonTeamSelectList.forEach(m => {
        const selectedIdx = masmonTeamSelected.findIndex(sel => sel.key === m.key);
        const isSelected = selectedIdx !== -1;

        const card = document.createElement('button');
        card.type = 'button';
        card.className = `w-full text-left bg-[#2a1b15] border rounded-xl p-2.5 flex items-center space-x-2 transition-all active:scale-95 ${
            isSelected ? 'border-indigo-400 bg-indigo-950/40' : 'border-purple-900/50'
        }`;

        const iconWrap = document.createElement('div');
        iconWrap.className = 'w-10 h-10 flex items-center justify-center text-2xl flex-shrink-0 bg-[#1a120b] rounded-full border border-purple-900/40 relative';
        renderMonsterVisual(iconWrap, m.monsterBaseName, m.emoji, !!m.isAwakened);
        if (isSelected) {
            const badge = document.createElement('span');
            badge.className = 'absolute -top-1 -right-1 w-4 h-4 rounded-full bg-indigo-500 text-white text-[9px] font-bold flex items-center justify-center';
            badge.textContent = selectedIdx + 1;
            iconWrap.appendChild(badge);
        }

        const info = document.createElement('div');
        info.className = 'flex-1 min-w-0';
        info.innerHTML = `
            <div class="text-xs font-bold text-purple-200 truncate">${m.name}<span class="text-[9px] text-gray-400 ml-1">（${m.monsterBaseName}）</span></div>
            <div class="text-[9px] text-gray-400 mt-0.5">HP${m.stats.maxLife} / ちから${m.stats.pow} / かしこさ${m.stats.int}</div>
        `;

        card.appendChild(iconWrap);
        card.appendChild(info);
        card.onclick = () => toggleMasmonTeamSelect(m);
        container.appendChild(card);
    });
}

function toggleMasmonTeamSelect(masmon) {
    const idx = masmonTeamSelected.findIndex(sel => sel.key === masmon.key);
    if (idx !== -1) {
        masmonTeamSelected.splice(idx, 1);
    } else {
        if (masmonTeamSelected.length >= 3) {
            showToast('団体戦に出せるのは最大3体までです。');
            return;
        }
        masmonTeamSelected.push(masmon);
    }
    updateMasmonTeamSelectCount();
    renderMasmonTeamSelectList();
}

function updateMasmonTeamSelectCount() {
    document.getElementById('masmon-team-select-count').textContent = masmonTeamSelected.length;
    const nextBtn = document.getElementById('masmon-team-next-btn');
    if (masmonTeamSelected.length > 0) {
        nextBtn.classList.remove('opacity-40', 'pointer-events-none');
    } else {
        nextBtn.classList.add('opacity-40', 'pointer-events-none');
    }
}

function proceedToItemSelectFromTeam() {
    if (masmonTeamSelected.length === 0) {
        showToast('メンバーを1体以上選択してください。');
        return;
    }
    PENDING_MASMON_BATTLE = { type: 'team', masmons: [...masmonTeamSelected] };
    showMasmonItemSelectScreen();
}

// -----------------------------------------------------
// 個人戦（ソロ）：バトル開始前にアイテム選択へ
// -----------------------------------------------------
function openItemSelectForSolo(masmon) {
    PENDING_MASMON_BATTLE = { type: 'solo', masmon };
    showMasmonItemSelectScreen();
}

// -----------------------------------------------------
// 対戦アイテム選択画面
// -----------------------------------------------------
let masmonItemSlots = [null, null, null];

function showMasmonItemSelectScreen() {
    masmonItemSlots = [null, null, null];
    renderMasmonItemSelectScreen();

    // リアルタイム対戦（他プレイヤーとの対戦）：フェーズ⑥より個人戦・団体戦の両方に対応
    const realtimeBtn = document.getElementById('masmon-item-realtime-btn');
    if (realtimeBtn) {
        realtimeBtn.classList.toggle('hidden', !PENDING_MASMON_BATTLE);
        realtimeBtn.textContent = (PENDING_MASMON_BATTLE && PENDING_MASMON_BATTLE.type === 'team')
            ? '🌐 他プレイヤーとリアルタイム団体戦'
            : '🌐 他プレイヤーとリアルタイム対戦';
    }

    changeScreen('screen-masmon-item-select');
}

function renderMasmonItemSelectScreen() {
    const container = document.getElementById('masmon-item-select-container');
    container.innerHTML = '';

    for (let i = 0; i < 3; i++) {
        const slotIdx = i;
        const wrap = document.createElement('div');
        wrap.className = 'bg-[#2a1b15] border border-emerald-900/50 rounded-xl p-2.5';

        const label = document.createElement('div');
        label.className = 'text-[10px] text-emerald-300 font-bold mb-1.5';
        label.textContent = `アイテムスロット ${slotIdx + 1}`;
        wrap.appendChild(label);

        const optionsRow = document.createElement('div');
        optionsRow.className = 'grid grid-cols-4 gap-1.5';

        const options = [
            { key: null, name: 'なし', emoji: '🚫' },
            ...Object.keys(MASMON_ITEM_DB).map(key => ({ key, name: MASMON_ITEM_DB[key].name, emoji: MASMON_ITEM_DB[key].emoji }))
        ];

        options.forEach(opt => {
            const isChosen = masmonItemSlots[slotIdx] === opt.key;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `p-1.5 rounded-lg border text-[9px] font-bold flex flex-col items-center transition-all active:scale-95 ${
                isChosen ? 'bg-emerald-700 border-emerald-400 text-white' : 'bg-[#1a120b] border-emerald-950 text-gray-400'
            }`;
            btn.innerHTML = `<span class="text-base leading-none">${opt.emoji}</span><span class="mt-0.5 leading-tight text-center">${opt.name}</span>`;
            btn.title = opt.key ? MASMON_ITEM_DB[opt.key].desc : '';
            btn.onclick = () => {
                masmonItemSlots[slotIdx] = opt.key;
                renderMasmonItemSelectScreen();
            };
            optionsRow.appendChild(btn);
        });

        wrap.appendChild(optionsRow);
        container.appendChild(wrap);
    }

    // 説明カード
    const desc = document.createElement('div');
    desc.className = 'bg-[#1a120b] border border-emerald-950 rounded-xl p-2.5 space-y-1.5 text-[10px] text-gray-300 leading-relaxed';
    desc.innerHTML = Object.keys(MASMON_ITEM_DB).map(key => {
        const item = MASMON_ITEM_DB[key];
        return `<div><span class="text-emerald-300 font-bold">${item.emoji} ${item.name}</span>：${item.desc}</div>`;
    }).join('');
    container.appendChild(desc);
}

function cancelPendingMasmonBattle() {
    if (PENDING_MASMON_BATTLE && PENDING_MASMON_BATTLE.type === 'team') {
        changeScreen('screen-masmon-team-select');
    } else {
        showMasmonList();
    }
    PENDING_MASMON_BATTLE = null;
}

// -----------------------------------------------------
// 実際のバトル開始（保留していたバトル種別へ振り分け）
// -----------------------------------------------------
async function startPendingMasmonBattle() {
    if (!PENDING_MASMON_BATTLE) return;

    const itemLoadout = masmonItemSlots.filter(k => k !== null);

    if (PENDING_MASMON_BATTLE.type === 'solo') {
        const masmon = PENDING_MASMON_BATTLE.masmon;
        PENDING_MASMON_BATTLE = null;
        await startMasmonCpuBattle(masmon, itemLoadout);
    } else if (PENDING_MASMON_BATTLE.type === 'team') {
        const masmons = PENDING_MASMON_BATTLE.masmons;
        PENDING_MASMON_BATTLE = null;
        await startMasmonCpuTeamBattle(masmons, itemLoadout);
    }
}
