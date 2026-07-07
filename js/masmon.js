// =====================================================
// マスモン（クリア時モンスターデータ）管理機能
// Firebase Realtime Database: masmons/{playerId}/{masmonKey}
//                              masmon_owners/{playerId}
// =====================================================

const MASMON_MAX_SLOTS = 10;

// --- プレイヤー固有IDの取得（初回はランダム生成してlocalStorageへ保存） ---
function getMyPlayerId() {
    let pid = localStorage.getItem('mfload_player_id');
    if (!pid) {
        pid = 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
        localStorage.setItem('mfload_player_id', pid);
    }
    return pid;
}

// --- クリア時のプレイヤーモンスターから「マスモン」データを生成 ---
function buildMasmonPayload(nickname) {
    const p = GAME_STATE.player;
    let templateId = 'mochi';
    if (p.emoji === '👁️') templateId = 'suezo';
    if (p.emoji === '🦖') templateId = 'dino';
    if (p.emoji === '🗿') templateId = 'monolith';
    if (p.emoji === '🌸') templateId = 'plant';
    if (p.emoji === '🦊') templateId = 'kyubi';

    return {
        name: nickname,
        templateId: templateId,
        monsterBaseName: p.name,
        emoji: p.emoji,
        stats: {
            maxLife: p.stats.maxLife,
            pow: p.stats.pow,
            int: p.stats.int,
            hit: p.stats.hit,
            spd: p.stats.spd,
            def: p.stats.def,
            gutsSpeed: p.stats.gutsSpeed
        },
        skills: [...p.skills],
        skillEnhancements: JSON.parse(JSON.stringify(GAME_STATE.skillEnhancements || {})),
        aura: p.aura || null,
        statusEffect: GAME_STATE.playerStatusEffect || null,
        isAwakened: !!GAME_STATE.isAwakened,
        difficulty: GAME_STATE.difficulty,
        floor: GAME_STATE.floor - (GAME_STATE.lastGameWasClear ? 1 : 0),
        ownerId: getMyPlayerId(),
        ownerName: GAME_STATE.playerName,
        createdAt: Date.now()
    };
}

// --- 自分のマスモン一覧を取得 ---
async function fetchMyMasmons() {
    if (!initFirebase()) return [];
    const pid = getMyPlayerId();
    const snap = await firebaseDb.ref(`masmons/${pid}`).once('value');
    const list = [];
    snap.forEach(child => {
        list.push({ key: child.key, ...child.val() });
    });
    list.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    return list;
}

// --- 対戦相手検索用にオーナー情報を登録（フェーズ2以降で使用） ---
async function registerMasmonOwner() {
    if (!initFirebase()) return;
    try {
        await firebaseDb.ref(`masmon_owners/${getMyPlayerId()}`).set({
            name: GAME_STATE.playerName,
            updatedAt: Date.now()
        });
    } catch (e) {
        console.error('[Firebase] オーナー登録エラー:', e);
    }
}

// -----------------------------------------------------
// クリア画面：マスモン保存UI
// -----------------------------------------------------
let masmonExistingList = [];
let masmonSelectedOverwriteKey = null;

