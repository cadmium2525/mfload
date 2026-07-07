// =====================================================
// equipment.js
// 装備アイテム管理機能：
//   ・冒険中に入手した装備（GAME_STATE.acquiredEquipment）を
//     クリア時にブリーダーID（getMyPlayerId）へ永続登録
//   ・所持装備一覧画面（お気に入り5パターン・ソート対応）
//   ・PvP（マスモン対戦）でマスモンごとに装備を1つ選択する機能
// Firebase Realtime Database: breeder_equipment/{playerId}/{instanceId}
// database.js の EQUIPMENT_DB / rollEquipmentInstance 等に依存する。
// =====================================================

// --- 装備の入手モード表示ラベル（'both' はノーマル・ハード両方でドロップする装備） ---
function getEquipmentModeLabel(mode) {
    if (mode === 'hard') return 'HARD産';
    if (mode === 'both') return 'NORMAL/HARD産';
    return 'NORMAL産';
}

const FAVORITE_TAG_LABELS = {
    p1: 'お気に入りA',
    p2: 'お気に入りB',
    p3: 'お気に入りC',
    p4: 'お気に入りD',
    p5: 'お気に入りE'
};

// --- クリア時：今回の冒険で入手した装備アイテムをブリーダーIDへ保存 ---
async function saveAcquiredEquipmentToBreeder() {
    const list = GAME_STATE.acquiredEquipment || [];
    if (list.length === 0) return;
    if (typeof initFirebase !== 'function' || !initFirebase()) return;

    const pid = getMyPlayerId();
    try {
        const updates = {};
        list.forEach(instance => {
            updates[instance.instanceId] = instance;
        });
        await firebaseDb.ref(`breeder_equipment/${pid}`).update(updates);
    } catch (e) {
        console.error('[Firebase] 装備アイテム保存エラー:', e);
    }
}

// --- 自分の所持装備アイテム一覧を取得 ---
async function fetchMyEquipment() {
    if (!initFirebase()) return [];
    const pid = getMyPlayerId();
    const snap = await firebaseDb.ref(`breeder_equipment/${pid}`).once('value');
    const list = [];
    snap.forEach(child => {
        list.push({ key: child.key, ...child.val() });
    });
    return list;
}

async function toggleEquipmentFavoriteTag(instanceId, tagKey) {
    if (!initFirebase()) return;
    const pid = getMyPlayerId();
    try {
        const ref = firebaseDb.ref(`breeder_equipment/${pid}/${instanceId}/favoriteTags/${tagKey}`);
        const snap = await ref.once('value');
        await ref.set(!snap.val());
    } catch (e) {
        console.error('[Firebase] お気に入り更新エラー:', e);
    }
}

async function deleteEquipmentItem(instanceId) {
    if (!initFirebase()) return;
    if (!confirm('この装備アイテムを削除しますか？')) return;
    try {
        await firebaseDb.ref(`breeder_equipment/${getMyPlayerId()}/${instanceId}`).remove();
        showToast('装備アイテムを削除しました。');
        renderEquipmentListScreen();
    } catch (e) {
        console.error('[Firebase] 装備アイテム削除エラー:', e);
        showToast('削除に失敗しました。');
    }
}

// -----------------------------------------------------
// 所持装備アイテム一覧画面
// -----------------------------------------------------
let equipmentListCache = [];
let equipmentListFilterTag = 'all'; // 'all' | 'p1' | 'p2' | 'p3' | 'p4' | 'p5'
let equipmentListSortKey = 'acquiredDesc'; // 'acquiredDesc' | 'acquiredAsc' | 'rarityDesc' | 'valueDesc' | 'nameAsc'

function showEquipmentListScreen() {
    changeScreen('screen-equipment-list');
    renderEquipmentFilterTabs();
    renderEquipmentListScreen();
    renderEquipmentPickerBanner();
}

