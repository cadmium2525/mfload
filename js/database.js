// --- モンスターデータベース ---
const MONSTER_TEMPLATES = {
    mochi: {
        id: 'mochi',
        name: 'モッチー',
        emoji: '🍪',
        desc: '丸くて愛らしいが、バランスの取れた優秀な能力と強力なガッツ回復力を持つ。',
        stats: { maxLife: 220, life: 220, pow: 45, int: 35, hit: 55, spd: 45, def: 40, gutsSpeed: 16 }
    },
    suezo: {
        id: 'suezo',
        name: 'スエゾー',
        emoji: '👁️',
        desc: '単眼の奇妙なモンスター。かしこさと命中が非常に高く、トリッキーな技が得意。',
        stats: { maxLife: 180, life: 180, pow: 30, int: 60, hit: 65, spd: 40, def: 30, gutsSpeed: 14 }
    },
    dino: {
        id: 'dino',
        name: 'ディノ',
        emoji: '🦖',
        desc: '恐竜のような獰猛な外見。ちからと丈夫さに優れ、大ダメージを与える大技を放つ。',
        stats: { maxLife: 250, life: 250, pow: 60, int: 25, hit: 45, spd: 35, def: 50, gutsSpeed: 12 }
    },
    monolith: {
        id: 'monolith',
        name: 'モノリス',
        emoji: '🗿',
        desc: '古代より佇む謎の岩石生命体。動きは鈍く回避は苦手だが、岩の肉体は並外れた丈夫さを誇り、ちから・かしこさ両面の技を使いこなす。',
        stats: { maxLife: 235, life: 235, pow: 48, int: 44, hit: 42, spd: 26, def: 62, gutsSpeed: 13 }
    }
};

