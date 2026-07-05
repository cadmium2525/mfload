// =====================================================
// game_battle.js
// 育成中バトル（ダンジョンの雑魚戦・中ボス戦・ラスボス戦）：
//   ・バトル開始（setupBattle）〜プレイヤー/敵ターン進行
//   ・技実行（executePlayerSkill / executeEnemyTurn）
//   ・勝敗判定、リザルト画面、スコア集計、ゲームオーバーヒント
// game_core.js の GAME_STATE / addLog等のUIヘルパーに依存する。
// =====================================================

// ==================== バトルロジック ====================
function setupBattle(isBoss = false) {
    GAME_STATE.isBattleEnd = false;
    GAME_STATE.battleTurn = 1;
    GAME_STATE.isPlayerTurnActive = true;
    GAME_STATE.usedSkillsThisTurn = {}; 
    GAME_STATE.isDefending = false;
    GAME_STATE.halfRecoveryNextTurn = false;
    GAME_STATE.battleGain = null;
    GAME_STATE.isBossBattle = isBoss;

    // 状態変化関連のフラグ初期化
    GAME_STATE.isGyakujoActive = false;
    GAME_STATE.isSokojikaraFired = false;
    GAME_STATE.isSokojikaraActive = false;
    GAME_STATE.isShuchuActive = false;
    GAME_STATE.player.weakenTurns = 0;
    GAME_STATE.player.confuseTurns = 0;
    GAME_STATE.player.forceBoost = 0;
    GAME_STATE.player.shieldValue = 0;
    GAME_STATE.player.dodgeNextGuaranteed = false;

    let enemyTemplate;
    if (isBoss) {
        enemyTemplate = BOSS_TEMPLATES[GAME_STATE.floor];
    } else {
        enemyTemplate = { ...ENEMY_TEMPLATES[Math.floor(Math.random() * ENEMY_TEMPLATES.length)] };
    }

    let hpScale = 1.0;
    let statScale = 1.0;

    if (isBoss) {
        if (GAME_STATE.floor === 10) {
            hpScale = 1.9; statScale = 1.7;
        } else if (GAME_STATE.floor === 20) {
            hpScale = 3.3; statScale = 2.7;
        } else if (GAME_STATE.floor === 30) {
            hpScale = 3.0; statScale = 3.0; 
        }
        
        if (GAME_STATE.difficulty === 'hard') {
            hpScale *= 1.12;
            statScale *= 1.15;
        }
    } else {
        let floorFactor = GAME_STATE.floor;
        hpScale = 1.0 + (floorFactor * 0.05) + (Math.pow(floorFactor, 1.4) * 0.015);
        statScale = 1.0 + (floorFactor * 0.04) + (Math.pow(floorFactor, 1.4) * 0.012);

        if (GAME_STATE.difficulty === 'hard') {
            hpScale *= 1.15;    
            statScale *= 1.20;  
        }
    }

    GAME_STATE.enemy = {
        name: enemyTemplate.name + (GAME_STATE.difficulty === 'hard' ? ' (強敵)' : ''),
        emoji: enemyTemplate.emoji,
        type: enemyTemplate.type,
        guts: 50,
        weakenTurns: 0,
        confuseTurns: 0,
        forceBoost: 0,
        shieldValue: 0,
        dodgeNextGuaranteed: false,
        stats: {
            maxLife: Math.floor(enemyTemplate.maxLife * hpScale),
            life: Math.floor(enemyTemplate.maxLife * hpScale),
            pow: Math.floor(enemyTemplate.pow * statScale),
            int: Math.floor(enemyTemplate.int * statScale),
            hit: Math.floor(enemyTemplate.hit * statScale),
            spd: Math.floor(enemyTemplate.spd * statScale),
            def: Math.floor(enemyTemplate.def * statScale),
            gutsSpeed: 12 
        },
        skills: enemyTemplate.skills
    };

    const floorIndicator = document.getElementById('battle-floor-indicator');
    let battleTitle = isBoss ? `FLOOR ${GAME_STATE.floor} - BOSS BATTLE` : `FLOOR ${GAME_STATE.floor} - WILD BATTLE`;
    if (GAME_STATE.difficulty === 'hard') battleTitle += ' (HARD)';
    floorIndicator.textContent = battleTitle;
    
    document.getElementById('battle-turn-counter').textContent = GAME_STATE.battleTurn;
    document.getElementById('battle-actions-counter').textContent = GAME_STATE.totalActions;
    
    document.getElementById('enemy-name').textContent = GAME_STATE.enemy.name;
    const enemyIconEl = document.getElementById('battle-enemy-icon');
    renderMonsterVisual(enemyIconEl, GAME_STATE.enemy.name, GAME_STATE.enemy.emoji, false);
    document.getElementById('battle-enemy-type').textContent = GAME_STATE.enemy.name;
    
    const playerIconEl = document.getElementById('battle-player-icon');
    renderMonsterVisual(playerIconEl, GAME_STATE.player.name, GAME_STATE.player.emoji, GAME_STATE.isAwakened);
    document.getElementById('battle-player-name').textContent = GAME_STATE.player.name;

    const log = document.getElementById('battle-log');
    log.innerHTML = `<div>${GAME_STATE.enemy.type}の ${GAME_STATE.enemy.name} が現れた！</div>`;

    GAME_STATE.player.guts = 50; 
    updateBattleStatsUI();

    renderBattleSkills();
    changeScreen('screen-battle');

    startPlayerTurn(true); 
}