function renderEquipmentFilterTabs() {
    const container = document.getElementById('equipment-filter-tabs');
    if (!container) return;
    container.innerHTML = '';

    const tabs = [{ key: 'all', label: 'すべて' }, ...Object.keys(FAVORITE_TAG_LABELS).map(k => ({ key: k, label: FAVORITE_TAG_LABELS[k] }))];
    tabs.forEach(tab => {
        const btn = document.createElement('button');
        btn.type = 'button';
        const isActive = equipmentListFilterTag === tab.key;
        btn.className = `px-2 py-1 rounded-lg text-[9px] font-bold border transition-all whitespace-nowrap ${
            isActive ? 'bg-purple-700 border-purple-400 text-white' : 'bg-[#1a120b] border-purple-950 text-gray-400'
        }`;
        btn.textContent = tab.label;
        btn.onclick = () => {
            equipmentListFilterTag = tab.key;
            renderEquipmentFilterTabs();
            renderEquipmentListScreen();
        };
        container.appendChild(btn);
    });
}

function onEquipmentSortChange(selectEl) {
    equipmentListSortKey = selectEl.value;
    renderEquipmentListScreen();
}

function sortEquipmentList(list) {
    const sorted = [...list];
    switch (equipmentListSortKey) {
        case 'acquiredAsc':
            sorted.sort((a, b) => (a.acquiredAt || 0) - (b.acquiredAt || 0));
            break;
        case 'rarityDesc':
            sorted.sort((a, b) => {
                const ra = (EQUIPMENT_DB[a.equipId] || {}).rarity || '';
                const rb = (EQUIPMENT_DB[b.equipId] || {}).rarity || '';
                return (rb.split('★').length) - (ra.split('★').length);
            });
            break;
        case 'valueDesc':
            sorted.sort((a, b) => (b.rolledValue || 0) - (a.rolledValue || 0));
            break;
        case 'nameAsc':
            sorted.sort((a, b) => {
                const na = (EQUIPMENT_DB[a.equipId] || {}).name || '';
                const nb = (EQUIPMENT_DB[b.equipId] || {}).name || '';
                return na.localeCompare(nb, 'ja');
            });
            break;
        case 'acquiredDesc':
        default:
            sorted.sort((a, b) => (b.acquiredAt || 0) - (a.acquiredAt || 0));
            break;
    }
    return sorted;
}