// --- 技データベース (ダメージランク対応) ---
const SKILLS_DB = {
    // --- モッチー系統 ---
    monta: { name: 'もんた', cost: 15, type: 'pow', hitRate: 85, force: 0.8, gutsDown: 10, effect: null, desc: '小さな手で叩く基本技。相手GUTS-10' },
    mochiki: { name: 'もちき', cost: 20, type: 'pow', hitRate: 75, force: 1.2, gutsDown: 5, effect: null, desc: '力を込めて押しつぶす。相手GUTS-5' },
    gaccho: { name: 'ガッチョ', cost: 30, type: 'pow', hitRate: 80, force: 1.5, gutsDown: 12, effect: null, desc: '突っ張りによる連続攻撃。相手GUTS-12' },
    sakurafubuki: { name: 'さくら吹雪', cost: 25, type: 'int', hitRate: 85, force: 1.3, gutsDown: 10, effect: null, desc: '桜の花びらを舞い散らせる。相手GUTS-10' },
    cho_rollinmochi: { name: '超ローリンモッチ', cost: 40, type: 'pow', hitRate: 65, force: 2.3, gutsDown: 20, effect: null, desc: '大回転して激突する。相手GUTS-20' },
    cho_mochihou: { name: '超もっち砲', cost: 45, type: 'int', hitRate: 70, force: 2.5, gutsDown: 15, effect: null, desc: '最大出力のエネルギー弾。相手GUTS-15' },
    mossama: { name: 'もっさま', cost: 35, type: 'pow', hitRate: 75, force: 1.8, gutsDown: 25, effect: null, desc: '強烈な威圧を伴う打撃。相手GUTS-25' },
    yaezakura: { name: '八重ざくら', cost: 30, type: 'heal', hitRate: 100, force: 0, gutsDown: 0, effect: 'heal_hp', desc: '桜の結界でライフを大幅回復する' },

    // --- スエゾー系統 ---
    shippobinta: { name: 'しっぽビンタ', cost: 15, type: 'pow', hitRate: 85, force: 0.8, gutsDown: 15, effect: null, desc: 'しっぽで往復ビンタ。相手GUTS-15' },
    nameru: { name: 'なめる', cost: 15, type: 'int', hitRate: 100, force: 0.4, gutsDown: 15, effect: null, desc: '不快な舌舐め攻撃。回避を完全に無視して【必中】する！相手GUTS-15' },
    kamitsuki: { name: 'かみつき', cost: 20, type: 'pow', hitRate: 75, force: 1.2, gutsDown: 10, effect: null, desc: '大きな口で噛みつく基本技。相手GUTS-10' },
    kuu: { name: '食う', cost: 35, type: 'pow', hitRate: 70, force: 1.8, gutsDown: 20, effect: null, desc: '丸呑みして締め付ける。相手GUTS-20' },
    psychokinesis: { name: 'サイコキネシス', cost: 45, type: 'int', hitRate: 75, force: 2.2, gutsDown: 30, effect: null, desc: '強力な念動力攻撃。相手GUTS-30' },
    cho_netsushisen: { name: '超熱視線', cost: 40, type: 'int', hitRate: 80, force: 2.0, gutsDown: 20, effect: null, desc: '眼から放つ熱線攻撃。相手GUTS-20' },
    utau: { name: '歌う', cost: 30, type: 'int', hitRate: 95, force: 0.2, gutsDown: 45, effect: null, desc: '音痴な歌声で相手を悶絶させる。相手GUTS-45' },
    berobinta: { name: 'ベロビンタ', cost: 25, type: 'pow', hitRate: 80, force: 1.4, gutsDown: 15, effect: null, desc: '長い舌で叩きつける。相手GUTS-15' },

    // --- ディノ系統 ---
    shippo: { name: 'しっぽ', cost: 15, type: 'pow', hitRate: 85, force: 0.9, gutsDown: 5, effect: null, desc: '力強いしっぽの叩きつけ。相手GUTS-5' },
    kamitsuki_dino: { name: 'かみつき', cost: 20, type: 'pow', hitRate: 75, force: 1.3, gutsDown: 5, effect: null, desc: '鋭いキバで噛みつく基本技。相手GUTS-5' },
    sunakake: { name: '砂かけ', cost: 15, type: 'int', hitRate: 90, force: 0.6, gutsDown: 20, effect: null, desc: '砂をかけて視界と闘志を奪う。相手GUTS-20' },
    kamitsukinage: { name: 'かみつき投げ', cost: 35, type: 'pow', hitRate: 70, force: 1.9, gutsDown: 10, effect: null, desc: '噛みついたまま投げ飛ばす。相手GUTS-10' },
    honoo_taiatari: { name: '炎のたいあたり', cost: 40, type: 'pow', hitRate: 65, force: 2.4, gutsDown: 15, effect: null, desc: '燃え盛る炎を纏って突進する。相手GUTS-15' },
    hizageri: { name: 'ひざげり', cost: 25, type: 'pow', hitRate: 80, force: 1.5, gutsDown: 10, effect: null, desc: '鋭い跳び膝蹴りを叩き込む。相手GUTS-10' },
    kurohizacombo: { name: '黒ひざコンボ', cost: 50, type: 'pow', hitRate: 75, force: 2.8, gutsDown: 15, effect: null, desc: '連続で膝蹴りを叩き込む破壊技。相手GUTS-15' },

    // --- モノリス系統 ---
    monotaore: { name: 'たおれこみ', cost: 15, type: 'pow', hitRate: 85, force: 0.8, gutsDown: 10, effect: null, desc: '巨体を活かした体当たり基本技。相手GUTS-10' },
    warawara: { name: 'わらわら', cost: 25, type: 'pow', hitRate: 80, force: 1.1, gutsDown: 15, effect: 'weaken_pow_int', desc: '奇妙な唸り声で相手を威圧する。相手GUTS-15。さらに3ターンの間、相手の「ちから」「かしこさ」を10%低下させる' },
    cho_monotaore: { name: '超たおれこみ', cost: 40, type: 'pow', hitRate: 70, force: 1.8, gutsDown: 20, effect: null, desc: '全体重を乗せた渾身の体当たり。相手GUTS-20' },
    sanren_attack: { name: '3連アタック', cost: 50, type: 'pow', hitRate: 70, force: 2.8, gutsDown: 25, effect: null, desc: '硬い岩の腕を叩きつける三段攻撃。相手GUTS-25' },
    sakebigoe: { name: 'サケビ声', cost: 20, type: 'int', hitRate: 95, force: 0.75, gutsDown: 15, effect: 'confuse_30', desc: '甲高い叫び声で相手の精神を揺さぶる高命中技。相手GUTS-15。さらに命中した場合、3回の行動の間30%の確率で相手を混乱させる（混乱中は行動に失敗する）' },
    aurora_gate: { name: 'オーロラゲート', cost: 30, type: 'int', hitRate: 80, force: 1.7, gutsDown: 15, effect: 'next_force_up', desc: '虹色の門を展開し力を収束させる。相手GUTS-15。さらに命中した場合、自身が次に繰り出す技の威力が50%アップする' },
    trio_beam_z: { name: 'トリオビームZ', cost: 55, type: 'int', hitRate: 65, force: 2.8, gutsDown: 30, effect: null, desc: '三条の破壊光線を放つ最大出力の切り札。相手GUTS-30' },

    // --- 敵・ボス共用 ---
    boss_bite: { name: 'かみつき', cost: 20, type: 'pow', hitRate: 75, force: 1.2, gutsDown: 10, effect: null, desc: '鋭い牙でガッツを奪う攻撃' },
    boss_roll: { name: 'ローリング激突', cost: 40, type: 'pow', hitRate: 65, force: 2.4, gutsDown: 20, effect: null, desc: '大回転で激突してガッツを奪う' },
    boss_focus: { name: 'きあい', cost: 10, type: 'buff_pow', hitRate: 100, force: 0, gutsDown: 0, effect: 'pow_up', desc: '攻撃力を上昇させる' },
    boss_laser: { name: 'サイコブラスト', cost: 45, type: 'int', hitRate: 70, force: 2.6, gutsDown: 30, effect: null, desc: '精神力を収束させた衝撃波' },
    boss_meteor: { name: 'メテオバースト', cost: 55, type: 'int', hitRate: 70, force: 3.2, gutsDown: 45, effect: null, desc: '巨大な隕石を放つ大技' }
};