function startPlayerTurn(isFirstTurn = false) {
    GAME_STATE.isPlayerTurnActive = true;
    GAME_STATE.usedSkillsThisTurn = {}; 
    
    document.getElementById('end-turn-btn').disabled = false;
    document.getElementById('end-turn-btn').classList.remove('opacity-50', 'pointer-events-none');
    document.getElementById('end-turn-defend-btn').disabled = false;
    document.getElementById('end-turn-defend-btn').classList.remove('opacity-50', 'pointer-events-none');

    document.getElementById('player-defense-shield').classList.add('hidden');

    if (!isFirstTurn) {
        let recovery = Math.floor((GAME_STATE.player.stats.gutsSpeed || 15) + 30);
        
        let extraRecoverMsg = "";
        if (GAME_STATE.isGyakujoActive) {
            recovery = Math.floor(recovery * 1.2);
            extraRecoverMsg += " (逆上効果×1.2)";
        }
        if (GAME_STATE.playerStatusEffect === "闘魂" && GAME_STATE.enemy && GAME_STATE.enemy.guts > 70) {
            recovery = Math.floor(recovery * 1.5);
            extraRecoverMsg += " (闘魂効果×1.5)";
        }

        if (GAME_STATE.halfRecoveryNextTurn) {
            recovery = Math.floor(recovery / 2);
            addLog(`--- あなたのターン (防御ペナルティ) ---`);
            addLog(`防御姿勢の反動により、ガッツ回復量が半減した！`);
            GAME_STATE.halfRecoveryNextTurn = false; 
        } else {
            addLog(`--- あなたのターン ---`);
        }

        GAME_STATE.player.guts = Math.min(100, GAME_STATE.player.guts + recovery);
        addLog(`ガッツが ${recovery} 回復した！${extraRecoverMsg} (現在: ${Math.floor(GAME_STATE.player.guts)})`);
        showEffect('🔥 YOUR TURN 🔥');
    } else {
        addLog(`--- あなたのターン (初期GUTS: 50) ---`);
    }

    GAME_STATE.isDefending = false;

    updateBattleStatsUI();

    // 混乱状態（サケビ声などで付与）の残ターン消化と行動失敗判定
    const confusionResult = tickStatusTurnsAndCheckConfusion(GAME_STATE.player);
    if (confusionResult.confused) {
        addLog(`❓ ${GAME_STATE.player.name} は混乱していて、行動できなかった！`);
        showEffect('❓ 混乱... ❓');
        GAME_STATE.isPlayerTurnActive = false;
        toggleSkillButtons(false);
        document.getElementById('end-turn-btn').disabled = true;
        document.getElementById('end-turn-btn').classList.add('opacity-50', 'pointer-events-none');
        document.getElementById('end-turn-defend-btn').disabled = true;
        document.getElementById('end-turn-defend-btn').classList.add('opacity-50', 'pointer-events-none');
        setTimeout(() => {
            executeEnemyTurn();
        }, 1000);
        return;
    }

    toggleSkillButtons(true);
}

function toggleSkillButtons(enable) {
    const container = document.getElementById('battle-skills-container');
    const buttons = container.querySelectorAll('button');
    buttons.forEach(btn => {
        if (enable) {
            btn.classList.remove('pointer-events-none');
        } else {
            btn.classList.add('opacity-40', 'pointer-events-none');
        }
    });
}

function updateBattleStatsUI() {
    const p = GAME_STATE.player;
    const e = GAME_STATE.enemy;

    document.getElementById('player-hp-text').textContent = `${p.stats.life}/${p.stats.maxLife}`;
    const pLifePct = (p.stats.life / p.stats.maxLife) * 100;
    document.getElementById('player-hp-bar').style.width = `${pLifePct}%`;

    document.getElementById('enemy-hp-text').textContent = `HP: ${e.stats.life}/${e.stats.maxLife}`;
    const eLifePct = (e.stats.life / e.stats.maxLife) * 100;
    document.getElementById('enemy-hp-bar').style.width = `${eLifePct}%`;

    document.getElementById('enemy-guts-text').textContent = Math.floor(e.guts);
    document.getElementById('enemy-guts-bar').style.width = `${e.guts}%`;

    const gutsVal = Math.floor(p.guts);
    document.getElementById('guts-number').textContent = gutsVal;
    document.getElementById('guts-progress-bar').style.width = `${gutsVal}%`;

    document.getElementById('battle-actions-counter').textContent = GAME_STATE.totalActions;

    p.skills.forEach(skKey => {
        const btn = document.getElementById(`skill-btn-${skKey}`);
        if (btn) {
            const sk = SKILLS_DB[skKey];
            if (!sk) return;
            const isUsedLimit = GAME_STATE.usedSkillsThisTurn[skKey] && skKey === 'charge'; 
            
            if (!GAME_STATE.isPlayerTurnActive || gutsVal < sk.cost || isUsedLimit) {
                btn.classList.add('opacity-40', 'pointer-events-none');
            } else {
                btn.classList.remove('opacity-40', 'pointer-events-none');
            }

            const hitSpan = btn.querySelector('.hit-rate-text');
            if (hitSpan && sk.type !== 'heal' && !sk.type.startsWith('buff')) {
                const enh2 = GAME_STATE.skillEnhancements[skKey];
                const effectiveHit = (enh2 && sk.hitRate < 100) ? Math.min(99, sk.hitRate + enh2.hitBonus) : sk.hitRate;
                if (effectiveHit === 100 || sk.hitRate === 100) {
                    hitSpan.textContent = `命中:必中`;
                } else {
                    const mods = getGutsModifiers(gutsVal);
                    const actualHit = Math.max(10, Math.min(99, (effectiveHit + mods.hitMod) + (p.stats.hit - e.stats.spd) * 0.5));
                    hitSpan.textContent = `命中:${Math.round(actualHit)}%`;
                }
            }
        }
    });

    const recoveryVal = Math.floor((p.stats.gutsSpeed || 15) + 30);
    document.getElementById('turn-guts-notice').textContent = `💡 あなたのガッツ回復力: +${recoveryVal} / ターン`;

    // 状態変化UIの更新
    updateStatusEffectUI();
}

// 状態変化表示のUI制御
function updateStatusEffectUI() {
    const el = document.getElementById('player-status-effect-display');
    if (!el) return;

    const p = GAME_STATE.player;
    if (p && GAME_STATE.playerStatusEffect === "集中" && p.guts > 90 && !GAME_STATE.isShuchuActive) {
        GAME_STATE.isShuchuActive = true;
        addLog(`🎯 集中が発動！次の技の命中率 1.5 倍、ダメージが 1.2 倍に上昇！`);
    }

    let showText = "";

    if (GAME_STATE.isGyakujoActive) {
        showText = "逆上";
    } else if (GAME_STATE.isSokojikaraActive) {
        showText = "底力";
    } else if (GAME_STATE.playerStatusEffect === "闘魂" && GAME_STATE.enemy && GAME_STATE.enemy.guts > 70) {
        showText = "闘魂";
    } else if (GAME_STATE.isShuchuActive) {
        showText = "集中";
    }

    if (showText) {
        el.textContent = showText;
        el.classList.remove('hidden');
    } else {
        if (!el.dataset.temporaryActive) {
            el.classList.add('hidden');
        }
    }
}

// 根性などの一時的な状態変化の点滅表示
function triggerTemporaryStatusEffect(effectName) {
    const el = document.getElementById('player-status-effect-display');
    if (!el) return;
    el.textContent = effectName;
    el.classList.remove('hidden');
    el.dataset.temporaryActive = "true";
    setTimeout(() => {
        delete el.dataset.temporaryActive;
        updateStatusEffectUI();
    }, 2500); // 2.5秒間点滅表示
}