async function setupMasmonSaveSection() {
    const section = document.getElementById('masmon-save-section');
    if (!section) return;
    section.classList.remove('hidden');

    const nameInput = document.getElementById('masmon-name-input');
    const saveBtn = document.getElementById('masmon-save-btn');
    const statusEl = document.getElementById('masmon-save-status');
    const overwriteContainer = document.getElementById('masmon-overwrite-list');

    nameInput.value = '';
    nameInput.disabled = false;
    saveBtn.disabled = false;
    saveBtn.classList.remove('hidden');
    statusEl.textContent = '';
    overwriteContainer.classList.add('hidden');
    overwriteContainer.innerHTML = '';
    masmonSelectedOverwriteKey = null;

    if (!initFirebase()) {
        statusEl.textContent = 'Firebase未設定のため保存できません。';
        statusEl.className = 'text-[10px] text-center text-red-400';
        saveBtn.disabled = true;
        return;
    }

    masmonExistingList = await fetchMyMasmons();
    document.getElementById('masmon-save-count').textContent = masmonExistingList.length;

    if (masmonExistingList.length >= MASMON_MAX_SLOTS) {
        overwriteContainer.classList.remove('hidden');
        overwriteContainer.innerHTML = '<p class="text-[10px] text-amber-400 mb-1">⚠️ 保存上限です。上書きするマスモンを選んでください：</p>';
        masmonExistingList.forEach(m => {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'w-full text-left p-2 bg-[#1a120b] border border-purple-900 rounded-lg text-[11px] text-gray-300 flex justify-between items-center transition-all';
            row.innerHTML = `<span>${m.name}（${m.monsterBaseName} / ${m.floor}F）</span><span class="text-purple-400 font-bold overwrite-mark"></span>`;
            row.onclick = () => {
                masmonSelectedOverwriteKey = m.key;
                overwriteContainer.querySelectorAll('button').forEach(b => {
                    b.classList.remove('border-purple-400', 'bg-purple-950/50');
                    const mark = b.querySelector('.overwrite-mark');
                    if (mark) mark.textContent = '';
                });
                row.classList.add('border-purple-400', 'bg-purple-950/50');
                row.querySelector('.overwrite-mark').textContent = '選択中';
            };
            overwriteContainer.appendChild(row);
        });
    }
}

async function handleSaveMasmon() {
    const input = document.getElementById('masmon-name-input');
    const statusEl = document.getElementById('masmon-save-status');
    const name = (input.value || '').trim();

    if (!name) {
        statusEl.textContent = '名前を入力してください。';
        statusEl.className = 'text-[10px] text-center text-red-400';
        return;
    }
    if (masmonExistingList.length >= MASMON_MAX_SLOTS && !masmonSelectedOverwriteKey) {
        statusEl.textContent = '上書きするマスモンを選択してください。';
        statusEl.className = 'text-[10px] text-center text-red-400';
        return;
    }

    const btn = document.getElementById('masmon-save-btn');
    btn.disabled = true;
    statusEl.textContent = '保存中...';
    statusEl.className = 'text-[10px] text-center text-gray-400';

    try {
        const payload = buildMasmonPayload(name);
        const pid = getMyPlayerId();

        if (masmonSelectedOverwriteKey) {
            await firebaseDb.ref(`masmons/${pid}/${masmonSelectedOverwriteKey}`).set(payload);
        } else {
            await firebaseDb.ref(`masmons/${pid}`).push(payload);
        }
        await registerMasmonOwner();

        statusEl.textContent = `【${name}】をマスモンとして保存しました！`;
        statusEl.className = 'text-[10px] text-center text-emerald-400';
        input.value = '';
        input.disabled = true;
        btn.classList.add('hidden');
        document.getElementById('masmon-overwrite-list').classList.add('hidden');

        masmonExistingList = await fetchMyMasmons();
        document.getElementById('masmon-save-count').textContent = masmonExistingList.length;
    } catch (e) {
        console.error('[Firebase] マスモン保存エラー:', e);
        statusEl.textContent = '保存に失敗しました。通信環境をご確認ください。';
        statusEl.className = 'text-[10px] text-center text-red-400';
        btn.disabled = false;
    }
}

// -----------------------------------------------------
// マイマスモン一覧画面
// -----------------------------------------------------
function showMasmonList() {
    changeScreen('screen-masmon-list');
    renderMasmonList();
    if (typeof renderTransferCodeDisplay === 'function') renderTransferCodeDisplay();
}

