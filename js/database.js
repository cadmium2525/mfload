// =====================================================
// オーラ属性データベース（新要素）
// 育成開始時の「オーラの儀式」でプレイヤーのモンスターに付与し、
// 育成中バトル(game_battle.js)の敵にはランダムで付与する。
// 相性: 赤→緑→黄→青→赤 の順に有利（beatsで示す色に対して1.5倍ダメージ）
// =====================================================
const AURA_TYPES = {
    red:    { key: 'red',    name: '赤',  emoji: '🔴', colorClass: 'bg-red-500',    textClass: 'text-red-400',    beats: 'green' },
    green:  { key: 'green',  name: '緑',  emoji: '🟢', colorClass: 'bg-green-500',  textClass: 'text-green-400',  beats: 'yellow' },
    yellow: { key: 'yellow', name: '黄',  emoji: '🟡', colorClass: 'bg-yellow-400', textClass: 'text-yellow-300', beats: 'blue' },
    blue:   { key: 'blue',   name: '青',  emoji: '🔵', colorClass: 'bg-blue-500',   textClass: 'text-blue-400',   beats: 'red' }
};

// --- 攻撃側オーラが防御側オーラに対して有利かどうかを判定する ---
function isAuraAdvantageous(attackerAuraKey, defenderAuraKey) {
    if (!attackerAuraKey || !defenderAuraKey) return false;
    const attackerAura = AURA_TYPES[attackerAuraKey];
    return !!attackerAura && attackerAura.beats === defenderAuraKey;
}