function renderBattleSkills() {
    const container = document.getElementById('battle-skills-container');
    container.innerHTML = '';

    GAME_STATE.player.skills.forEach(skKey => {
        const sk = SKILLS_DB[skKey];
        if (!sk) return;
        const btn = document.createElement('button');
        btn.id = `skill-btn-${skKey}`;
        
        const style = getSkillStyle(sk);
        const rank = getDamageRank(sk.force, sk.type);

        let rankColor = 'text-gray-400';
        if (rank === 'S') rankColor = 'text-red-600 font-extrabold';
        else if (rank === 'A') rankColor = 'text-orange-500 font-bold';
        else if (rank === 'B') rankColor = 'text-yellow-600 font-bold';
        else if (rank === 'C') rankColor = 'text-green-600 font-bold';
        else if (rank === 'D') rankColor = 'text-cyan-600';
        else if (rank === 'E') rankColor = 'text-blue-500';
        else if (rank === 'F') rankColor = 'text-purple-500';

        const enh = GAME_STATE.skillEnhancements[skKey];
        const isEnhanced = enh && enh.level > 0;
        const enhBorderClass = isEnhanced ? 'border-purple-400 shadow-[0_0_6px_2px_rgba(168,85,247,0.4)]' : style.borderClass;
        const enhBgClass = isEnhanced ? 'bg-[#1e0f3a] hover:bg-[#2a1558]' : style.bgClass;

        btn.className = `text-left p-2 rounded border transition-all active:scale-95 flex flex-col justify-between ${enhBgClass} ${enhBorderClass} ${style.textClass}`;
        
        btn.onclick = () => executePlayerSkill(skKey);
        
        let longPressTimer;
        btn.ontouchstart = (e) => {
            longPressTimer = setTimeout(() => {
                openSkillModal(skKey);
            }, 500);
        };
        btn.ontouchend = () => clearTimeout(longPressTimer);
        btn.onmousedown = (e) => {
            if (e.button === 2) {
                openSkillModal(skKey);
            } else {
                longPressTimer = setTimeout(() => {
                    openSkillModal(skKey);
                }, 500);
            }
        };
        btn.onmouseup = () => clearTimeout(longPressTimer);
        btn.oncontextmenu = (e) => e.preventDefault();

        let typeIcon = '💥';
        if (sk.type === 'int') typeIcon = '🔮';
        if (sk.type.startsWith('buff')) typeIcon = '⭐';
        if (sk.type === 'heal') typeIcon = '💖';

        let limitText = '';
        if (skKey === 'charge') {
            limitText = '<span class="limit-tag text-[8px] bg-red-900 text-red-200 px-1 py-0.5 rounded ml-1 font-normal">ターン1回限定</span>';
        }

        const enhBadge = isEnhanced
            ? `<span class="text-[8px] bg-purple-900 text-purple-200 px-1 py-0.5 rounded font-bold ml-1">⚔️Lv.${enh.level}</span>`
            : '';

        const e = GAME_STATE.enemy;
        const mods = getGutsModifiers(GAME_STATE.player.guts);
        const effectiveSk_hit = isEnhanced ? Math.min(99, sk.hitRate + enh.hitBonus) : sk.hitRate;
        let displayHitRate = effectiveSk_hit;
        
        if (effectiveSk_hit === 100 || sk.hitRate === 100) {
            displayHitRate = "必中";
        } else if (e && (sk.type === 'pow' || sk.type === 'int')) {
            const actualHit = Math.max(10, Math.min(99, (effectiveSk_hit + mods.hitMod) + (GAME_STATE.player.stats.hit - e.stats.spd) * 0.5));
            displayHitRate = Math.round(actualHit) + "%";
        } else {
            displayHitRate = displayHitRate + "%";
        }

        const hitRateDisplay = (sk.type === 'heal' || sk.type.startsWith('buff'))
            ? `<span class="text-emerald-700 text-[9px] font-bold">必中</span>`
            : `<span class="${style.textIntensity} text-[9px] font-bold font-mono hit-rate-text">命中:${displayHitRate}</span>`;

        btn.innerHTML = `
            <div class="flex justify-between items-center w-full">
                <span class="font-bold text-xs">${sk.name} ${typeIcon}${enhBadge} <span class="ml-1 text-[10px] ${rankColor} bg-[#1a120b]/10 px-1 py-0.2 rounded">ランク:${rank}</span></span>
                <span class="text-[9px] font-bold">G:${sk.cost}</span>
            </div>
            <div class="flex justify-between items-center mt-0.5 w-full">
                <div class="text-[8px] opacity-85 line-clamp-1 flex-1">GUTS-DOWN:${sk.gutsDown || 0}</div>
                <div class="ml-1 shrink-0">${hitRateDisplay}</div>
            </div>
            <div class="w-full text-right mt-0.5">${limitText}</div>
        `;
        container.appendChild(btn);
    });
}