async function renderMasmonList() {
    const container = document.getElementById('masmon-list-container');
    container.innerHTML = '<div class="text-center text-gray-500 text-xs py-8">読み込み中...</div>';

    if (!initFirebase()) {
        container.innerHTML = '<div class="text-center text-gray-500 text-xs py-8 leading-relaxed">Firebase未設定のため<br>マスモンを表示できません。</div>';
        return;
    }

    let list;
    try {
        list = await fetchMyMasmons();
    } catch (e) {
        console.error('[Firebase] マスモン取得エラー:', e);
        container.innerHTML = '<div class="text-center text-red-400 text-xs py-8">取得に失敗しました。</div>';
        return;
    }

    document.getElementById('masmon-list-count').textContent = list.length;

    if (list.length === 0) {
        container.innerHTML = '<div class="text-center text-gray-500 text-xs py-8 leading-relaxed">まだマスモンがいません。<br>ダンジョンをクリアして登録しよう！</div>';
        return;
    }

    container.innerHTML = '';
    list.forEach(m => {
        const card = document.createElement('div');
        card.className = 'bg-[#2a1b15] border border-purple-900/50 rounded-xl p-2.5 flex items-center space-x-2 cursor-pointer active:scale-[0.98] transition-all';
        // マスモンをタップするとそのモンスターの情報を表示する
        card.onclick = () => openMasmonDetailModal(m);

        const iconWrap = document.createElement('div');
        iconWrap.className = 'w-10 h-10 flex items-center justify-center text-2xl flex-shrink-0 bg-[#1a120b] rounded-full border border-purple-900/40';
        renderMonsterVisual(iconWrap, m.monsterBaseName, m.emoji, !!m.isAwakened, true);

        const info = document.createElement('div');
        info.className = 'flex-1 min-w-0';
        const skillNames = (m.skills || []).map(sk => (SKILLS_DB[sk] ? SKILLS_DB[sk].name : sk)).join('、');
        info.innerHTML = `
            <div class="text-xs font-bold text-purple-200 truncate">${m.name}<span class="text-[9px] text-gray-400 ml-1">（${m.monsterBaseName}）</span></div>
            <div class="text-[9px] text-gray-400 mt-0.5">HP${m.stats.maxLife} / ちから${m.stats.pow} / かしこさ${m.stats.int} / 命中${m.stats.hit} / 回避${m.stats.spd} / 丈夫さ${m.stats.def}</div>
            <div class="text-[9px] text-gray-500 truncate mt-0.5">技: ${skillNames}</div>
            <div class="text-[8px] text-amber-700 mt-0.5">${m.difficulty === 'hard' ? 'HARD' : 'NORMAL'} ${m.floor}F到達</div>
        `;

        const delBtn = document.createElement('button');
        delBtn.className = 'flex-shrink-0 text-[10px] bg-red-950 hover:bg-red-900 border border-red-800 text-red-300 px-2 py-1 rounded-lg transition-all active:scale-95';
        delBtn.textContent = '削除';
        delBtn.onclick = (ev) => {
            ev.stopPropagation(); // カードタップ（情報表示）と競合しないようにする
            deleteMasmon(m.key);
        };

        const btnGroup = document.createElement('div');
        btnGroup.className = 'flex-shrink-0 flex flex-col space-y-1';

        const battleBtn = document.createElement('button');
        battleBtn.className = 'text-[10px] bg-purple-800 hover:bg-purple-700 border border-purple-600 text-white px-2 py-1 rounded-lg transition-all active:scale-95 font-bold';
        battleBtn.textContent = '⚔️ 対戦';
        battleBtn.onclick = (ev) => {
            ev.stopPropagation(); // カードタップ（情報表示）と競合しないようにする
            openItemSelectForSolo(m);
        };

        btnGroup.appendChild(battleBtn);
        btnGroup.appendChild(delBtn);

        card.appendChild(iconWrap);
        card.appendChild(info);
        card.appendChild(btnGroup);
        container.appendChild(card);
    });
}

async function deleteMasmon(key) {
    if (!initFirebase()) return;
    if (!confirm('このマスモンを削除しますか？')) return;
    try {
        await firebaseDb.ref(`masmons/${getMyPlayerId()}/${key}`).remove();
        showToast('マスモンを削除しました。');
        renderMasmonList();
    } catch (e) {
        console.error('[Firebase] マスモン削除エラー:', e);
        showToast('削除に失敗しました。');
    }
}

// -----------------------------------------------------
// マスモン情報詳細モーダル（マイマスモンのマスモンをタップすると表示）
// -----------------------------------------------------
let currentDetailMasmon = null; // 装備アイテム一覧から戻ってきた際に再表示するため保持する