async function renderEquipmentListScreen() {
    const container = document.getElementById('equipment-list-container');
    if (!container) return;
    container.innerHTML = '<div class="text-center text-gray-500 text-xs py-8">読み込み中...</div>';

    if (!initFirebase()) {
        container.innerHTML = '<div class="text-center text-gray-500 text-xs py-8 leading-relaxed">Firebase未設定のため<br>装備アイテムを表示できません。</div>';
        return;
    }

    try {
        equipmentListCache = await fetchMyEquipment();
    } catch (e) {
        console.error('[Firebase] 装備アイテム取得エラー:', e);
        container.innerHTML = '<div class="text-center text-red-400 text-xs py-8">取得に失敗しました。</div>';
        return;
    }

    document.getElementById('equipment-list-count').textContent = equipmentListCache.length;

    let list = equipmentListCache;
    if (equipmentListFilterTag !== 'all') {
        list = list.filter(inst => inst.favoriteTags && inst.favoriteTags[equipmentListFilterTag]);
    }
    list = sortEquipmentList(list);

    if (list.length === 0) {
        container.innerHTML = '<div class="text-center text-gray-500 text-xs py-8 leading-relaxed">装備アイテムがありません。<br>宝箱発見イベントやバトル勝利報酬で入手しよう！</div>';
        return;
    }

    container.innerHTML = '';
    list.forEach(inst => {
        const base = EQUIPMENT_DB[inst.equipId];
        if (!base) return;

        const isPicker = !!equipPickerTargetMasmon;
        const isEquippedByTarget = isPicker && equipPickerTargetMasmon.equip && equipPickerTargetMasmon.equip.instanceId === inst.instanceId;

        const card = document.createElement('div');
        card.className = `bg-[#2a1b15] border rounded-xl p-2.5 flex items-center space-x-2 cursor-pointer active:scale-[0.98] transition-all ${
            isEquippedByTarget ? 'border-purple-400 shadow-[0_0_6px_2px_rgba(168,85,247,0.4)]' : 'border-purple-900/50'
        }`;
        card.onclick = () => {
            if (isPicker) {
                assignEquipToMasmon(equipPickerTargetMasmon, inst);
            } else {
                openEquipmentDetailModal(inst);
            }
        };

        const iconWrap = document.createElement('div');
        iconWrap.className = 'w-10 h-10 flex items-center justify-center text-2xl flex-shrink-0 bg-[#1a120b] rounded-full border border-purple-900/40';
        iconWrap.textContent = base.icon;

        const activeTags = Object.keys(inst.favoriteTags || {}).filter(k => inst.favoriteTags[k]);
        const info = document.createElement('div');
        info.className = 'flex-1 min-w-0';
        info.innerHTML = `
            <div class="text-xs font-bold text-purple-200 truncate">${base.name}<span class="text-[9px] text-amber-400 ml-1">${base.rarity}</span>${isEquippedByTarget ? '<span class="text-[9px] text-purple-300 ml-1">✓装備中</span>' : ''}</div>
            <div class="text-[9px] text-gray-400 mt-0.5">${getEquipmentDisplayDesc(inst)}</div>
            <div class="text-[8px] text-gray-500 mt-0.5">${getEquipmentModeLabel(base.mode)}${activeTags.length ? ' ・ ' + activeTags.map(t => FAVORITE_TAG_LABELS[t]).join('/') : ''}</div>
        `;

        card.appendChild(iconWrap);
        card.appendChild(info);

        if (!isPicker) {
            const delBtn = document.createElement('button');
            delBtn.className = 'flex-shrink-0 text-[10px] bg-red-950 hover:bg-red-900 border border-red-800 text-red-300 px-2 py-1 rounded-lg transition-all active:scale-95';
            delBtn.textContent = '削除';
            delBtn.onclick = (ev) => {
                ev.stopPropagation();
                deleteEquipmentItem(inst.instanceId);
            };
            card.appendChild(delBtn);
        }

        container.appendChild(card);
    });
}

// -----------------------------------------------------
// 装備詳細モーダル（お気に入りタグ切り替え）
// -----------------------------------------------------
let equipmentDetailCurrent = null;

function openEquipmentDetailModal(inst) {
    equipmentDetailCurrent = inst;
    const base = EQUIPMENT_DB[inst.equipId];
    if (!base) return;

    document.getElementById('equipment-detail-icon').textContent = base.icon;
    document.getElementById('equipment-detail-name').textContent = base.name;
    document.getElementById('equipment-detail-rarity').textContent = base.rarity;
    document.getElementById('equipment-detail-mode').textContent = getEquipmentModeLabel(base.mode);
    document.getElementById('equipment-detail-desc').textContent = getEquipmentDisplayDesc(inst);

    const tagContainer = document.getElementById('equipment-detail-tags');
    tagContainer.innerHTML = '';
    Object.keys(FAVORITE_TAG_LABELS).forEach(tagKey => {
        const isOn = !!(inst.favoriteTags && inst.favoriteTags[tagKey]);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `p-1.5 rounded-lg border text-[9px] font-bold transition-all active:scale-95 ${
            isOn ? 'bg-amber-600 border-amber-300 text-white' : 'bg-[#1a120b] border-amber-950 text-gray-400'
        }`;
        btn.textContent = FAVORITE_TAG_LABELS[tagKey];
        btn.onclick = async () => {
            await toggleEquipmentFavoriteTag(inst.instanceId, tagKey);
            inst.favoriteTags = inst.favoriteTags || {};
            inst.favoriteTags[tagKey] = !isOn;
            openEquipmentDetailModal(inst); // 再描画
        };
        tagContainer.appendChild(btn);
    });

    document.getElementById('equipment-detail-modal').classList.remove('hidden');
}