// --- ステータス獲得逓減システム (Diminishing Returns) ---
function getDiminishedVal(currentVal, baseVal) {
    let result = baseVal;
    if (currentVal >= 250) {
        result = Math.ceil(baseVal * 0.25); // 250以上は成長量25%に激減
    } else if (currentVal >= 180) {
        result = Math.ceil(baseVal * 0.5);  // 180以上は成長量50%に半減
    } else if (currentVal >= 120) {
        result = Math.ceil(baseVal * 0.75); // 120以上は成長量75%
    }
    return Math.max(1, result); // 最低でも必ず1は成長する
}

// --- ガッツ補正計算ヘルパー ---
function getGutsModifiers(guts) {
    // 攻撃側のガッツが50を基準(1.0)とする
    // ガッツ0で最低補正(ダメージ0.5倍、命中-15%)
    // ガッツ100で最高補正(ダメージ1.5倍、命中+15%)
    const base = 50;
    const diff = guts - base;
    
    const dmgMod = 1.0 + (diff * 0.01); // 0.5倍 〜 1.5倍
    const hitMod = diff * 0.3;          // -15% 〜 +15%
    
    return { dmgMod, hitMod };
}

// --- ガッツ防御（被ダメージ軽減）計算ヘルパー (本家再現) ---
function getGutsDefenseModifier(guts) {
    // 防御側のガッツ量に応じた被ダメージ倍率を算出
    // ガッツ100（最大値）：受けるダメージを50%軽減（0.5倍）
    // ガッツ50（通常）：受けるダメージは等倍（1.0倍）
    // ガッツ0（枯渇）：受けるダメージが1.5倍に激増
    const base = 50;
    const diff = guts - base;
    return 1.0 - (diff * 0.01); // 0.5倍（ガッツ100）〜 1.5倍（ガッツ0）
}

// --- ダメージランク判定ヘルパー ---
function getDamageRank(force, type) {
    if (type === 'heal' || type === 'buff_guts' || type === 'buff_pow') return 'G';
    if (force >= 2.5) return 'S';
    if (force >= 2.0) return 'A';
    if (force >= 1.6) return 'B';
    if (force >= 1.3) return 'C';
    if (force >= 1.0) return 'D';
    if (force >= 0.7) return 'E';
    if (force >= 0.3) return 'F';
    return 'G';
}

// =====================================================
// 新規状態効果ヘルパー（モノリスの技「わらわら」「サケビ声」「オーロラゲート」用）
// 育成中バトル(game.js)／マスモンCPU対戦(masmon_battle.js)／
// リアルタイム対戦(masmon_realtime_battle.js) の3系統から共通で利用する。
// 対象ユニットは weakenTurns / confuseTurns / forceBoost の3フィールドを持つ前提。
// =====================================================