function executePlayerSkill(skKey) {
    if (GAME_STATE.isBattleEnd || !GAME_STATE.isPlayerTurnActive) return;

    const sk = SKILLS_DB[skKey];
    if (!sk) return;
    const p = GAME_STATE.player;
    const e = GAME_STATE.enemy;

    const enh = GAME_STATE.skillEnhancements[skKey] || { forceBonus: 0, hitBonus: 0 };
    const effectiveSk = { ...sk, force: sk.force + enh.forceBonus, hitRate: sk.hitRate === 100 ? 100 : Math.min(99, sk.hitRate + enh.hitBonus) };

    if (skKey === 'charge' && GAME_STATE.usedSkillsThisTurn['charge']) {
        addLog(`ガッツチャージは1ターンに1回しか使えません！`);
        return;
    }

    if (p.guts < sk.cost) return;

    const mods = getGutsModifiers(p.guts);
    p.guts -= sk.cost;
    
    if (skKey === 'charge') {
        GAME_STATE.usedSkillsThisTurn['charge'] = true;
    }

    GAME_STATE.totalActions++;
    updateBattleStatsUI();

    addLog(`${p.name} の 【${sk.name}】！`);
    animateSprite('battle-player-sprite-container', 'translate-x-6');

    setTimeout(() => {
        if (sk.type === 'pow' || sk.type === 'int') {
            const isCertain = effectiveSk.hitRate === 100;
            let hitChance = isCertain ? 100 : Math.max(10, Math.min(99, (effectiveSk.hitRate + mods.hitMod) + (p.stats.hit - e.stats.spd) * 0.5));
            
            // 集中効果の適用 (命中率1.5倍)
            if (GAME_STATE.isShuchuActive && !isCertain) {
                hitChance = Math.min(99, hitChance * 1.5);
            }

            let isHit;
            let isGuaranteedDodge = false;
            if (e.dodgeNextGuaranteed) {
                isHit = false;
                isGuaranteedDodge = true;
                e.dodgeNextGuaranteed = false;
            } else {
                isHit = isCertain || (Math.random() * 100 < hitChance);
            }

            // 次技威力アップ（オーロラゲート等）の消費は命中判定に関わらず技を撃った時点で消費する
            const usedForce = consumeForceBoost(p, effectiveSk.force);

            if (isHit) {
                const isPow = sk.type === 'pow';
                // 衰弱状態（わらわら等で受けた場合）を反映したステータスを使用する
                const attackerStat = getWeakenedStat(p, isPow ? p.stats.pow : p.stats.int);
                const defenderStat = e.stats.def;
                
                const statCap = Math.max(30, defenderStat * 2.5);
                let effectiveAttacker = attackerStat;
                if (attackerStat > statCap) {
                    effectiveAttacker = statCap + (attackerStat - statCap) * 0.2;
                }

                const defenderGutsDefenseMod = getGutsDefenseModifier(e.guts);
                let rawDmg = ((effectiveAttacker * usedForce) * mods.dmgMod) - (defenderStat * 0.35);
                let damage = Math.floor(Math.max(10, (rawDmg * (0.9 + Math.random() * 0.2)) * defenderGutsDefenseMod));

                if (isCertain) {
                    addLog(`（必中攻撃！） ターゲットを完璧にロック！`);
                }

                if (e.guts >= 80) {
                    addLog(`🛡️ 相手は高いガッツで身構えている！被ダメージが軽減された。`);
                } else if (e.guts <= 15) {
                    addLog(`💀 相手はガッツが無く無防備だ！大ダメージのチャンス！`);
                }

                // 底力・集中のダメージ補正適用
                let extraDmgMsg = "";
                if (GAME_STATE.isSokojikaraActive) {
                    damage = Math.floor(damage * 1.5);
                    extraDmgMsg += " (底力×1.5)";
                }
                if (GAME_STATE.isShuchuActive) {
                    damage = Math.floor(damage * 1.2);
                    extraDmgMsg += " (集中×1.2)";
                }

                let isCrit = Math.random() < 0.10;
                if (isCrit) {
                    damage = Math.floor(damage * 1.5);
                }

                // 九重神眼等のシールドによる被ダメージ吸収
                const shieldResult = applyShieldAbsorption(e, damage);
                damage = shieldResult.finalDamage;

                if (isCrit) {
                    addLog(`★クリティカルヒット！ ${e.name} に ${damage} ダメージ！${extraDmgMsg}`);
                } else {
                    addLog(`${e.name} に ${damage} ダメージ！${extraDmgMsg}`);
                }
                if (shieldResult.absorbed > 0) {
                    addLog(`🛡️ ${e.name} のシールドが ${shieldResult.absorbed} のダメージを吸収した！(シールド残量: ${e.shieldValue})`);
                }

                e.stats.life = Math.max(0, e.stats.life - damage);
                GAME_STATE.totalDamageDealt += damage;
                
                // 逆上効果の適用 (与ガッツダウン1.2倍)
                let finalGutsDown = sk.gutsDown || 0;
                if (GAME_STATE.isGyakujoActive && finalGutsDown > 0) {
                    finalGutsDown = Math.floor(finalGutsDown * 1.2);
                }

                if (finalGutsDown > 0) {
                    const actualGutsDown = Math.min(e.guts, finalGutsDown);
                    e.guts = Math.max(0, e.guts - actualGutsDown);
                    addLog(`さらに！相手のガッツを ${actualGutsDown} 奪い取った！${GAME_STATE.isGyakujoActive ? " (逆上×1.2)" : ""} (現在: ${Math.floor(e.guts)})`);
                }

                // モノリスの技等が持つ追加効果（衰弱／混乱付与／次技威力アップ）
                applySkillOnHitEffect(p, e, effectiveSk).forEach(msg => addLog(msg));

                // プラントの「ドレイン」等：与えたダメージの一部を自身のライフに変換
                const drainHeal = getDrainHealAmount(effectiveSk, damage);
                if (drainHeal > 0) {
                    p.stats.life = Math.min(p.stats.maxLife, p.stats.life + drainHeal);
                    addLog(`🌿 ${p.name} は相手の生命力を吸収し、ライフが ${drainHeal} 回復した！(現在: ${Math.floor(p.stats.life)})`);
                }

                showEffect(isCrit ? '💥 CRITICAL!! 💥' : '💥 HIT! 💥');
                showDamagePopup('enemy-dmg-popup', damage, isCrit);
                animateSprite('battle-enemy-sprite-container', 'shake');

            } else {
                if (isGuaranteedDodge) {
                    addLog(`🌫️ ${e.name} は陽炎の効果で攻撃を確実に回避した！`);
                } else {
                    addLog('しかし、攻撃はかわされた！');
                }
                showEffect('💨 MISS 💨');
                showDamagePopup('enemy-dmg-popup', 'MISS', false);
            }

            // 攻撃技実行完了後の効果消費
            GAME_STATE.isSokojikaraActive = false;
            GAME_STATE.isShuchuActive = false;

        } else if (sk.type === 'buff_pow') {
            p.stats.pow += 15;
            addLog(`${p.name} の闘志がみなぎる！ちからが15アップした！`);
            showEffect('💪 ちからUP! 💪');
        } else if (sk.type === 'buff_guts') {
            p.guts = Math.min(100, p.guts + 25);
            addLog(`${p.name} は気合を入れ直した！ガッツが25回復！`);
            showEffect('⚡ ガッツチャージ! ⚡');
        } else if (sk.type === 'heal') {
            const healAmount = Math.floor(p.stats.maxLife * 0.35); 
            p.stats.life = Math.min(p.stats.maxLife, p.stats.life + healAmount);
            addLog(`${p.name} は癒された！ライフが ${healAmount} 回復！`);
            showEffect('💚 ライフ回復! 💚');
        }

        updateBattleStatsUI();

        if (e.stats.life <= 0) {
            handleBattleWin();
        }
    }, 300);
}

function endPlayerTurn(defendMode = false) {
    if (GAME_STATE.isBattleEnd || !GAME_STATE.isPlayerTurnActive) return;

    GAME_STATE.isPlayerTurnActive = false;
    
    if (defendMode) {
        GAME_STATE.isDefending = true;
        GAME_STATE.halfRecoveryNextTurn = true;
        document.getElementById('player-defense-shield').classList.remove('hidden');
        addLog(`${GAME_STATE.player.name} は身を守るため防御姿勢をとった！`);
        showEffect('🛡️ DEFENSE 🛡️');
    } else {
        GAME_STATE.isDefending = false;
        GAME_STATE.halfRecoveryNextTurn = false;
    }

    updateBattleStatsUI();
    toggleSkillButtons(false);

    document.getElementById('end-turn-btn').disabled = true;
    document.getElementById('end-turn-btn').classList.add('opacity-50', 'pointer-events-none');
    document.getElementById('end-turn-defend-btn').disabled = true;
    document.getElementById('end-turn-defend-btn').classList.add('opacity-50', 'pointer-events-none');

    setTimeout(() => {
        executeEnemyTurn();
    }, 600);
}