function openMasmonDetailModal(m) {
    currentDetailMasmon = m;
    const iconWrap = document.getElementById('masmon-detail-icon');
    iconWrap.innerHTML = '';
    renderMonsterVisual(iconWrap, m.monsterBaseName, m.emoji, !!m.isAwakened, true);

    document.getElementById('masmon-detail-name').textContent = m.name;
    document.getElementById('masmon-detail-base').textContent = `（${m.monsterBaseName}）`;
    document.getElementById('masmon-detail-owner').textContent = `オーナー: ${m.ownerName || '-'}`;

    document.getElementById('masmon-detail-hp').textContent = m.stats.maxLife;
    document.getElementById('masmon-detail-pow').textContent = m.stats.pow;
    document.getElementById('masmon-detail-int').textContent = m.stats.int;
    document.getElementById('masmon-detail-hit').textContent = m.stats.hit;
    document.getElementById('masmon-detail-spd').textContent = m.stats.spd;
    document.getElementById('masmon-detail-def').textContent = m.stats.def;

    document.getElementById('masmon-detail-status-effect').textContent = m.statusEffect || 'なし';
    document.getElementById('masmon-detail-awakened').textContent = m.isAwakened ? '覚醒済み ✨' : '未覚醒';

    document.getElementById('masmon-detail-difficulty').textContent = m.difficulty === 'hard' ? 'HARD' : 'NORMAL';
    document.getElementById('masmon-detail-floor').textContent = `${m.floor}F到達`;

    updateMasmonDetailEquipDisplay(m);

    const skillsContainer = document.getElementById('masmon-detail-skills');
    skillsContainer.innerHTML = '';
    (m.skills || []).forEach(skKey => {
        const sk = SKILLS_DB[skKey];
        if (!sk) return;
        const enh = (m.skillEnhancements && m.skillEnhancements[skKey]) || { forceBonus: 0, hitBonus: 0, level: 0 };
        const isEnhanced = enh.level > 0;
        const effForce = sk.force + (enh.forceBonus || 0);
        const effHitRate = sk.hitRate === 100 ? 100 : Math.min(99, sk.hitRate + (enh.hitBonus || 0));
        const rank = getDamageRank(effForce, sk.type);

        const row = document.createElement('div');
        row.className = `text-[10px] p-1.5 rounded border flex justify-between items-center ${isEnhanced ? 'bg-[#1e0f3a] border-purple-400' : 'bg-[#150b07] border-purple-950'}`;
        const enhBadge = isEnhanced
            ? `<span class="text-[8px] bg-purple-900 text-purple-200 px-1 py-0.5 rounded font-bold ml-1">⚔️Lv.${enh.level}</span>`
            : '';
        const hitText = sk.hitRate === 100 ? '必中' : `命中:${effHitRate}%`;
        row.innerHTML = `
            <span class="text-gray-200 font-bold">${sk.name}${enhBadge}</span>
            <span class="text-gray-400 flex items-center space-x-1.5">
                <span>ランク:${rank}</span>
                <span>${hitText}</span>
                <span>G:${sk.cost}</span>
            </span>
        `;
        skillsContainer.appendChild(row);
    });

    document.getElementById('masmon-detail-modal').classList.remove('hidden');
}

function closeMasmonDetailModal() {
    document.getElementById('masmon-detail-modal').classList.add('hidden');
}

// 装備アイテムセクションの表示更新（未装備の場合は「未装備」を表示）
function updateMasmonDetailEquipDisplay(m) {
    const iconEl = document.getElementById('masmon-detail-equip-icon');
    const nameEl = document.getElementById('masmon-detail-equip-name');
    const descEl = document.getElementById('masmon-detail-equip-desc');
    if (!iconEl || !nameEl || !descEl) return;

    const eq = m.equip;
    const base = eq ? EQUIPMENT_DB[eq.equipId] : null;
    if (base) {
        iconEl.textContent = base.icon;
        nameEl.textContent = `${base.name}（${base.rarity}）`;
        descEl.textContent = getEquipmentDisplayDesc(eq);
    } else {
        iconEl.textContent = '🚫';
        nameEl.textContent = '未装備';
        descEl.textContent = '';
    }
}