// --- 技が命中した際の追加効果（衰弱／混乱／次技威力アップ）を適用する ---
// caster: 技を撃った側のユニット, target: 技を受けた側のユニット, sk: 実効技データ（force/hitRate反映済み）
// 戻り値: 追加効果のログメッセージ配列
function applySkillOnHitEffect(caster, target, sk) {
    const logs = [];
    if (!sk || !sk.effect) return logs;

    if (sk.effect === 'weaken_pow_int') {
        target.weakenTurns = 3;
        logs.push(`💢 ${target.name} の「ちから」「かしこさ」が3ターンの間10%低下した！`);
    } else if (sk.effect === 'confuse_30') {
        target.confuseTurns = 3;
        logs.push(`❓ ${target.name} は混乱状態になった！（3回の行動の間、30%の確率で行動に失敗する）`);
    } else if (sk.effect === 'next_force_up') {
        caster.forceBoost = 0.5;
        logs.push(`✨ ${caster.name} の次の技の威力が50%アップした！`);
    }
    return logs;
}

// --- そのユニットの行動ターン開始時に呼び出す：衰弱／混乱の残ターン消化と混乱判定 ---
// 戻り値: { confused: true/false } - confused=true の場合、そのターンは混乱により行動失敗
function tickStatusTurnsAndCheckConfusion(unit) {
    if (!unit) return { confused: false };
    if (unit.weakenTurns > 0) unit.weakenTurns--;
    if (unit.confuseTurns > 0) {
        unit.confuseTurns--;
        if (Math.random() < 0.30) {
            return { confused: true };
        }
    }
    return { confused: false };
}

// --- 衰弱状態を加味した実効ステータス値（ちから／かしこさ）を返す ---
function getWeakenedStat(unit, statVal) {
    if (unit && unit.weakenTurns > 0) {
        return Math.floor(statVal * 0.9);
    }
    return statVal;
}

// --- 次技威力アップ（オーロラゲート等）を加味した実効forceを返し、フラグを消費する ---
function consumeForceBoost(unit, baseForce) {
    if (unit && unit.forceBoost > 0) {
        const boosted = baseForce * (1 + unit.forceBoost);
        unit.forceBoost = 0;
        return boosted;
    }
    return baseForce;
}

// --- トレーニングデータベース ---
const TRAINING_DB = [
    { id: 'run', name: '走り込み', cost: 20, mainStat: 'maxLife', mainVal: 15, desc: 'ライフが増加する軽めのトレーニング。', type: 'light' },
    { id: 'domino', name: 'ドミノ倒し', cost: 20, mainStat: 'pow', mainVal: 15, desc: '集中力を切らさずちからが増加する。', type: 'light' },
    { id: 'study', name: '猛勉強', cost: 20, mainStat: 'int', mainVal: 15, desc: '書を読みふけりかしこさが増加する。', type: 'light' },
    { id: 'shoot', name: 'しゃてき', cost: 20, mainStat: 'hit', mainVal: 15, desc: '的な正確に狙い命中が増加する。', type: 'light' },
    { id: 'dodge', name: '巨石よけ', cost: 20, mainStat: 'spd', mainVal: 15, desc: '降る岩を避けて回避が増加する。', type: 'light' },
    { id: 'wood', name: '丸太うけ', cost: 20, mainStat: 'def', mainVal: 15, desc: '体当たりを受け止め丈夫さが増加。', type: 'light' },
    
    // 重トレーニング
    { id: 'pull', name: '重り引き', cost: 35, mainStat: 'pow', mainVal: 25, extraStat: 'maxLife', extraVal: 15, penaltyStat: 'spd', penaltyVal: 10, desc: 'ちからが大増加・ライフが増加、回避が減少。', type: 'heavy' },
    { id: 'meditate', name: 'めいそう', cost: 35, mainStat: 'int', mainVal: 25, extraStat: 'hit', extraVal: 15, penaltyStat: 'def', penaltyVal: 10, desc: 'かしこさが大増加・命中が増加、丈夫さが減少。', type: 'heavy' },
    { id: 'floor', name: '変動ゆか', cost: 35, mainStat: 'spd', mainVal: 25, extraStat: 'int', extraVal: 15, penaltyStat: 'pow', penaltyVal: 10, desc: '回避が大増加・かしこさが増加、ちからが減少。', type: 'heavy' },
    { id: 'pool', name: 'プール', cost: 35, mainStat: 'def', mainVal: 25, extraStat: 'maxLife', extraVal: 15, penaltyStat: 'int', penaltyVal: 10, desc: '丈夫さが大増加・ライフが増加、かしこさが減少。', type: 'heavy' }
];