function executeEnemyTurn() {
    if (GAME_STATE.isBattleEnd) return;

    const p = GAME_STATE.player;
    const e = GAME_STATE.enemy;

    addLog(`--- ${e.name} のターン ---`);
    showEffect('⚠️ ENEMY TURN ⚠️');

    const enemyRecovery = Math.floor((e.stats.gutsSpeed || 12) + 20);
    e.guts = Math.min(100, e.guts + enemyRecovery);
    addLog(`${e.name} のガッツが ${enemyRecovery} 回復した！(現在: ${Math.floor(e.guts)})`);
    updateBattleStatsUI();

    // 混乱状態（サケビ声などで受けた場合）の残ターン消化と行動失敗判定
    const enemyConfusionResult = tickStatusTurnsAndCheckConfusion(e);

    setTimeout(() => {
        if (enemyConfusionResult.confused) {
            addLog(`❓ ${e.name} は混乱していて、行動できなかった！`);
            showEffect('❓ 混乱... ❓');
            setTimeout(() => {
                if (p.stats.life <= 0) {
                    handleBattleLose();
                } else {
                    GAME_STATE.battleTurn++;
                    document.getElementById('battle-turn-counter').textContent = GAME_STATE.battleTurn;
                    startPlayerTurn(false);
                }
            }, 800);
            return;
        }

        const affordableSkills = e.skills.map(skKey => {
            return { key: skKey, info: SKILLS_DB[skKey] || SKILLS_DB.boss_bite };
        }).filter(skObj => e.guts >= skObj.info.cost);

        if (affordableSkills.length === 0) {
            addLog(`しかし ${e.name} はガッツが著しく不足しており、何も行動できない！`);
            showEffect('💨 NO ACTION 💨');
        } else {
            affordableSkills.sort((a, b) => b.info.cost - a.info.cost);
            const selected = affordableSkills[0]; 
            const sk = selected.info;

            e.guts -= sk.cost;
            updateBattleStatsUI();

            addLog(`${e.name} の 【${sk.name}】！`);
            animateSprite('battle-enemy-sprite-container', '-translate-x-6');

            setTimeout(() => {
                if (sk.type === 'pow' || sk.type === 'int') {
                    const isCertain = sk.hitRate === 100;
                    const hitChance = isCertain ? 100 : Math.max(10, Math.min(99, sk.hitRate + (e.stats.hit - p.stats.spd) * 0.5));
                    let isHit;
                    let isGuaranteedDodge = false;
                    if (p.dodgeNextGuaranteed) {
                        isHit = false;
                        isGuaranteedDodge = true;
                        p.dodgeNextGuaranteed = false;
                    } else {
                        isHit = isCertain || (Math.random() * 100 < hitChance);
                    }

                    // 次技威力アップの消費は命中判定に関わらず技を撃った時点で消費する
                    const enemyUsedForce = consumeForceBoost(e, sk.force);

                    if (isHit) {
                        const isPow = sk.type === 'pow';
                        const attackerStat = getWeakenedStat(e, isPow ? e.stats.pow : e.stats.int);
                        const defenderStat = p.stats.def;

                        const statCap = Math.max(30, defenderStat * 2.5);
                        let effectiveAttacker = attackerStat;
                        if (attackerStat > statCap) {
                            effectiveAttacker = statCap + (attackerStat - statCap) * 0.2;
                        }

                        const playerGutsDefenseMod = getGutsDefenseModifier(p.guts);

                        let rawDmg = (effectiveAttacker * enemyUsedForce) - (defenderStat * 0.35);
                        let damage = Math.floor(Math.max(8, (rawDmg * (0.9 + Math.random() * 0.2)) * playerGutsDefenseMod));

                        if (isCertain) {
                            addLog(`（必中技！） ${p.name} はこの技を回避することができない！`);
                        }

                        if (GAME_STATE.isDefending) {
                            damage = Math.floor(damage / 2);
                            addLog(`【防御効果】攻撃を盾で受け流し、ダメージを半減した！`);
                        }

                        // 九重神眼等のシールドによる被ダメージ吸収
                        const shieldResult = applyShieldAbsorption(p, damage);
                        damage = shieldResult.finalDamage;

                        p.stats.life = Math.max(0, p.stats.life - damage);
                        addLog(`${p.name} は ${damage} ダメージを受けた！`);
                        if (shieldResult.absorbed > 0) {
                            addLog(`🛡️ ${p.name} のシールドが ${shieldResult.absorbed} のダメージを吸収した！(シールド残量: ${p.shieldValue})`);
                        }

                        // 根性の発動判定
                        if (p.stats.life === 0 && GAME_STATE.playerStatusEffect === "根性") {
                            if (Math.random() < 0.50) {
                                p.stats.life = 1;
                                addLog(`✨ 根性が発動！ ${p.name} は力尽きず、ライフ 1 で耐え抜いた！`);
                                triggerTemporaryStatusEffect("根性");
                            }
                        }

                        // 底力の発動判定 (ライフ3割未満で発動、次の技ダメージ1.5倍)
                        if (GAME_STATE.playerStatusEffect === "底力" && !GAME_STATE.isSokojikaraFired) {
                            if (p.stats.life > 0 && p.stats.life < p.stats.maxLife * 0.3) {
                                GAME_STATE.isSokojikaraFired = true;
                                GAME_STATE.isSokojikaraActive = true;
                                addLog(`💪 底力が発動！窮地に陥ったことで、次の技のダメージが 1.5 倍に上昇！`);
                                updateStatusEffectUI();
                            }
                        }
                        
                        if (sk.gutsDown > 0) {
                            const actualGutsDown = Math.min(p.guts, sk.gutsDown);
                            p.guts = Math.max(0, p.guts - actualGutsDown);
                            addLog(`さらに！ ${p.name} のガッツが ${actualGutsDown} 奪われた！ (現在: ${Math.floor(p.guts)})`);

                            // 逆上の発動判定
                            if (GAME_STATE.playerStatusEffect === "逆上" && !GAME_STATE.isGyakujoActive) {
                                if (Math.random() < 0.65) {
                                    GAME_STATE.isGyakujoActive = true;
                                    addLog(`💢 逆上が発動！ ${p.name} の怒りが頂点に達し、ガッツ回復速度と与えるガッツダウン量が 1.2 倍に上昇！`);
                                    updateStatusEffectUI();
                                }
                            }
                        }

                        applySkillOnHitEffect(e, p, sk).forEach(msg => addLog(msg));

                        // プラント等の敵が「ドレイン」を使う場合：与えたダメージの一部を自身のライフに変換
                        const enemyDrainHeal = getDrainHealAmount(sk, damage);
                        if (enemyDrainHeal > 0) {
                            e.stats.life = Math.min(e.stats.maxLife, e.stats.life + enemyDrainHeal);
                            addLog(`🌿 ${e.name} は相手の生命力を吸収し、ライフが ${enemyDrainHeal} 回復した！(現在: ${Math.floor(e.stats.life)})`);
                        }

                        showEffect('⚡ 被弾!! ⚡');
                        showDamagePopup('player-dmg-popup', damage, false);
                        animateSprite('battle-player-sprite-container', 'shake');
                    } else {
                        if (isGuaranteedDodge) {
                            addLog(`🌫️ ${p.name} は陽炎の効果で攻撃を確実に回避した！`);
                        } else {
                            addLog(`しかし ${p.name} は身軽にかわした！`);
                        }
                        showEffect('💨 回避!! 💨');
                        showDamagePopup('player-dmg-popup', 'MISS', false);
                    }
                } else if (sk.type === 'buff_pow') {
                    e.stats.pow += 15;
                    addLog(`${e.name} は気合を入れて攻撃力を上げた！`);
                    showEffect('💪 相手の攻撃UP! 💪');
                }

                updateBattleStatsUI();
            }, 300);
        }

        setTimeout(() => {
            if (p.stats.life <= 0) {
                handleBattleLose();
            } else {
                GAME_STATE.battleTurn++;
                document.getElementById('battle-turn-counter').textContent = GAME_STATE.battleTurn;
                startPlayerTurn(false);
            }
        }, 800);

    }, 600);
}

