// =====================================================
// マスモン登録 引き継ぎコード機能
// PlayerID (localStorage: mfload_player_id) をコード化して表示・復元する。
// Firebase側の保存構造（masmons/{playerId}, masmon_owners/{playerId}）は変更しない。
// =====================================================

const MASMON_TRANSFER_SEEN_KEY = 'mfload_transfer_code_seen';

// --- 表示用にハイフン区切りへ整形（保存されているPlayerID自体は変更しない） ---
function formatTransferCodeForDisplay(pid) {
    if (!pid) return '----';
    const mid = Math.ceil(pid.length / 2);
    return `${pid.slice(0, mid)}-${pid.slice(mid)}`;
}

// --- 入力されたコードから表示用ハイフン等を除去し、元のPlayerID文字列に戻す ---
function normalizeTransferCodeInput(raw) {
    return (raw || '').trim().replace(/[\s-]/g, '');
}

// --- マイマスモン画面などの「引き継ぎコード」表示エリアを更新 ---
function renderTransferCodeDisplay() {
    const el = document.getElementById('transfer-code-display');
    if (!el) return;
    el.textContent = formatTransferCodeForDisplay(getMyPlayerId());
}

// --- クリップボードへ元のPlayerID文字列（ハイフンなし）をコピー ---
async function copyToClipboardFallback(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch (e) {
        try {
            const tmp = document.createElement('textarea');
            tmp.value = text;
            tmp.style.position = 'fixed';
            tmp.style.opacity = '0';
            document.body.appendChild(tmp);
            tmp.select();
            document.execCommand('copy');
            document.body.removeChild(tmp);
            return true;
        } catch (e2) {
            return false;
        }
    }
}

async function copyTransferCode() {
    const ok = await copyToClipboardFallback(getMyPlayerId());
    showToast(ok ? '📋 引き継ぎコードをコピーしました！' : '⚠️ コピーに失敗しました。手動で選択してください。');
}

async function copyFirstTimeTransferCode() {
    await copyTransferCode();
}

// -----------------------------------------------------
// 復元：入力モーダル
// -----------------------------------------------------
function openRestoreCodeModal() {
    const input = document.getElementById('restore-code-input');
    if (input) input.value = '';
    const modal = document.getElementById('restore-code-modal');
    if (modal) modal.classList.remove('hidden');
}

function closeRestoreCodeModal() {
    const modal = document.getElementById('restore-code-modal');
    if (modal) modal.classList.add('hidden');
}

function showRestoreErrorModal() {
    const modal = document.getElementById('restore-error-modal');
    if (modal) modal.classList.remove('hidden');
}

function closeRestoreErrorModal() {
    const modal = document.getElementById('restore-error-modal');
    if (modal) modal.classList.add('hidden');
}

async function submitRestoreCode() {
    const input = document.getElementById('restore-code-input');
    if (!input) return;

    const candidatePid = normalizeTransferCodeInput(input.value);
    if (!candidatePid) {
        showToast('⚠️ 引き継ぎコードを入力してください。');
        return;
    }

    if (!initFirebase()) {
        showToast('⚠️ 通信環境を確認してください。');
        return;
    }

    const btn = document.getElementById('restore-code-submit-btn');
    const originalLabel = btn ? btn.textContent : '';
    if (btn) {
        btn.disabled = true;
        btn.textContent = '確認中...';
    }

    try {
        const [ownerSnap, masmonSnap] = await Promise.all([
            firebaseDb.ref(`masmon_owners/${candidatePid}`).once('value'),
            firebaseDb.ref(`masmons/${candidatePid}`).once('value')
        ]);

        if (ownerSnap.exists() || masmonSnap.exists()) {
            // 復元成功：PlayerIDを書き換えるだけで既存のマスモンデータへ以後アクセスできるようになる
            localStorage.setItem('mfload_player_id', candidatePid);
            localStorage.setItem(MASMON_TRANSFER_SEEN_KEY, '1'); // 既に把握済みのコードなので初回案内は不要
            closeRestoreCodeModal();
            showToast('✅ データを復元しました。再読み込みします…');
            setTimeout(() => location.reload(), 900);
        } else {
            closeRestoreCodeModal();
            showRestoreErrorModal();
        }
    } catch (e) {
        console.error('[引き継ぎコード] 復元エラー:', e);
        showToast('⚠️ 通信エラーが発生しました。もう一度お試しください。');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = originalLabel || '復元';
        }
    }
}

// -----------------------------------------------------
// 初回ユーザー向け案内
// -----------------------------------------------------
function maybeShowFirstTimeTransferNotice() {
    if (localStorage.getItem(MASMON_TRANSFER_SEEN_KEY)) return;

    const pid = getMyPlayerId(); // 未生成ならここで生成される
    const codeEl = document.getElementById('first-time-code-display');
    if (codeEl) codeEl.textContent = formatTransferCodeForDisplay(pid);

    const modal = document.getElementById('first-time-transfer-modal');
    if (modal) modal.classList.remove('hidden');
}

function closeFirstTimeTransferNotice() {
    localStorage.setItem(MASMON_TRANSFER_SEEN_KEY, '1');
    const modal = document.getElementById('first-time-transfer-modal');
    if (modal) modal.classList.add('hidden');
}

// --- 初回起動時の案内表示（ページ読み込み完了後） ---
window.addEventListener('load', () => {
    maybeShowFirstTimeTransferNotice();
});