// --- アイテムデータベース ---
const ITEMS_DB = {
    energy_drink: { id: 'energy_drink', name: '消夏ドリンク', icon: '🧪', desc: '体力を 30 回復する。ブリーダー御用達のドリンク。', type: 'fatigue', value: 30 },
    guts_drink: { id: 'guts_drink', name: '万華ドリンク', icon: '🍷', desc: '体力を 60 回復する。疲労を急速に吹き飛ばす秘薬。', type: 'fatigue', value: 60 },
    power_jelly: { id: 'power_jelly', name: 'ちからの飴', icon: '🍬', desc: 'ちからが永続的にアップする(高ステータス時逓減あり)。', type: 'stat', stat: 'pow', value: 10 },
    smart_jelly: { id: 'smart_jelly', name: 'かしこさの飴', icon: '🍭', desc: 'かしこさが永続的にアップする(高ステータス時逓減あり)。', type: 'stat', stat: 'int', value: 10 },
    hp_bread: { id: 'hp_bread', name: 'ライフパン', icon: '🍞', desc: '最大ライフがアップし、さらにライフも同量回復する。', type: 'stat', stat: 'maxLife', value: 15 },
    
    // トレーニング効果アップアイテム
    steel_domino: { id: 'steel_domino', name: '鋼鉄ドミノ', icon: '🏋️', desc: '次回のドミノ倒しのトレーニング効果が2倍になる超重量ドミノ。', type: 'train_boost', targetTraining: 'domino', multiplier: 2.0 },
    silent_room: { id: 'silent_room', name: '無音ルーム', icon: '🔕', desc: '次回のめいそうのトレーニング効果が2倍になる完全防音の修練室。', type: 'train_boost', targetTraining: 'meditate', multiplier: 2.0 },
    speed_track: { id: 'speed_track', name: '高速トラック', icon: '🏃', desc: '次回の走り込みのトレーニング効果が2倍になるプロ仕様のコース。', type: 'train_boost', targetTraining: 'run', multiplier: 2.0 },
    sniper_scope: { id: 'sniper_scope', name: '精密スコープ', icon: '🔭', desc: '次回のしゃてきのトレーニング効果が2倍になる超精密照準器。', type: 'train_boost', targetTraining: 'shoot', multiplier: 2.0 },
    boulder_suit: { id: 'boulder_suit', name: '岩石スーツ', icon: '🪨', desc: '次回の巨石よけのトレーニング効果が2倍になる特製加重スーツ。', type: 'train_boost', targetTraining: 'dodge', multiplier: 2.0 },
    iron_log: { id: 'iron_log', name: '鋼鉄丸太', icon: '⚙️', desc: '次回の丸太うけのトレーニング効果が2倍になる超重量丸太。', type: 'train_boost', targetTraining: 'wood', multiplier: 2.0 },
    
    // 行き先選択型コンパス
    compass_battle: { id: 'compass_battle', name: '運命のコンパス', icon: '🧭', desc: '使用すると、次の探索先を自分で自由に選択できる。', type: 'compass', target: 'any' },
    compass_train: { id: 'compass_train', name: '運命のコンパス', icon: '🧭', desc: '使用すると、次の探索先を自分で自由に選択できる。', type: 'compass', target: 'any' },
    compass_event: { id: 'compass_event', name: '運命のコンパス', icon: '🧭', desc: '使用すると、次の探索先を自分で自由に選択できる。', type: 'compass', target: 'any' }
};

// --- 敵テンプレート (種族反映) ---
const ENEMY_TEMPLATES = [
    { name: 'ハム', emoji: '🐇', type: 'ハム種', maxLife: 90, pow: 25, int: 20, hit: 40, spd: 45, def: 20, skills: ['shippobinta'] },
    { name: 'アローヘッド', emoji: '🦀', type: 'アローヘッド種', maxLife: 110, pow: 35, int: 15, hit: 35, spd: 20, def: 55, skills: ['kamitsuki'] },
    { name: 'ネンドロ', emoji: '👤', type: 'ネンドロ種', maxLife: 100, pow: 20, int: 35, hit: 45, spd: 30, def: 35, skills: ['nameru'] }, // なめる（必中技）持ち
    { name: 'ヘンガー', emoji: '🤖', type: 'ヘンガー種', maxLife: 95, pow: 35, int: 30, hit: 55, spd: 30, def: 40, skills: ['kamitsuki', 'sunakake'] },
    { name: 'プラント', emoji: '🌸', type: 'プラント種', maxLife: 130, pow: 15, int: 40, hit: 40, spd: 25, def: 30, skills: ['nameru'] } // なめる（必中技）持ち
];