function handleBattleWin() {
    GAME_STATE.isBattleEnd = true;
    addLog(`🎉 勝利！ ${GAME_STATE.enemy.name} を倒した！`);

    const p = GAME_STATE.player;
    const scale = GAME_STATE.difficulty === 'hard' ? 1.5 : 1.0;

    const upPow = Math.floor((Math.random() * 6 + 2) * scale);
    const upInt = Math.floor((Math.random() * 6 + 2) * scale);
    const upSpd = Math.floor((Math.random() * 6 + 2) * scale);
    const upMaxLife = 5;
    const upLifeHeal = 45;

    const prevStats = { ...p.stats };

    const finalUpPow = getDiminishedVal(p.stats.pow, upPow);
    const finalUpInt = getDiminishedVal(p.stats.int, upInt);
    const finalUpSpd = getDiminishedVal(p.stats.spd, upSpd);
    const finalUpMaxLife = getDiminishedVal(p.stats.maxLife, upMaxLife);

    p.stats.pow += finalUpPow;
    p.stats.int += finalUpInt;
    p.stats.spd += finalUpSpd;
    p.stats.maxLife += finalUpMaxLife; 
    p.stats.life = Math.min(p.stats.maxLife, p.stats.life + upLifeHeal); 

    GAME_STATE.battleGain = {
        prev: prevStats,
        next: { ...p.stats },
        diff: {
            maxLife: finalUpMaxLife,
            lifeHeal: upLifeHeal,
            pow: finalUpPow,
            int: finalUpInt,
            spd: finalUpSpd
        }
    };

    let droppedItem = null;
    if (GAME_STATE.isBossBattle && (GAME_STATE.floor === 10 || GAME_STATE.floor === 20)) {
        droppedItem = { ...ITEMS_DB.compass_battle };
        GAME_STATE.items.push(droppedItem);
    } else if (Math.random() < 0.25) {
        const droppableKeys = Object.keys(ITEMS_DB).filter(k => ITEMS_DB[k].type !== 'compass');
        const randomKey = droppableKeys[Math.floor(Math.random() * droppableKeys.length)];
        droppedItem = { ...ITEMS_DB[randomKey] };
        GAME_STATE.items.push(droppedItem);
    }

    setTimeout(() => {
        showBattleResultScreen(droppedItem);
    }, 1800);
}

function showBattleResultScreen(droppedItem) {
    const p = GAME_STATE.player;
    const gain = GAME_STATE.battleGain;

    document.getElementById('battle-result-enemy-desc').textContent = `${GAME_STATE.enemy.name} に勝利しました！`;
    
    const listContainer = document.getElementById('battle-gain-list');
    listContainer.innerHTML = `
        <div class="flex justify-between items-center py-1 text-xs">
            <span class="text-gray-400">最大ライフ:</span>
            <span class="font-bold text-white font-mono">${gain.prev.maxLife} ➔ ${gain.next.maxLife} <span class="text-emerald-400 font-bold ml-1">(+${gain.diff.maxLife})</span></span>
        </div>
        <div class="flex justify-between items-center py-1 text-xs">
            <span class="text-gray-400">現在のライフ:</span>
            <span class="font-bold text-white font-mono">${gain.prev.life} ➔ ${gain.next.life} <span class="text-[#055160] bg-[#cff4fc] px-1.5 py-0.5 rounded text-[10px] ml-1 font-bold">(回復 +${gain.diff.lifeHeal})</span></span>
        </div>
        <div class="flex justify-between items-center py-1 border-t border-amber-900/40 mt-1 pt-2 text-xs">
            <span class="text-gray-400">ちから:</span>
            <span class="font-bold text-white font-mono">${gain.prev.pow} ➔ ${gain.next.pow} <span class="text-amber-400 font-bold ml-1">(+${gain.diff.pow})</span></span>
        </div>
        <div class="flex justify-between items-center py-1 text-xs">
            <span class="text-gray-400">かしこさ:</span>
            <span class="font-bold text-white font-mono">${gain.prev.int} ➔ ${gain.next.int} <span class="text-emerald-400 font-bold ml-1">(+${gain.diff.int})</span></span>
        </div>
        <div class="flex justify-between items-center py-1 text-xs">
            <span class="text-gray-400">回避:</span>
            <span class="font-bold text-white font-mono">${gain.prev.spd} ➔ ${gain.next.spd} <span class="text-cyan-400 font-bold ml-1">(+${gain.diff.spd})</span></span>
        </div>
    `;

    const dropDisplay = document.getElementById('battle-item-drop-display');
    if (droppedItem) {
        dropDisplay.classList.remove('hidden');
        document.getElementById('dropped-item-icon').textContent = droppedItem.icon;
        document.getElementById('dropped-item-name').textContent = droppedItem.name;
        document.getElementById('dropped-item-desc').textContent = droppedItem.desc;
    } else {
        dropDisplay.classList.add('hidden');
    }

    changeScreen('screen-battle-result');
}