// --- 4色からランダムに1つオーラを選ぶ（敵モンスターへの付与用） ---
function getRandomAuraKey() {
    const keys = Object.keys(AURA_TYPES);
    return keys[Math.floor(Math.random() * keys.length)];
}

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
    },
    plant: {
        id: 'plant',
        name: 'プラント',
        emoji: '🌸',
        desc: '花を戴く植物系のモンスター。ちからはやや低めだが、驚異的な生命力を持ち、多彩なかしこさ技で相手を翻弄する。',
        stats: { maxLife: 260, life: 260, pow: 32, int: 52, hit: 46, spd: 32, def: 46, gutsSpeed: 14 }
    },
    kyubi: {
        id: 'kyubi',
        name: 'キュービ',
        emoji: '🦊',
        desc: '妖しい九尾を操る霊獣。ライフと丈夫さは低めだが、卓越したかしこさと俊敏さを併せ持ち、幻惑と防御術で戦況を操る。',
        stats: { maxLife: 190, life: 190, pow: 28, int: 62, hit: 50, spd: 55, def: 28, gutsSpeed: 15 }
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

    // --- プラント系統 ---
    renkon: { name: '連続根っこ', cost: 20, type: 'pow', hitRate: 100, force: 0.8, gutsDown: 10, effect: null, desc: '地中の根っこを操り連続で打ちすえる。回避を完全に無視して【必中】する！相手GUTS-10' },
    combination: { name: 'コンビネーション', cost: 35, type: 'pow', hitRate: 78, force: 1.8, gutsDown: 15, effect: null, desc: '枝と根を使った連続コンビネーション攻撃。相手GUTS-15' },
    face_drill: { name: 'フェイスドリル', cost: 45, type: 'pow', hitRate: 68, force: 2.3, gutsDown: 20, effect: null, desc: '顔面の突起を高速回転させ突き刺す大技。相手GUTS-20' },
    tane_gun: { name: '種ガン', cost: 20, type: 'int', hitRate: 82, force: 1.1, gutsDown: 10, effect: null, desc: '硬い種を弾丸のように撃ち出す基本技。相手GUTS-10' },
    tane_machinegun: { name: '種マシンガン', cost: 32, type: 'int', hitRate: 78, force: 1.4, gutsDown: 15, effect: null, desc: '種を連射して相手を蜂の巣にする。相手GUTS-15' },
    kafun: { name: '花粉', cost: 25, type: 'int', hitRate: 90, force: 0.2, gutsDown: 40, effect: null, desc: '大量の花粉をまき散らし、相手の闘志を大きく削ぐ。相手GUTS-40' },
    flower_beam: { name: 'フラワービーム', cost: 45, type: 'int', hitRate: 70, force: 2.2, gutsDown: 20, effect: null, desc: '花の中心から極大の光線を放つ切り札。相手GUTS-20' },
    drain: { name: 'ドレイン', cost: 35, type: 'int', hitRate: 68, force: 1.4, gutsDown: 10, effect: 'drain_heal', desc: '相手の生命力を吸い取る。命中率はやや低めだが、与えたダメージの20%だけ自身のライフを回復する。相手GUTS-10' },

    // --- キュービ系統 ---
    hikkaki: { name: 'ひっかき', cost: 15, type: 'pow', hitRate: 85, force: 0.5, gutsDown: 10, effect: null, desc: '鋭い爪で引っかく基本技。相手GUTS-10' },
    kagerou: { name: '陽炎', cost: 45, type: 'pow', hitRate: 75, force: 1.4, gutsDown: 15, effect: 'guaranteed_dodge_next', desc: '陽炎に姿を紛れ込ませて攻撃する。相手GUTS-15。さらに命中した場合、次に受ける敵の攻撃を確実に回避する' },
    kitsunebi: { name: '狐火', cost: 15, type: 'int', hitRate: 95, force: 0.5, gutsDown: 10, effect: null, desc: '青白い狐火を飛ばす高命中の基本技。相手GUTS-10' },
    cho_kitsunebi: { name: '超狐火', cost: 32, type: 'int', hitRate: 88, force: 1.4, gutsDown: 15, effect: null, desc: '巨大化させた狐火をぶつける高命中技。相手GUTS-15' },
    yuuwaku: { name: 'ゆうわく', cost: 25, type: 'int', hitRate: 85, force: 0.85, gutsDown: 40, effect: null, desc: '妖しい魅力で相手の闘志を大きく削ぐ。相手GUTS-40' },
    kokonoe_shingan: { name: '九重神眼', cost: 40, type: 'int', hitRate: 75, force: 1.8, gutsDown: 15, effect: 'shield_self_20pct', desc: '九尾の瞳で相手を見据えて攻撃する。相手GUTS-15。さらに命中した場合、自身の最大ライフの20%に相当するシールドを展開する' },
    tenga_tensho: { name: '天河天翔', cost: 55, type: 'int', hitRate: 60, force: 2.6, gutsDown: 20, effect: 'perma_dmg_up_20', desc: '天空を駆け巡る霊力の奔流を叩き込む最大の切り札。相手GUTS-20。さらに命中した場合、自身が今後与えるダメージが永続的に20%アップする' },

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

// --- 丈夫さによるガッツダウン軽減計算ヘルパー ---
// 丈夫さ(def)が高いほど、受けるガッツダウン量を逓減方式で軽減する（下限は無し＝完全ゼロにはならない）。
// def=0 で軽減なし(倍率1.0)、defが増えるほど倍率が緩やかに1.0未満へ近づいていく。
// 例: def=40 → 約0.83倍(-17%) / def=65 → 約0.75倍(-25%) / def=150 → 約0.57倍(-43%)
function getGutsDownMitigation(defStat) {
    const def = Math.max(0, defStat || 0);
    return 100 / (100 + def * 0.5);
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

// --- ドレイン系技の自己回復量を計算する共通ヘルパー（与えたダメージの20%）---
// 育成中バトル／マスモンCPU対戦／リアルタイム対戦の3系統から共通で呼び出す。
// ライフフィールドの構造（stats.life か life か）が系統ごとに異なるため、
// 回復量の計算のみ共通化し、実際にライフへ加算する処理は各呼び出し側で行う。
function getDrainHealAmount(sk, damageDealt) {
    if (!sk || sk.effect !== 'drain_heal' || !damageDealt || damageDealt <= 0) return 0;
    return Math.max(1, Math.floor(damageDealt * 0.2));
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
    } else if (sk.effect === 'perma_dmg_up_20') {
        if (caster.permaForceBoostActive) {
            logs.push(`（${caster.name} はすでに天河天翔の効果を得ているため、追加のダメージアップは発生しなかった）`);
        } else {
            caster.permaForceBoostActive = true;
            logs.push(`✨ ${caster.name} の全身に霊力が満ち、今後与えるダメージが永続的に1.2倍になった！`);
        }
    } else if (sk.effect === 'guaranteed_dodge_next') {
        caster.dodgeNextGuaranteed = true;
        logs.push(`🌫️ ${caster.name} は陽炎に包まれ、次の敵の攻撃を確実に回避する構えを取った！`);
    } else if (sk.effect === 'shield_self_20pct') {
        if (caster.shieldUsedThisBattle) {
            logs.push(`（${caster.name} の九重神眼はすでに使用済みのため、シールドは展開されなかった）`);
        } else {
            // ライフ構造の違い（stats.maxLife か maxLife か）を吸収して両対応させる
            const maxLifeVal = caster.stats ? caster.stats.maxLife : caster.maxLife;
            caster.shieldValue = Math.floor(maxLifeVal * 0.2);
            caster.shieldUsedThisBattle = true;
            logs.push(`🛡️ ${caster.name} は自身の最大ライフの20%（${caster.shieldValue}）に相当するシールドを展開した！（このバトル中は再展開不可）`);
        }
    }
    return logs;
}

// --- シールド（九重神眼等）による被ダメージ吸収を適用する共通ヘルパー ---
// defender: shieldValueフィールドを持つユニット, damage: 吸収前のダメージ量
// 戻り値: { finalDamage: シールド適用後のダメージ, absorbed: 吸収された量 }
function applyShieldAbsorption(defender, damage) {
    if (!defender || !defender.shieldValue || defender.shieldValue <= 0 || damage <= 0) {
        return { finalDamage: damage, absorbed: 0 };
    }
    const absorbed = Math.min(defender.shieldValue, damage);
    defender.shieldValue -= absorbed;
    return { finalDamage: damage - absorbed, absorbed };
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

// =====================================================
// --- 装備アイテムデータベース ---
// 育成中の「宝箱発見」イベントやバトル終了後の低確率ドロップで入手する。
// クリア時にブリーダーID（getMyPlayerId）に紐づけて保存され、PvP（マスモン対戦）で
// 自分のマスモンに1つ装備させることができる。
// mode: 'normal' はノーマルモード産、'hard' はハードモード産（周回のご褒美として
//       ノーマルより高い数値・強力な特殊効果を持つ）。
// type: 'stat'    -> statKey のステータスが range[0]～range[1] の間でランダムに上昇する
//       'special' -> 戦闘中に特殊効果 (effect) が発動する
// =====================================================
const EQUIPMENT_DB = {
    // ---------- ノーマルモード産 ----------
    ember_claw:      { id: 'ember_claw',      name: '炎の爪',          icon: '🔥', rarity: '★★☆', mode: 'normal', type: 'stat', statKey: 'pow',     range: [20, 25], desc: 'ちからが上昇する牙状の装備。' },
    aqua_scale:      { id: 'aqua_scale',      name: '水鱗のよろい',     icon: '💧', rarity: '★★☆', mode: 'normal', type: 'stat', statKey: 'def',     range: [18, 24], desc: '丈夫さが上昇する鱗のよろい。' },
    wind_charm:      { id: 'wind_charm',      name: '風切りのお守り',   icon: '🍃', rarity: '★★☆', mode: 'normal', type: 'stat', statKey: 'spd',     range: [15, 20], desc: '回避が上昇するお守り。' },
    sage_ring:       { id: 'sage_ring',       name: '賢者の指輪',       icon: '💍', rarity: '★★☆', mode: 'normal', type: 'stat', statKey: 'int',     range: [20, 25], desc: 'かしこさが上昇する指輪。' },
    hawk_eye_lens:   { id: 'hawk_eye_lens',   name: '鷹の目レンズ',     icon: '🔍', rarity: '★☆☆', mode: 'normal', type: 'stat', statKey: 'hit',     range: [15, 20], desc: '命中が上昇するレンズ。' },
    vital_amulet:    { id: 'vital_amulet',    name: '生命のお守り',     icon: '💗', rarity: '★☆☆', mode: 'normal', type: 'stat', statKey: 'maxLife', range: [30, 40], desc: '最大ライフが上昇するお守り。' },
    rough_gauntlet:  { id: 'rough_gauntlet',  name: '荒縄のガントレット', icon: '🥊', rarity: '★☆☆', mode: 'normal', type: 'stat', statKey: 'pow',     range: [10, 14], desc: 'ちからが少し上昇する簡素な籠手。' },
    stone_bangle:    { id: 'stone_bangle',    name: '石の腕輪',         icon: '🪨', rarity: '★☆☆', mode: 'normal', type: 'stat', statKey: 'def',     range: [10, 14], desc: '丈夫さが少し上昇する素朴な腕輪。' },
    clever_charm:    { id: 'clever_charm',    name: '知恵の首飾り',     icon: '📿', rarity: '★☆☆', mode: 'normal', type: 'stat', statKey: 'int',     range: [12, 16], desc: 'かしこさが少し上昇する首飾り。' },
    swift_anklet:    { id: 'swift_anklet',    name: '俊足のアンクレット', icon: '👟', rarity: '★☆☆', mode: 'normal', type: 'stat', statKey: 'spd',     range: [10, 14], desc: '回避が少し上昇するアンクレット。' },
    guardian_pendant:{ id: 'guardian_pendant',name: '守護のペンダント', icon: '🛡️', rarity: '★★★', mode: 'normal', type: 'special', effect: 'lifesaver', healPct: 0.3, desc: '残りライフが最大ライフの3割を切った時、1度だけ最大ライフの3割を回復する。' },

    // ---------- ハードモード産（ノーマルより強力・周回価値づけ） ----------
    dragon_fang:     { id: 'dragon_fang',     name: '竜牙の爪',        icon: '🐉', rarity: '★★★', mode: 'hard', type: 'stat', statKey: 'pow',     range: [30, 40], desc: 'ちからが大きく上昇する竜の牙。' },
    obsidian_armor:  { id: 'obsidian_armor',  name: '黒曜の鎧',        icon: '🗿', rarity: '★★★', mode: 'hard', type: 'stat', statKey: 'def',     range: [30, 38], desc: '丈夫さが大きく上昇する漆黒の鎧。' },
    phantom_veil:    { id: 'phantom_veil',    name: '幻影のヴェール',   icon: '🌫️', rarity: '★★★', mode: 'hard', type: 'stat', statKey: 'spd',     range: [28, 35], desc: '回避が大きく上昇するヴェール。' },
    archsage_crown:  { id: 'archsage_crown',  name: '大賢者の冠',       icon: '👑', rarity: '★★★', mode: 'hard', type: 'stat', statKey: 'int',     range: [32, 40], desc: 'かしこさが大きく上昇する冠。' },
    true_strike_lens:{ id: 'true_strike_lens',name: '真眼のレンズ',     icon: '🎯', rarity: '★★☆', mode: 'hard', type: 'stat', statKey: 'hit',     range: [25, 32], desc: '命中が大きく上昇するレンズ。' },
    titan_heart:     { id: 'titan_heart',     name: '巨神の心臓',       icon: '❤️', rarity: '★★★', mode: 'hard', type: 'stat', statKey: 'maxLife', range: [60, 80], desc: '最大ライフが大きく上昇する秘宝。' },
    iron_claw_shard: { id: 'iron_claw_shard', name: '鉄爪の欠片',       icon: '🦴', rarity: '★☆☆', mode: 'hard', type: 'stat', statKey: 'pow',     range: [18, 22], desc: 'ちからが上昇する鉄爪の欠片。' },
    cracked_scale:   { id: 'cracked_scale',   name: 'ひび割れた鱗',     icon: '🐍', rarity: '★☆☆', mode: 'hard', type: 'stat', statKey: 'def',     range: [16, 20], desc: '丈夫さが上昇するひび割れた鱗。' },
    phoenix_feather: { id: 'phoenix_feather', name: '不死鳥の羽根',     icon: '🪶', rarity: '★★★', mode: 'hard', type: 'special', effect: 'lifesaver', healPct: 0.4, desc: '残りライフが最大ライフの3割を切った時、1度だけ最大ライフの4割を回復する。' },

    // ---------- ハードモード専用★★★特殊効果装備 ----------
    guardian_ward:   { id: 'guardian_ward',   name: '護りの霊符',       icon: '🔰', rarity: '★★★', mode: 'hard', type: 'special', effect: 'gutsDownCut', cutRate: 0.3, desc: '被ガッツダウン量を3割カットする。' },
    crit_fang_charm: { id: 'crit_fang_charm', name: '牙獣のお守り',     icon: '🦷', rarity: '★★★', mode: 'hard', type: 'special', effect: 'critUp', critBonus: 0.35, desc: 'クリティカル率が大幅にアップする。' },
    berserker_core:  { id: 'berserker_core',  name: '闘魂の紅玉',       icon: '💢', rarity: '★★★', mode: 'hard', type: 'special', effect: 'lowLifeAtkUp', threshold: 0.5, bonusPct: 0.2, desc: '自身のライフが最大ライフの半分を切った時、攻撃ステータス（ちから・かしこさ）が20%アップする。' },
    fighting_spirit_core: { id: 'fighting_spirit_core', name: '闘気の勾玉', icon: '🔶', rarity: '★★★', mode: 'hard', type: 'special', effect: 'gutsRecoveryUp', gutsRecoveryBonus: 10, desc: '自ターン開始時のガッツ回復量が+10される。' },

    // ---------- オーラ連動装備（ノーマル・ハード共通ドロップ／各オーラ★1〜★3） ----------
    // 自身のオーラが requiredAura と一致する時のみ、ランダムに選ばれた2種類のステータスが上昇する。
    // 上昇幅はレア度（★の数）に応じて変化し、上昇するステータスの組み合わせは装備入手時に決定される。
    red_aura_amulet:  { id: 'red_aura_amulet',  name: '紅蓮のお守り', icon: '🔴', rarity: '★☆☆', mode: 'both', type: 'auraStat2', effect: 'auraStatUp', requiredAura: 'red' },
    red_aura_ring:    { id: 'red_aura_ring',    name: '紅蓮の指輪',   icon: '🔴', rarity: '★★☆', mode: 'both', type: 'auraStat2', effect: 'auraStatUp', requiredAura: 'red' },
    red_aura_crest:   { id: 'red_aura_crest',   name: '紅蓮の紋章',   icon: '🔴', rarity: '★★★', mode: 'both', type: 'auraStat2', effect: 'auraStatUp', requiredAura: 'red' },

    blue_aura_amulet: { id: 'blue_aura_amulet', name: '蒼海のお守り', icon: '🔵', rarity: '★☆☆', mode: 'both', type: 'auraStat2', effect: 'auraStatUp', requiredAura: 'blue' },
    blue_aura_ring:   { id: 'blue_aura_ring',   name: '蒼海の指輪',   icon: '🔵', rarity: '★★☆', mode: 'both', type: 'auraStat2', effect: 'auraStatUp', requiredAura: 'blue' },
    blue_aura_crest:  { id: 'blue_aura_crest',  name: '蒼海の紋章',   icon: '🔵', rarity: '★★★', mode: 'both', type: 'auraStat2', effect: 'auraStatUp', requiredAura: 'blue' },

    green_aura_amulet:{ id: 'green_aura_amulet',name: '翠緑のお守り', icon: '🟢', rarity: '★☆☆', mode: 'both', type: 'auraStat2', effect: 'auraStatUp', requiredAura: 'green' },
    green_aura_ring:  { id: 'green_aura_ring',  name: '翠緑の指輪',   icon: '🟢', rarity: '★★☆', mode: 'both', type: 'auraStat2', effect: 'auraStatUp', requiredAura: 'green' },
    green_aura_crest: { id: 'green_aura_crest', name: '翠緑の紋章',   icon: '🟢', rarity: '★★★', mode: 'both', type: 'auraStat2', effect: 'auraStatUp', requiredAura: 'green' },

    yellow_aura_amulet:{ id: 'yellow_aura_amulet', name: '黄金のお守り', icon: '🟡', rarity: '★☆☆', mode: 'both', type: 'auraStat2', effect: 'auraStatUp', requiredAura: 'yellow' },
    yellow_aura_ring:  { id: 'yellow_aura_ring',   name: '黄金の指輪',   icon: '🟡', rarity: '★★☆', mode: 'both', type: 'auraStat2', effect: 'auraStatUp', requiredAura: 'yellow' },
    yellow_aura_crest: { id: 'yellow_aura_crest',  name: '黄金の紋章',   icon: '🟡', rarity: '★★★', mode: 'both', type: 'auraStat2', effect: 'auraStatUp', requiredAura: 'yellow' }
};

// --- オーラ連動装備（type: 'auraStat2'）の上昇候補ステータスと、レア度ごとの上昇幅 ---
// ライフ・命中や命中・回避、ちから・丈夫さ　等、2種類の組み合わせを装備入手時にランダム抽選する。
const AURA_STAT2_KEYS = ['maxLife', 'pow', 'int', 'hit', 'spd', 'def'];
const AURA_STAT2_RANGE_BY_RARITY = {
    '★☆☆': { maxLife: [15, 20], pow: [8, 11],  int: [8, 11],  hit: [8, 11],  spd: [8, 11],  def: [8, 11]  },
    '★★☆': { maxLife: [26, 32], pow: [13, 17], int: [13, 17], hit: [13, 17], spd: [13, 17], def: [13, 17] },
    '★★★': { maxLife: [40, 50], pow: [20, 26], int: [20, 26], hit: [20, 26], spd: [20, 26], def: [20, 26] }
};

// --- レア度ごとの抽選重み（★の数が少ないほど重みを大きくし、レア度間の出現率を均す） ---
// ハードモードは★★★装備の登録数が★☆☆・★★☆に比べて多いため、単純な均等抽選だと
// ★★★ばかりが出てすぐに★☆☆・★★☆が埋まらない状態になっていた。
// レア度単位で重みを持たせることで、登録数に関わらずどのレア度もまんべんなくドロップする。
const EQUIPMENT_RARITY_DROP_WEIGHT = {
    '★☆☆': 3,
    '★★☆': 2,
    '★★★': 1
};

// --- 装備アイテムの入手：指定モードのプールからランダムに1つ選び、ランダム個体値を持つ「所持インスタンス」を生成する ---
// 同じ名前の装備でも取得時にランダムで数値が変動する（例：炎の爪：ちから20～25アップ）
function rollEquipmentInstance(mode) {
    const pool = Object.values(EQUIPMENT_DB).filter(e => e.mode === mode || e.mode === 'both');
    if (pool.length === 0) return null;

    // レア度ごとの重みを使った重み付き抽選（★の少ない装備ほど出やすくなる）
    const weights = pool.map(e => EQUIPMENT_RARITY_DROP_WEIGHT[e.rarity] || 1);
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    let roll = Math.random() * totalWeight;
    let base = pool[pool.length - 1];
    for (let i = 0; i < pool.length; i++) {
        roll -= weights[i];
        if (roll < 0) {
            base = pool[i];
            break;
        }
    }

    const instance = {
        instanceId: 'eq_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
        equipId: base.id,
        acquiredAt: Date.now(),
        favoriteTags: { p1: false, p2: false, p3: false, p4: false, p5: false } // お気に入り登録（5パターン）
    };

    if (base.type === 'stat') {
        const [min, max] = base.range;
        instance.rolledValue = Math.floor(Math.random() * (max - min + 1)) + min;
    }

    if (base.type === 'auraStat2') {
        // 上昇ステータスをランダムに重複無く2種類選び、レア度に応じた範囲で数値を決定する
        const shuffled = [...AURA_STAT2_KEYS].sort(() => Math.random() - 0.5);
        const pickedKeys = shuffled.slice(0, 2);
        const rangeTable = AURA_STAT2_RANGE_BY_RARITY[base.rarity] || {};
        instance.rolledStats = pickedKeys.map(key => {
            const [min, max] = rangeTable[key] || [10, 15];
            return { key, value: Math.floor(Math.random() * (max - min + 1)) + min };
        });
    }

    return instance;
}

// --- 装備インスタンスの表示名（レア度込み） ---
function getEquipmentDisplayName(instance) {
    const base = EQUIPMENT_DB[instance.equipId];
    if (!base) return '不明な装備';
    return `${base.name}（レア度${base.rarity}）`;
}

// --- 装備インスタンスの効果説明文（ランダム数値を反映） ---
function getEquipmentDisplayDesc(instance) {
    const base = EQUIPMENT_DB[instance.equipId];
    if (!base) return '';
    if (base.type === 'stat') {
        return `${getStatLabel(base.statKey)} +${instance.rolledValue} アップ`;
    }
    if (base.type === 'auraStat2') {
        const auraName = (AURA_TYPES[base.requiredAura] || {}).name || base.requiredAura;
        const statsText = (instance.rolledStats || [])
            .map(s => `${getStatLabel(s.key)}+${s.value}`)
            .join('・');
        return `自身が${auraName}オーラの時、${statsText} アップ`;
    }
    return base.desc;
}

// --- 装備がユニットのステータスに与えるボーナス（{pow,int,hit,spd,def,maxLife}）を取得 ---
function getEquipmentStatBonuses(instance) {
    const bonuses = { pow: 0, int: 0, hit: 0, spd: 0, def: 0, maxLife: 0 };
    if (!instance) return bonuses;
    const base = EQUIPMENT_DB[instance.equipId];
    if (!base || base.type !== 'stat') return bonuses;
    bonuses[base.statKey] = instance.rolledValue || 0;
    return bonuses;
}

// --- 装備の「被ガッツダウンカット」効果の軽減率（0〜1）を取得 ---
function getEquipmentGutsDownCutRate(unit) {
    if (!unit || !unit.equippedItem) return 0;
    const base = EQUIPMENT_DB[unit.equippedItem.equipId];
    if (!base || base.effect !== 'gutsDownCut') return 0;
    return base.cutRate || 0;
}

// --- 装備の「クリティカル率アップ」効果のボーナス値（0〜1）を取得 ---
function getEquipmentCritBonus(unit) {
    if (!unit || !unit.equippedItem) return 0;
    const base = EQUIPMENT_DB[unit.equippedItem.equipId];
    if (!base || base.effect !== 'critUp') return 0;
    return base.critBonus || 0;
}

// --- 装備の「自身のライフが半分を切った時、攻撃ステータスアップ」効果の倍率を取得 ---
// ユニットのライフ構造差（stats.life か life か）を吸収して両対応させる。
function getEquipmentLowLifeAtkMultiplier(unit) {
    if (!unit || !unit.equippedItem) return 1;
    const base = EQUIPMENT_DB[unit.equippedItem.equipId];
    if (!base || base.effect !== 'lowLifeAtkUp') return 1;

    const hasNestedStats = !!unit.stats;
    const life = hasNestedStats ? unit.stats.life : unit.life;
    const maxLife = hasNestedStats ? unit.stats.maxLife : unit.maxLife;
    if (!maxLife || life > maxLife * (base.threshold || 0.5)) return 1;

    return 1 + (base.bonusPct || 0);
}

// --- 装備の「自身オーラ○○の時、ランダム2種のステータスアップ」効果による補正値を取得 ---
// unitAuraKey: そのユニット自身が持つオーラ（PvPマスモンは育成中に選んだオーラを引き継ぐ）
// 戻り値: {pow, int, hit, spd, def, maxLife} （装備入手時にランダムで決まった2種類のみ値が入る）
function getEquipmentAuraStatBonuses(equipInstance, unitAuraKey) {
    const bonuses = { pow: 0, int: 0, hit: 0, spd: 0, def: 0, maxLife: 0 };
    if (!equipInstance || !unitAuraKey) return bonuses;
    const base = EQUIPMENT_DB[equipInstance.equipId];
    if (!base || base.effect !== 'auraStatUp') return bonuses;
    if (base.requiredAura !== unitAuraKey) return bonuses;

    (equipInstance.rolledStats || []).forEach(s => {
        if (bonuses.hasOwnProperty(s.key)) {
            bonuses[s.key] += s.value || 0;
        }
    });
    return bonuses;
}

// --- 装備の「自ターン開始時のガッツ回復量アップ」効果のボーナス値を取得 ---
function getEquipmentGutsRecoveryBonus(unit) {
    if (!unit || !unit.equippedItem) return 0;
    const base = EQUIPMENT_DB[unit.equippedItem.equipId];
    if (!base || base.effect !== 'gutsRecoveryUp') return 0;
    return base.gutsRecoveryBonus || 0;
}

// --- 装備の特殊効果（残りライフ3割切りで1度だけ回復、等）判定・適用ヘルパー ---
// 育成中バトル／マスモンCPU対戦／リアルタイム対戦の3系統から共通で呼び出す。
// unit: equippedItem（装備インスタンス）と equipLifesaverUsed フラグを持つ想定。
// ライフフィールドの構造差（stats.life か life か）を吸収して両対応させる。
// 戻り値: 発動した場合のログメッセージ（未発動なら null）
function checkAndApplyEquipmentLifesaverEffect(unit) {
    if (!unit || !unit.equippedItem || unit.equipLifesaverUsed) return null;
    const base = EQUIPMENT_DB[unit.equippedItem.equipId];
    if (!base || base.effect !== 'lifesaver') return null;

    const hasNestedStats = !!unit.stats;
    const life = hasNestedStats ? unit.stats.life : unit.life;
    const maxLife = hasNestedStats ? unit.stats.maxLife : unit.maxLife;
    if (life <= 0 || life >= maxLife * 0.3) return null;

    const healAmount = Math.floor(maxLife * base.healPct);
    const newLife = Math.min(maxLife, life + healAmount);
    if (hasNestedStats) {
        unit.stats.life = newLife;
    } else {
        unit.life = newLife;
    }
    unit.equipLifesaverUsed = true;

    return `✨ ${unit.name} の【${base.name}】が発動！最大ライフの${Math.floor(base.healPct * 100)}%（${healAmount}）を回復した！`;
}

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

// --- 宝箱発見イベント（装備アイテム入手）演出データ ---
// 実際の抽選・付与処理は setupTreasureEvent()（game_adventure.js）が行う。
// ここでは選択肢のラベル・演出文言のみを保持する。
const TREASURE_EVENTS = [
    {
        title: '古びた宝箱を発見！',
        visual: '🎁',
        openText: '宝箱を開けてみる',
        leaveText: 'そっとしておく（ライフ20回復）'
    },
    {
        title: '光る祭壇の上の宝箱',
        visual: '⛩️',
        openText: '祭壇の宝箱を開ける',
        leaveText: '触れずに立ち去る（ライフ20回復）'
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
                    } else if (player.emoji === '🌸') {
                        candidates = ['renkon', 'tane_gun', 'kafun', 'combination', 'tane_machinegun', 'flower_beam', 'face_drill', 'drain'];
                    } else if (player.emoji === '🦊') {
                        candidates = ['hikkaki', 'kagerou', 'kitsunebi', 'cho_kitsunebi', 'yuuwaku', 'kokonoe_shingan', 'tenga_tensho'];
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