// 各ボスの強さ
const BOSS_TEMPLATES = {
    10: { name: '中ボス：ゴビ', emoji: '🗿', type: 'ゴーレム種', maxLife: 210, pow: 75, int: 10, hit: 30, spd: 10, def: 45, skills: ['boss_bite', 'boss_roll'] },
    20: { name: '中ボス：デュラハン', emoji: '🛡️', type: 'デュラハン種', maxLife: 320, pow: 28, int: 14, hit: 30, spd: 40, def: 55, skills: ['boss_bite', 'boss_roll', 'boss_focus'] },
    // モストに低消費ガッツ技および必中技を完備してハメを封殺
    30: { name: '伝説の邪神：モスト', emoji: '👿', type: 'モッチー種', maxLife: 550, pow: 42, int: 42, hit: 65, spd: 50, def: 65, skills: ['boss_bite', 'nameru', 'boss_laser', 'boss_roll', 'boss_laser', 'boss_meteor'] }
};

// --- イベント＆修行データベース ---
const GENERAL_EVENTS = [
    {
        title: 'あやしい商人のテント',
        visual: '🎪',
        desc: '怪しいローブをまとったブリーダーが薬を差し出してきた。「これを飲めばステータスが劇的に変わるぞ…」',
        choices: [
            {
                text: '怪薬を飲む（ギャンブル）',
                action: (player) => {
                    const isSuccess = Math.random() > 0.5;
                    if (isSuccess) {
                        const gainP = getDiminishedVal(player.stats.pow, 20);
                        const gainI = getDiminishedVal(player.stats.int, 20);
                        player.stats.pow += gainP;
                        player.stats.int += gainI;
                        return `大成功！ちからが+${gainP}、かしこさが+${gainI}アップした！`;
                    } else {
                        player.stats.maxLife = Math.max(100, player.stats.maxLife - 20);
                        player.stats.life = Math.min(player.stats.maxLife, player.stats.life);
                        return `うっ、体に毒が回った…！最大ライフが20ダウンした。`;
                    }
                }
            },
            {
                text: '怪しいので断る',
                action: (player) => {
                    player.stats.life = player.stats.maxLife;
                    return `断ると商人は消え去った。一安心したモンスターは深くリラックスし、ライフが全回復した。`;
                }
            }
        ]
    },
    {
        title: '不思議な黄金桃の木',
        visual: '🍑',
        desc: 'モンスターファーム伝説の「黄金桃」に似た、輝く果実が実っています。',
        choices: [
            {
                text: '桃を分け合って食べる',
                action: (player) => {
                    const gainL = getDiminishedVal(player.stats.maxLife, 25);
                    const gainD = getDiminishedVal(player.stats.def, 10);
                    player.stats.maxLife += gainL;
                    player.stats.life = Math.min(player.stats.maxLife, player.stats.life + 70);
                    player.stats.def += gainD;
                    return `活力がみなぎる！最大ライフが+${gainL}、丈夫さが+${gainD}アップし、ライフが70回復した！`;
                }
            },
            {
                text: 'お守りとして持ち帰る',
                action: (player) => {
                    const gainS = getDiminishedVal(player.stats.spd, 15);
                    const gainH = getDiminishedVal(player.stats.hit, 15);
                    player.stats.spd += gainS;
                    player.stats.hit += gainH;
                    return `体が軽くなった気がする！回避が+${gainS}、命中が+${gainH}アップした。`;
                }
            }
        ]
    },
    {
        title: 'ブリーダー協会の支援物資',
        visual: '📦',
        desc: '協会の支援物資コンテナが落ちています。どうやらブリーダーへの補給品ようです。',
        choices: [
            {
                text: '栄養豊富な保存食を食べる',
                action: (player) => {
                    player.stats.life = player.stats.maxLife;
                    return `体力が完全に回復した！ライフが最大になりました。`;
                }
            },
            {
                text: 'トレーニング用の薬をもらう',
                action: (player) => {
                    const gainH = getDiminishedVal(player.stats.hit, 20);
                    player.stats.hit += gainH;
                    return `モンスターにトレーニング器具とプロテインを与えました。命中が+${gainH}アップ！`;
                }
            }
        ]
    },
    // 通常ランダムイベントに「特訓イベント」を配置
    {
        title: '秘密の特訓場を発見！',
        visual: '⛩️',
        desc: '伝説のブリーダーが遺したと言われる秘密 of 特訓地を発見しました！効率よく特定のパラメータを鍛え上げられます。',
        choices: [
            {
                text: '攻の特別トレーニング（ライフ-25）',
                action: (player) => {
                    player.stats.life = Math.max(10, player.stats.life - 25);
                    const gainP = getDiminishedVal(player.stats.pow, 20);
                    const gainH = getDiminishedVal(player.stats.hit, 12);
                    player.stats.pow += gainP;
                    player.stats.hit += gainH;
                    return `攻撃特訓が成功！ちからが+${gainP}、命中が+${gainH}アップした！(ライフ-25)`;
                }
            },
            {
                text: '防の特別トレーニング（ライフ-25）',
                action: (player) => {
                    player.stats.life = Math.max(10, player.stats.life - 25);
                    const gainD = getDiminishedVal(player.stats.def, 20);
                    const gainS = getDiminishedVal(player.stats.spd, 12);
                    player.stats.def += gainD;
                    player.stats.spd += gainS;
                    return `防御と回避の特訓が成功！丈夫さが+${gainD}、回避が+${gainS}アップした！(ライフ-25)`;
                }
            }
        ]
    }
];