// 状態変化付与強制イベント画面のセットアップ
function setupStatusEffectEvent() {
    document.getElementById('event-tag').textContent = '🔮 FORCE EVENT / 潜在能力覚醒';
    document.getElementById('event-tag').className = 'text-xs text-red-500 tracking-wider font-extrabold animate-pulse';
    document.getElementById('event-title').textContent = '状態変化の目覚め';
    document.getElementById('event-visual').textContent = '🔮';
    document.getElementById('event-description').textContent = 
        '中ボス【ゴビ】を打ち破ったことで、モンスターの奥底に眠る潜在能力が共鳴している…！モンスターにランダムな【状態変化】が宿ります。';
    document.getElementById('event-result').classList.add('hidden');

    const choicesContainer = document.getElementById('event-choices-container');
    choicesContainer.innerHTML = '';

    const btn = document.createElement('button');
    btn.className = 'w-full py-4 bg-gradient-to-r from-red-800 to-amber-600 hover:from-red-700 hover:to-amber-500 text-white font-extrabold rounded-xl text-sm shadow-lg transition-all active:scale-95 border border-red-500';
    btn.textContent = '✨ 秘められた能力を開花させる！';
    btn.onclick = () => {
        const effects = ["根性", "逆上", "底力", "闘魂", "集中"];
        const chosen = effects[Math.floor(Math.random() * effects.length)];
        GAME_STATE.playerStatusEffect = chosen;

        let desc = "";
        if (chosen === "根性") desc = "根性：相手から攻撃を受けてライフが0になった場合、50%の確率でライフ1で復活します。";
        else if (chosen === "逆上") desc = "逆上：相手からガッツダウンを受けた時に65%の確率で発動、自身のターン開始時のガッツ回復量1.2倍、与えるガッツダウン量1.2倍";
        else if (chosen === "底力") desc = "底力：自身のライフが最大ライフの3割を切った時に発動。発動後の1回目の技のダメージ量1.5倍";
        else if (chosen === "闘魂") desc = "闘魂：相手のガッツが70を超えた時に発動。自身のターン開始時のガッツ回復量1.5倍";
        else if (chosen === "集中") desc = "集中：自身のガッツが90を超えた時に発動。発動後の1回目の技の命中率1.5倍＋ダメージ量1.2倍";

        const resultBox = document.getElementById('event-result');
        resultBox.innerHTML = `<span class="text-red-500 text-base font-black">【${chosen}】</span>の能力が目覚めた！<br><span class="text-xs text-gray-300 font-normal block mt-2">${desc}</span>`;
        resultBox.classList.remove('hidden');

        choicesContainer.innerHTML = `
            <button onclick="endStatusEffectEvent()" class="w-full py-4 bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold rounded-xl text-xs shadow-md transition-all">
                冒険を再開する (11階へ)
            </button>
        `;
    };
    choicesContainer.appendChild(btn);

    changeScreen('screen-event');
}

function getGameOverHint() {
    const floor = GAME_STATE.floor;
    const p = GAME_STATE.player;
    
    // ボス戦での敗北
    if (GAME_STATE.isBossBattle) {
        if (floor === 10) {
            return "中ボス『ゴビ』は『ちから』が極めて高く、一撃が致命傷になります。しかし『命中』と『回避』が低いため、トレーニングで『回避』を鍛えて攻撃をかわすか、『丈夫さ』を高めて被ダメージを抑えましょう。また、ガッツダウン技で相手のガッツを削れば、大技『ローリング激突』の頻度を下げられます。";
        }
        if (floor === 20) {
            return "中ボス『デュラハン』は非常に『丈夫さ』が高く、中途半端な攻撃力ではダメージが通りません。トレーニングで『ちから』や『かしこさ』をしっかり高めて挑みましょう。また、相手は『きあい』で攻撃力を高めてくるため、敵の攻撃ターンは『防御して終了』を使ってダメージを軽減するのが極めて有効です。";
        }
        if (floor === 30) {
            return "伝説の邪神『モスト』は、回避不能の必中技『なめる』や、壊滅的ダメージを与える『メテオバースト』を放ちます。相手のガッツが溜まると手がつけられなくなるため、ガッツダウン効果の高い技（モッシーの『もっさま』、スエゾーの『歌う』など）を主軸にし、相手のガッツを常に低く保ちながら戦うのが勝利の鍵です。";
        }
    }
    
    // 道中での敗北
    // ライフが極端に低い場合
    if (p && p.stats.maxLife < 220) {
        return "最大ライフが低いため、敵のクリティカルや連続攻撃で力尽きやすくなっています。序盤は『走り込み』や『ライフパン』を優先し、最大ライフを220〜250程度まで引き上げることで、生存率が劇的に向上します。";
    }
    
    // ガッツ補正に関する一般的なアドバイス
    const rand = Math.random();
    if (rand < 0.5) {
        return "【ガッツ補正の重要性】本作では自身のガッツ量に応じて『与ダメージ（最大1.5倍）』と『命中率（最大+15%）』がアップします。逆にガッツが少ない状態で攻撃すると、与えるダメージが半減し、受けるダメージが1.5倍に跳ね上がります。焦って技を連発せず、ガッツを70〜90程度まで溜めてから一気に強力な技を叩き込むのが基本戦術です。";
    } else {
        return "【ボスの攻撃パターンと防御】ボスモンスターはガッツが溜まると消費ガッツの大きい大技を優先して使ってきます。敵のガッツが溜まっている状態の時は、無理に攻撃せず『防御して終了』を選択しましょう。受けるダメージが半減し、次のターンを安全に迎えることができます。";
    }
}

function endStatusEffectEvent() {
    goToAdventure();
}

function confirmBattleResult() {
    if (GAME_STATE.floor === 10 && GAME_STATE.isBossBattle) {
        GAME_STATE.floor++;
        GAME_STATE.isBossBattle = false;
        GAME_STATE.actionPerformedThisFloor = false;
        setupStatusEffectEvent();
    } else {
        GAME_STATE.floor++;
        GAME_STATE.actionPerformedThisFloor = false; 

        if (GAME_STATE.floor > 30) {
            endGame(true);
        } else {
            goToAdventure();
        }
    }
}

function handleBattleLose() {
    GAME_STATE.isBattleEnd = true;
    addLog(`💀 敗北… ${GAME_STATE.player.name} は力尽きた…`);

    setTimeout(() => {
        endGame(false);
    }, 2000);
}