function closeEquipmentDetailModal() {
    document.getElementById('equipment-detail-modal').classList.add('hidden');
    // 一覧側の表示（お気に入りタグ表示）を最新化する
    renderEquipmentListScreen();
}

// -----------------------------------------------------
// PvP装備設定（マイマスモン一覧 → マスモン詳細から設定する）
// バトル開始時は各マスモンレコードの equip フィールド（masmons/{pid}/{key}/equip）を
// そのまま参照する。対戦のたびに選び直す必要はない。
// -----------------------------------------------------
let equipPickerTargetMasmon = null; // 装備アイテム一覧を「選択モード」で開いた際の対象マスモン

// マスモン詳細モーダルの「選ぶ」ボタンから、装備アイテム一覧を選択モードで開く
function openEquipPickerFromMasmonDetail() {
    if (!currentDetailMasmon) return;
    equipPickerTargetMasmon = currentDetailMasmon;
    document.getElementById('masmon-detail-modal').classList.add('hidden');
    showEquipmentListScreen();
}

// 装備アイテム一覧画面の「戻る」ボタン：通常モードならマイマスモンへ、
// 選択モードなら対象マスモンの詳細モーダルを開き直す
function closeEquipmentListScreen() {
    const target = equipPickerTargetMasmon;
    equipPickerTargetMasmon = null;
    showMasmonList();
    if (target) {
        // マイマスモン一覧の描画を待ってから詳細モーダルを再度開く
        setTimeout(() => openMasmonDetailModal(target), 50);
    }
}

// 選択モード用バナー（対象マスモン名・現在の装備・外すボタン）の描画
function renderEquipmentPickerBanner() {
    const banner = document.getElementById('equipment-list-picker-banner');
    if (!banner) return;

    if (!equipPickerTargetMasmon) {
        banner.classList.add('hidden');
        banner.innerHTML = '';
        return;
    }

    const m = equipPickerTargetMasmon;
    const base = m.equip ? EQUIPMENT_DB[m.equip.equipId] : null;
    banner.classList.remove('hidden');
    banner.innerHTML = `
        <div class="flex items-center justify-between">
            <span class="text-[10px] text-purple-200">🛡️ <b>${m.name}</b> の装備を選択中</span>
            <button onclick="unequipCurrentMasmonEquip()" class="flex-shrink-0 text-[9px] bg-red-950 hover:bg-red-900 border border-red-800 text-red-300 px-2 py-1 rounded-lg transition-all active:scale-95">外す</button>
        </div>
        <div class="text-[9px] text-gray-400 mt-1">現在: ${base ? base.icon + ' ' + base.name : '未装備'}</div>
    `;
}

// 一覧からアイテムをタップして、選択中のマスモンに装備させる
async function assignEquipToMasmon(m, inst) {
    if (!initFirebase()) return;
    try {
        await firebaseDb.ref(`masmons/${getMyPlayerId()}/${m.key}/equip`).set(inst);
        m.equip = inst;
        showToast(`🛡️ ${m.name} に【${getEquipmentDisplayName(inst)}】を装備しました。`);
        renderEquipmentPickerBanner();
        renderEquipmentListScreen();
    } catch (e) {
        console.error('[Firebase] 装備の設定エラー:', e);
        showToast('装備の設定に失敗しました。');
    }
}

// 選択中のマスモンの装備を外す
async function unequipCurrentMasmonEquip() {
    const m = equipPickerTargetMasmon;
    if (!m || !initFirebase()) return;
    try {
        await firebaseDb.ref(`masmons/${getMyPlayerId()}/${m.key}/equip`).remove();
        m.equip = null;
        showToast('装備を外しました。');
        renderEquipmentPickerBanner();
        renderEquipmentListScreen();
    } catch (e) {
        console.error('[Firebase] 装備解除エラー:', e);
        showToast('装備の解除に失敗しました。');
    }
}