// 「修行コンパス」からはこちらが100%発動
const TRAINING_EVENTS = [
    {
        title: '猛特訓修行（新技習得）',
        visual: '⛰️',
        desc: '過酷ですが効果絶大な修行地を発見しました。厳しい修行により種族固有の新技を確実に1つ修得できます！',
        choices: [
            {
                text: '命懸けの修行を開始（ライフ-40）',
                action: (player) => {
                    player.stats.life = Math.max(10, player.stats.life - 40);
                    
                    let candidates = [];
                    if (player.emoji === '🍪') {
                        candidates = ['monta', 'mochiki', 'gaccho', 'sakurafubuki', 'cho_rollinmochi', 'cho_mochihou', 'mossama', 'yaezakura'];
                    } else if (player.emoji === '👁️') {
                        candidates = ['shippobinta', 'nameru', 'kamitsuki', 'kuu', 'psychokinesis', 'cho_netsushisen', 'utau', 'berobinta'];
                    } else if (player.emoji === '🦖') {
                        candidates = ['shippo', 'kamitsuki_dino', 'sunakake', 'kamitsukinage', 'honoo_taiatari', 'hizageri', 'kurohizacombo'];
                    } else if (player.emoji === '🗿') {
                        candidates = ['monotaore', 'warawara', 'sakebigoe', 'cho_monotaore', 'aurora_gate', 'sanren_attack', 'trio_beam_z'];
                    }

                    const available = candidates.filter(s => !player.skills.includes(s));
                    if (available.length > 0) {
                        const newSkill = available[Math.floor(Math.random() * available.length)];
                        player.skills.push(newSkill);
                        return `厳しい修行の結果、新しい秘技【${SKILLS_DB[newSkill].name}】（ダメージランク: ${getDamageRank(SKILLS_DB[newSkill].force, SKILLS_DB[newSkill].type)}）を習得した！ (ライフ-40)`;
                    } else {
                        // 全技習得済みの場合は強化修行へ誘導
                        player.stats.life = Math.min(player.stats.maxLife, player.stats.life + 40); // ライフペナルティを戻す
                        return '全技習得済み！強化修行に切り替えます...';
                    }
                }
            },
            {
                text: '基礎を鍛える修行に留める（ライフ-10）',
                action: (player) => {
                    player.stats.life = Math.max(10, player.stats.life - 10);
                    const gainP = getDiminishedVal(player.stats.pow, 10);
                    const gainH = getDiminishedVal(player.stats.hit, 10);
                    player.stats.pow += gainP;
                    player.stats.hit += gainH;
                    return `基礎トレーニングを行いました。ちからが+${gainP}、命中が+${gainH}アップした。 (ライフ-10)`;
                }
            }
        ]
    }
];