function endGame(isClear) {
    const p = GAME_STATE.player;
    const resTitle = document.getElementById('result-title');
    const resSubtitle = document.getElementById('result-subtitle');
    const resBadge = document.getElementById('result-badge');
    const rankText = document.getElementById('result-rank-text');
    const rankDesc = document.getElementById('result-rank-desc');
    const heritageSection = document.getElementById('heritage-section');
    const hintBox = document.getElementById('gameover-hint-box');
    const hintText = document.getElementById('gameover-hint-text');

    const totalDmg = GAME_STATE.totalDamageDealt;
    const totalAct = Math.max(1, GAME_STATE.totalActions);
    const multiplier = totalDmg / totalAct;
    const baseScore = Math.floor(totalDmg * multiplier);
    const clearBonus = isClear ? 1.5 : 1.0; 
    const finalScore = Math.floor(baseScore * clearBonus);

    // 30F（モスト戦）でのゲームオーバーは「実質到達」として扱い、マスモン登録を許可する
    const isMostGameOver = !isClear && GAME_STATE.floor === 30 && GAME_STATE.isBossBattle;
    GAME_STATE.lastGameWasClear = isClear || isMostGameOver;

    document.getElementById('result-difficulty').textContent = GAME_STATE.difficulty.toUpperCase();
    document.getElementById('result-final-floor').textContent = `${GAME_STATE.floor - (isClear ? 1 : 0)} / 30`;
    document.getElementById('result-total-actions').textContent = totalAct;
    document.getElementById('result-total-damage').textContent = totalDmg.toLocaleString();
    document.getElementById('result-multiplier').textContent = `×${multiplier.toFixed(1)}`;
    document.getElementById('result-final-score').textContent = finalScore.toLocaleString();

    const clearBonusEl = document.getElementById('result-clear-bonus');
    if (clearBonusEl) {
        if (isClear) {
            clearBonusEl.textContent = '🏆 クリアボーナス ×1.5';
            clearBonusEl.classList.remove('hidden');
        } else {
            clearBonusEl.classList.add('hidden');
        }
    }

    if (isClear) {
        resTitle.textContent = "CONGRATULATIONS!";
        resTitle.className = "text-2xl font-black text-amber-500 pixel-font";
        resSubtitle.textContent = "ブリーダーとして、30階層の栄光を掴み取りました！";
        resBadge.textContent = "🏆";

        if (finalScore >= 80000) {
            rankText.textContent = "👑 神の領域のレジェンドブリーダー";
            rankDesc.textContent = "圧倒的な与ダメージ効率！運と戦術、すべてを極めた神の化身です。";
        } else if (finalScore >= 30000) {
            rankText.textContent = "🥇 天才ブリーダー";
            rankDesc.textContent = "無駄のない素晴らしいトレーニングと的確な戦術でモンスターを導きました。";
        } else if (finalScore >= 10000) {
            rankText.textContent = "🥈 一流ブリーダー";
            rankDesc.textContent = "モンスターとの強い絆で見事完走！次はさらなる高みを目指しましょう。";
        } else {
            rankText.textContent = "🥉 熟練ブリーダー";
            rankDesc.textContent = "クリアおめでとう！攻撃技を積極的に使うとスコアが伸びます。";
        }

        if (hintBox) hintBox.classList.add('hidden');

        let template = MONSTER_TEMPLATES.mochi; 
        if (p.emoji === '👁️') template = MONSTER_TEMPLATES.suezo;
        if (p.emoji === '🦖') template = MONSTER_TEMPLATES.dino;
        if (p.emoji === '🗿') template = MONSTER_TEMPLATES.monolith;
        if (p.emoji === '🌸') template = MONSTER_TEMPLATES.plant;
        if (p.emoji === '🦊') template = MONSTER_TEMPLATES.kyubi;

        let defaultSkills = [];
        if (template.id === 'mochi') defaultSkills = ['monta', 'mochiki', 'sakurafubuki'];
        if (template.id === 'suezo') defaultSkills = ['shippobinta', 'nameru', 'kamitsuki'];
        if (template.id === 'dino') defaultSkills = ['shippo', 'kamitsuki_dino', 'sunakake'];
        if (template.id === 'monolith') defaultSkills = ['monotaore', 'warawara', 'sakebigoe'];
        if (template.id === 'plant') defaultSkills = ['renkon', 'tane_gun', 'kafun'];
        if (template.id === 'kyubi') defaultSkills = ['hikkaki', 'kitsunebi'];

        const additionalSkills = p.skills.filter(s => !defaultSkills.includes(s));

        if (additionalSkills.length > 0) {
            heritageSection.classList.remove('hidden');
            const hList = document.getElementById('heritage-skills-list');
            hList.innerHTML = '';
            additionalSkills.forEach(skKey => {
                const sk = SKILLS_DB[skKey];
                if (!sk) return;
                const btn = document.createElement('button');
                btn.className = "p-2 bg-cyan-950 hover:bg-cyan-900 border border-cyan-700 text-cyan-200 text-[11px] font-bold rounded-xl transition-all text-center";
                btn.textContent = `【${sk.name}】を継承`;
                btn.onclick = () => {
                    saveInheritedSkill(skKey);
                    showToast(`秘技【${sk.name}】を次回のプレイに引き継ぎました！`);
                    confirmReturnToTitleFromResult();
                };
                hList.appendChild(btn);
            });
        } else {
            heritageSection.classList.add('hidden');
        }

        // クリア時のみ：マスモン（マスターモンスター）保存UIを表示
        if (typeof setupMasmonSaveSection === 'function') {
            setupMasmonSaveSection();
        }

    } else {
        if (isMostGameOver && typeof setupMasmonSaveSection === 'function') {
            // モスト戦（30F）での敗北時も、育て上げたモンスターをマスモンとして登録できるようにする
            setupMasmonSaveSection();
        } else {
            const masmonSaveSectionEl = document.getElementById('masmon-save-section');
            if (masmonSaveSectionEl) masmonSaveSectionEl.classList.add('hidden');
        }

        resTitle.textContent = "GAME OVER";
        resTitle.className = "text-2xl font-black text-red-500 pixel-font";
        resSubtitle.textContent = `第 ${GAME_STATE.floor} 階層にて、モンスターが倒れてしまいました…`;
        resBadge.textContent = "💀";

        if (finalScore >= 30000) {
            rankText.textContent = "🥇 惜しかった天才ブリーダー";
            rankDesc.textContent = "与ダメ効率は抜群！あとはもう少しの粘りで栄光が見えていた。";
        } else if (finalScore >= 10000) {
            rankText.textContent = "🥈 奮闘した一流ブリーダー";
            rankDesc.textContent = "よく戦いました。育成と休養のバランスをもう一度見直してみましょう。";
        } else {
            rankText.textContent = "新米ブリーダー";
            rankDesc.textContent = "育成と休養のバランス、バトルでのガッツ管理をもう一度見直してみましょう。";
        }

        if (hintBox && hintText) {
            hintText.textContent = getGameOverHint();
            hintBox.classList.remove('hidden');
        }

        heritageSection.classList.add('hidden');
    }

    submitScore(GAME_STATE.playerName, p.name, finalScore, GAME_STATE.difficulty, GAME_STATE.floor - (isClear ? 1 : 0), isClear);

    changeScreen('screen-result');
}

function restartGame() {
    changeScreen('screen-title');
}

// 結果画面から「タイトルに戻る」際、マスモン未登録なら確認を挟む
// （継承技の選択ボタン／画面下部の「タイトル画面に戻る」ボタンの両方から呼ばれる）
function confirmReturnToTitleFromResult() {
    const masmonSaveSection = document.getElementById('masmon-save-section');
    const masmonSaveBtn = document.getElementById('masmon-save-btn');

    // マスモン登録セクションが表示されておらず、または既に保存済み（保存ボタンが隠れている）場合はそのまま戻る
    const isSectionVisible = masmonSaveSection && !masmonSaveSection.classList.contains('hidden');
    const isMasmonAlreadySaved = !masmonSaveBtn || masmonSaveBtn.classList.contains('hidden');

    if (!isSectionVisible || isMasmonAlreadySaved) {
        restartGame();
        return;
    }

    const wantsToLeave = confirm('このモンスターをマスモンとして登録せずにタイトルへ戻りますか？\n（今登録しないと、このモンスターのデータは保存されません）');
    if (wantsToLeave) {
        restartGame();
    }
}

