import assert from "node:assert/strict";
import test from "node:test";

import {
  APPRENTICE_MILESTONES,
  AI_ARCHETYPES,
  CARD_BY_ID,
  CARD_CATALOG,
  DEFAULT_OPPONENT_DECK,
  DEFAULT_STARTER_DECK,
  HERO_POWER_COST,
  LADDER_READY_DECKS,
  LADDER_READY_TRIAL_DAYS,
  MAX_BOARD_SIZE,
  MAX_HAND_SIZE,
  RANKED_FIRST_TIME_REWARD_LEVELS,
  RANKED_SEASON_REWARD_LEVELS,
  applyOutstandingRankedRewards,
  applyRankedMatchResult,
  applyCommand,
  apprenticeMatchPoolForFacts,
  apprenticeMilestoneComplete,
  apprenticeMilestoneProgress,
  apprenticeTrackComplete,
  aiMatchTicketMatchesProof,
  battleEventsToEffects,
  chooseAiMulliganIndexes,
  cloneMatch,
  createMatch,
  derivePvpSettlement,
  drawPack,
  runAiTurn,
  getTraitStatuses,
  getHeroPower,
  REWARD_TRACK,
  craftCost,
  createRankedRewardState,
  createRankedSnapshot,
  disenchantValue,
  isRankFloorProgress,
  LADDER_DIAMOND_FIVE_PROGRESS,
  LADDER_LEGEND_PROGRESS,
  LADDER_RANK_FLOORS,
  LADDER_START_RATING,
  ladderLeagueForProgress,
  ladderProgressForLegacyRating,
  ladderProgressForRating,
  ladderRankForProgress,
  ladderRatingForProgress,
  ladderStarsForProgress,
  ladderStarsForRating,
  ladderTierForRating,
  rankFloorForProgress,
  resetRankedSnapshotForSeason,
  starBonusForSeasonPeak,
  hiddenMmrExpectedScore,
  initialHiddenMmrForVisibleRating,
  matchQualityForGap,
  matchmakingSearchWindow,
  normalizeRankedSnapshot,
  normalizeRankedRewardState,
  rankedFirstTimeRewardForFloor,
  rankedSeasonRewardForPeak,
  rollRankedSeason,
  updateHiddenMmr,
  updateHiddenMmrPair,
  ladderReadyDeckMatches,
  ladderReadyTrialIsActive,
  planAiTurnReplay,
  shouldScheduleLocalAiTurn,
  updateRankedSnapshot,
  validateDeck,
} from "../lib/game/index.ts";
import type {
  BattleEvent,
  MatchState,
  PlayerId,
  UnitState,
  RankedRewardEconomy,
} from "../lib/game/index.ts";

function unit(
  entityId: string,
  cardId: string,
  owner: PlayerId,
  overrides: Partial<UnitState> = {},
): UnitState {
  const card = CARD_BY_ID[cardId];
  if (!card || card.type !== "unit") {
    throw new Error(`Test fixture card ${cardId} is not a unit.`);
  }

  return {
    entityId,
    cardId,
    name: card.name,
    owner,
    attack: card.attack ?? 0,
    health: card.health ?? 1,
    maxHealth: card.health ?? 1,
    baseAttack: card.attack ?? 0,
    baseHealth: card.health ?? 1,
    keywords: [...(card.keywords ?? [])],
    stars: 1,
    furyStacks: 0,
    hasAttacked: false,
    summonedTurn: 0,
    silenced: false,
    spellDamage: card.spellDamage ?? 0,
    ...overrides,
  };
}

function editableMatch(seed = 101): MatchState {
  let state = cloneMatch(createMatch({ seed }));
  for (const player of [0, 1] as const) {
    const result = applyCommand(state, {
      type: "mulligan",
      player,
      cardIndexes: [],
    });
    assert.equal(result.accepted, true);
    state = result.state;
  }
  return state;
}

function editableMatchWithDecks(
  decks: readonly [readonly string[], readonly string[]],
  seed = 101,
): MatchState {
  let state = cloneMatch(createMatch({ seed, decks }));
  for (const player of [0, 1] as const) {
    const result = applyCommand(state, {
      type: "mulligan",
      player,
      cardIndexes: [],
    });
    assert.equal(result.accepted, true);
    state = result.state;
  }
  return state;
}

test("天梯预备军械库提供六套可验证卡组与七日试玩规则", () => {
  assert.equal(LADDER_READY_TRIAL_DAYS, 7);
  assert.equal(LADDER_READY_DECKS.length, 6);
  assert.equal(new Set(LADDER_READY_DECKS.map((deck) => deck.id)).size, 6);
  assert.equal(new Set(LADDER_READY_DECKS.map((deck) => deck.faction)).size, 6);
  for (const offer of LADDER_READY_DECKS) {
    assert.equal(offer.deck.length, 30);
    assert.equal(validateDeck(offer.deck).valid, true, `${offer.name} 必须符合组牌规则`);
    assert.equal(ladderReadyDeckMatches([...offer.deck].reverse(), offer.deck), true);
    assert.equal(ladderReadyDeckMatches(offer.deck.slice(1), offer.deck), false);
  }
  assert.equal(ladderReadyDeckMatches(LADDER_READY_DECKS[0]!.deck, LADDER_READY_DECKS[1]!.deck), false);
  const now = Date.parse("2026-08-25T12:00:00.000Z");
  const liveTrial = {
    activatedAt: "2026-08-24T12:00:00.000Z",
    expiresAt: "2026-08-31T12:00:00.000Z",
    claimedDeckId: null,
  };
  assert.equal(ladderReadyTrialIsActive(liveTrial, now), true);
  assert.equal(ladderReadyTrialIsActive({ ...liveTrial, expiresAt: "2026-08-25T11:59:59.000Z" }, now), false);
  assert.equal(ladderReadyTrialIsActive({ ...liveTrial, claimedDeckId: LADDER_READY_DECKS[0]!.id }, now), false);
});

test("AI 对局票据绑定 token、seed、先手、卡组顺序与对手原型", () => {
  const playerDeck = [...DEFAULT_STARTER_DECK];
  const ticket = {
    token: "ai-12345678-1234-4234-8234-123456789abc",
    seed: 20260820,
    startingPlayer: 1 as const,
    playerDeck,
    opponentArchetypeId: AI_ARCHETYPES[0]?.id ?? "tide-control",
  };
  const proof = {
    ticketToken: ticket.token,
    seed: ticket.seed,
    startingPlayer: ticket.startingPlayer,
    playerDeck: [...ticket.playerDeck],
    opponentArchetypeId: ticket.opponentArchetypeId,
  };

  assert.equal(aiMatchTicketMatchesProof(ticket, proof), true);
  assert.equal(aiMatchTicketMatchesProof(ticket, { ...proof, seed: proof.seed + 1 }), false);
  assert.equal(aiMatchTicketMatchesProof(ticket, { ...proof, startingPlayer: 0 }), false);
  assert.equal(aiMatchTicketMatchesProof(ticket, { ...proof, ticketToken: `${proof.ticketToken}-other` }), false);
  assert.equal(aiMatchTicketMatchesProof(ticket, { ...proof, opponentArchetypeId: "other-ai" }), false);
  assert.equal(aiMatchTicketMatchesProof(ticket, {
    ...proof,
    playerDeck: [...proof.playerDeck].reverse(),
  }), false);
});

test("PVP 结算只从权威参与身份与胜者推导座位和结果", () => {
  assert.deepEqual(derivePvpSettlement({
    identity: "host-id",
    hostIdentity: "host-id",
    guestIdentity: "guest-id",
    phase: "game-over",
    winner: 1,
    reason: "core-destroyed",
  }), {
    ok: true,
    player: 0,
    result: "loss",
    opponentIdentity: "guest-id",
  });
  assert.deepEqual(derivePvpSettlement({
    identity: "guest-id",
    hostIdentity: "host-id",
    guestIdentity: "guest-id",
    phase: "game-over",
    winner: null,
    reason: "draw",
  }), {
    ok: true,
    player: 1,
    result: "draw",
    opponentIdentity: "host-id",
  });
  assert.deepEqual(derivePvpSettlement({
    identity: "same-id",
    hostIdentity: "same-id",
    guestIdentity: "same-id",
    phase: "game-over",
    winner: 0,
  }), { ok: false, reason: "ambiguous-participant" });
  assert.deepEqual(derivePvpSettlement({
    identity: "outsider",
    hostIdentity: "host-id",
    guestIdentity: "guest-id",
    phase: "game-over",
    winner: 0,
  }), { ok: false, reason: "not-participant" });
  assert.deepEqual(derivePvpSettlement({
    identity: "host-id",
    hostIdentity: "host-id",
    guestIdentity: "guest-id",
    phase: "main",
    winner: 0,
  }), { ok: false, reason: "not-finished" });
});

test("目录包含20个体系各50张原创卡，并覆盖单位、战术和武器", () => {
  const factions = ["曜光", "幽潮", "中立", "烬火", "星穹", "苍林", "雷铸", "霜境", "砂海", "赤月", "灵脉", "暮影", "云瀑", "磁风", "晶核", "梦境", "裂星", "时砂", "幽森", "天穹"] as const;

  assert.equal(CARD_CATALOG.length, 1000);
  assert.equal(new Set(CARD_CATALOG.map((card) => card.id)).size, CARD_CATALOG.length);
  assert.equal(new Set(CARD_CATALOG.map((card) => card.name)).size, CARD_CATALOG.length);

  for (const faction of factions) {
    const cards = CARD_CATALOG.filter((card) => card.faction === faction);
    assert.equal(cards.length, 50, `${faction} 应有 50 张卡`);
    assert.ok(cards.filter((card) => card.type === "unit").length >= 15, `${faction} 应有单位`);
    assert.ok(cards.filter((card) => card.type === "spell").length >= 5, `${faction} 应有战术`);
    if (!["曜光", "幽潮", "中立", "烬火", "星穹", "苍林", "雷铸"].includes(faction)) {
      assert.equal(cards.filter((card) => card.type === "weapon").length, 1, `${faction} 应有 1 把武器`);
    }

    const rosterDeck = validateDeck(cards.filter((card) => card.rarity !== "传说").slice(0, 15).flatMap((card) => [card.id, card.id]));
    assert.equal(rosterDeck.valid, true, `${faction} 的完整阵营牌组应可直接进入对战`);
    assert.equal(rosterDeck.faction, faction === "中立" ? null : faction);
  }

  assert.equal(CARD_BY_ID["storm-chain-discharge"]?.overload, 1);
  assert.ok(CARD_BY_ID["storm-chain-discharge"]?.keywords?.includes("overload"));
  assert.ok(CARD_BY_ID["neutral-calibrated-bolt"]?.keywords?.includes("combo"));
  assert.equal(CARD_BY_ID["neutral-relic-appraiser"]?.spellDamage, 1);
  assert.ok(CARD_BY_ID["neutral-relic-appraiser"]?.keywords?.includes("spell-damage"));
  assert.ok(CARD_BY_ID["void-pressure-spike"]?.keywords?.includes("silence"));
  assert.ok(CARD_BY_ID["neutral-field-reinforcement"]?.keywords?.includes("choose-one"));
  assert.ok(CARD_BY_ID["astral-phase-shift"]?.keywords?.includes("transform"));
  assert.ok(CARD_BY_ID["ember-ignite-morale"]?.keywords?.includes("temporary"));
  assert.ok(CARD_BY_ID["neutral-ruin-stag"]?.keywords?.includes("end-of-turn"));
  assert.ok(CARD_BY_ID["void-abyssal-chanter"]?.keywords?.includes("start-of-turn"));
  assert.ok(CARD_BY_ID["neutral-mobile-forge"]?.keywords?.includes("battlecry"));
  assert.ok(CARD_BY_ID["neutral-crossroad-duelist"]?.keywords?.includes("spell-trigger"));
  assert.ok(CARD_BY_ID["storm-capacitor-sentry"]?.keywords?.includes("spell-trigger"));
  assert.ok(CARD_BY_ID["sun-refraction-aid"]?.keywords?.includes("tradeable"));
  assert.ok(CARD_BY_ID["neutral-route-ledger"]?.keywords?.includes("tradeable"));

  // Generated seasonal cards must expose real reducer hooks, not just a
  // keyword badge in the collection UI. This catches silent regressions when
  // a new faction theme is added.
  for (const card of CARD_CATALOG.filter((candidate) => candidate.id.includes("-season-"))) {
    const keywords = new Set(card.keywords ?? []);
    if (keywords.has("battlecry")) assert.ok(card.onPlay?.length, `${card.id} 的战吼没有登场效果`);
    if (keywords.has("deathrattle")) assert.ok(card.onDeath?.length, `${card.id} 的亡语没有死亡效果`);
    if (keywords.has("freeze")) assert.ok(card.onPlay?.some((effect) => effect.kind === "freeze"), `${card.id} 的冻结没有挂接效果`);
    if (keywords.has("overload")) assert.ok((card.overload ?? 0) > 0, `${card.id} 的过载没有资源锁定`);
    if (keywords.has("spell-trigger")) assert.ok(card.onSpellPlayed?.length, `${card.id} 的法术触发没有监听器`);
    if (keywords.has("start-of-turn")) assert.ok(card.onTurnStart?.length, `${card.id} 缺少回合开始触发`);
    if (keywords.has("end-of-turn")) assert.ok(card.onTurnEnd?.length, `${card.id} 缺少回合结束触发`);
    if (keywords.has("temporary")) assert.ok(card.onTurnStart?.length, `${card.id} 缺少临时增益触发`);
    if (keywords.has("spell-damage")) assert.equal(card.spellDamage, 1, `${card.id} 的法术伤害没有数值`);
    if (keywords.has("combo")) {
      assert.ok(card.combo?.some((effect) => effect.kind === "buff-all-friendly"), `${card.id} 的连击没有无目标效果`);
    }
    if (keywords.has("tradeable")) assert.equal(card.tradeable, true, `${card.id} 的可交易标记未生效`);
    if (keywords.has("secret")) assert.ok(card.effect?.some((effect) => effect.kind === "secret"), `${card.id} 的奥秘没有触发器`);
    if (keywords.has("transform")) assert.ok(card.onPlay?.some((effect) => effect.kind === "transform"), `${card.id} 的变形没有效果`);
  }

  const endOfTurn = CARD_BY_ID["timesand-season-03"];
  assert.ok(endOfTurn?.onTurnEnd?.some((effect) => effect.kind === "buff"));
  assert.equal(endOfTurn?.onTurnEnd?.some((effect) => effect.kind === "temporary-buff"), false);
  assert.match(endOfTurn?.description ?? "", /回合结束：获得 \+1 攻击/);

  const temporary = CARD_BY_ID["timesand-season-01"];
  assert.ok(temporary?.onTurnStart?.some((effect) => effect.kind === "temporary-buff"));
  assert.equal(temporary?.onTurnEnd, undefined);
  assert.match(temporary?.description ?? "", /回合开始：本回合获得 \+1\/\+1/);

  const comboWithBaseTarget = CARD_BY_ID["leyline-season-15"];
  assert.equal(comboWithBaseTarget?.target, "enemy-character");
  assert.ok(comboWithBaseTarget?.onPlay?.some((effect) => effect.kind === "damage"));
  assert.ok(comboWithBaseTarget?.combo?.some((effect) => effect.kind === "buff-all-friendly"));
  assert.match(comboWithBaseTarget?.description ?? "", /造成伤害/);
  assert.match(comboWithBaseTarget?.description ?? "", /所有友方单位/);

  const overwrittenFreeze = CARD_BY_ID["cloudfall-season-08"];
  assert.deepEqual(overwrittenFreeze?.onPlay, [{ kind: "freeze", amount: 1 }]);
  assert.doesNotMatch(overwrittenFreeze?.description ?? "", /造成伤害|抽一张牌|获得 \+1\/\+1/);
  const overwrittenSilence = CARD_BY_ID["dusk-season-08"];
  assert.deepEqual(overwrittenSilence?.onPlay, [{ kind: "silence" }]);
  assert.doesNotMatch(overwrittenSilence?.description ?? "", /造成伤害|抽一张牌|获得 \+1\/\+1/);
  const overwrittenTransform = CARD_BY_ID["crystal-season-01"];
  assert.ok(overwrittenTransform?.onPlay?.some((effect) => effect.kind === "transform"));
  assert.doesNotMatch(overwrittenTransform?.description ?? "", /造成伤害|抽一张牌|获得 \+1\/\+1/);

  const pressureSpike = CARD_BY_ID["void-pressure-spike"];
  assert.deepEqual(pressureSpike?.effect, [{ kind: "silence" }, { kind: "damage", amount: 3 }]);
  assert.match(pressureSpike?.description ?? "", /^沉默.*再.*造成 3 点伤害/);

  for (const card of CARD_CATALOG) {
    if (card.type === "unit") {
      assert.ok(card.traits && card.traits.length > 0, `${card.name} 缺少特质`);
    } else if (card.type === "weapon") {
      assert.ok((card.attack ?? 0) > 0, `${card.name} 缺少武器攻击力`);
      assert.ok((card.durability ?? 0) > 0, `${card.name} 缺少武器耐久`);
    } else {
      assert.ok(card.school, `${card.name} 缺少战术学派`);
    }
  }
});

test("20套 AI 演算牌组都有体系主题、完整曲线和合法复制上限", () => {
  assert.equal(AI_ARCHETYPES.length, 20);
  assert.equal(new Set(AI_ARCHETYPES.map((archetype) => archetype.faction)).size, 20);

  for (const archetype of AI_ARCHETYPES) {
    assert.equal(archetype.deck.length, 30, `${archetype.name} 应为 30 张牌`);
    const validation = validateDeck(archetype.deck);
    assert.equal(validation.valid, true, `${archetype.name} 不应违反牌组规则`);
    assert.ok(
      archetype.deck.some((cardId) => CARD_BY_ID[cardId]?.type === "weapon"),
      `${archetype.name} 应包含阵营武器`,
    );
    assert.ok(
      archetype.deck.some((cardId) => (CARD_BY_ID[cardId]?.cost ?? 0) >= 7),
      `${archetype.name} 应保留高费终局牌`,
    );
    assert.ok(
      archetype.deck.some((cardId) => CARD_BY_ID[cardId]?.cost === 5),
      `${archetype.name} 应保留中期 5 费节奏点`,
    );
  }
});

test("特质按不同单位计数，并在 2 / 4 个单位时升档", () => {
  const cards = (ids: string[]) => ids.map((id) => {
    const card = CARD_BY_ID[id];
    if (!card) throw new Error(`Missing fixture card ${id}`);
    return card;
  });
  const tier = (ids: string[]) =>
    getTraitStatuses(cards(ids)).find((status) => status.id === "swift");

  assert.deepEqual(
    [
      tier(["sun-dawn-scout"])?.tier,
      tier(["sun-dawn-scout", "neutral-moss-runner"])?.tier,
      tier(["sun-dawn-scout", "neutral-moss-runner", "sun-skyfire-roc"])?.tier,
      tier([
        "sun-dawn-scout",
        "neutral-moss-runner",
        "sun-skyfire-roc",
        "neutral-clockwork-beetle",
      ])?.tier,
    ],
    [0, 1, 1, 2],
  );
  assert.equal(
    tier(["sun-dawn-scout", "sun-dawn-scout", "neutral-moss-runner"])?.count,
    2,
  );
});

test("默认双方新手牌组均为合法 30 张单阵营牌组", () => {
  assert.equal(DEFAULT_STARTER_DECK.length, 30);
  assert.equal(DEFAULT_OPPONENT_DECK.length, 30);
  assert.deepEqual(validateDeck(DEFAULT_STARTER_DECK), {
    valid: true,
    errors: [],
    faction: "曜光",
  });
  assert.deepEqual(validateDeck(DEFAULT_OPPONENT_DECK), {
    valid: true,
    errors: [],
    faction: "幽潮",
  });
});

test("卡包首槽保底稀有，并在收藏未满时避免超过重复上限", () => {
  const pack = drawPack({}, [0, 0, 0, 0, 0]);
  const opened = pack.flatMap((entry) => Array.from({ length: entry.count }, () => entry.cardId));
  assert.equal(opened.length, 5);
  assert.ok(opened.some((cardId) => CARD_BY_ID[cardId]?.rarity !== "普通"));

  const collection = Object.fromEntries(
    CARD_CATALOG.map((card) => [card.id, card.rarity === "传说" ? 1 : 2]),
  );
  collection["sun-dawn-scout"] = 0;
  const protectedPack = drawPack(collection, [0, 0, 0, 0, 0]);
  assert.ok(protectedPack.some((entry) => entry.cardId === "sun-dawn-scout"));
  assert.ok(protectedPack.every((entry) => entry.cardId === "sun-dawn-scout" || collection[entry.cardId] >= 1));
  const pityPack = drawPack({}, [0, 0, 0, 0, 0], { guaranteeLegendary: true });
  assert.ok(pityPack.some((entry) => CARD_BY_ID[entry.cardId]?.rarity === "传说"), "传奇保底包首槽必须包含传说卡");
});

test("收藏经济遵循稀有度制作与分解比例，奖励轨道等级单调", () => {
  assert.equal(craftCost("普通"), 40);
  assert.equal(craftCost("稀有"), 100);
  assert.equal(craftCost("史诗"), 400);
  assert.equal(craftCost("传说"), 1600);
  assert.equal(disenchantValue("普通"), 5);
  assert.equal(disenchantValue("稀有"), 20);
  assert.equal(disenchantValue("史诗"), 100);
  assert.equal(disenchantValue("传说"), 400);
  assert.ok(REWARD_TRACK.every((reward, index) => index === 0 || reward.level > REWARD_TRACK[index - 1].level));
  assert.ok(REWARD_TRACK.every((reward) => reward.amount > 0 && reward.level >= 2));
});

test("新兵晋升轨道按持久化实战事实解锁且不会超额显示进度", () => {
  assert.deepEqual(
    APPRENTICE_MILESTONES.map((milestone) => milestone.id),
    ["decode-first-pack", "complete-first-match", "win-first-match", "reach-level-two"],
  );
  assert.equal(new Set(APPRENTICE_MILESTONES.map((milestone) => milestone.id)).size, APPRENTICE_MILESTONES.length);
  assert.ok(APPRENTICE_MILESTONES.every((milestone) => milestone.reward.amount > 0));

  const fresh = { packsOpened: 0, matchesPlayed: 0, wins: 0, level: 1 };
  assert.ok(APPRENTICE_MILESTONES.every((milestone) => !apprenticeMilestoneComplete(milestone, fresh)));
  assert.equal(apprenticeTrackComplete(fresh), false);
  assert.equal(apprenticeMatchPoolForFacts(fresh), "apprentice");

  const rewardsUnclaimedButObjectivesComplete = { packsOpened: 1, matchesPlayed: 1, wins: 1, level: 2 };
  assert.equal(apprenticeTrackComplete(rewardsUnclaimedButObjectivesComplete), true);
  assert.equal(apprenticeMatchPoolForFacts(rewardsUnclaimedButObjectivesComplete), "standard");

  const graduated = { packsOpened: 8, matchesPlayed: 12, wins: 3, level: 4 };
  for (const milestone of APPRENTICE_MILESTONES) {
    assert.equal(apprenticeMilestoneComplete(milestone, graduated), true);
    assert.equal(apprenticeMilestoneProgress(milestone, graduated), milestone.target);
  }
  assert.equal(apprenticeMatchPoolForFacts(graduated), "standard");
});

test("天梯使用五联赛十段与每段三星的确定性进度", () => {
  assert.equal(ladderTierForRating(LADDER_START_RATING), "青铜");
  assert.equal(ladderStarsForRating(LADDER_START_RATING), 0);
  assert.equal(ladderRankForProgress(0), 10);
  assert.equal(ladderRankForProgress(29), 1);
  assert.equal(ladderLeagueForProgress(30), "白银");
  assert.equal(ladderLeagueForProgress(150), "传说");
  assert.equal(isRankFloorProgress(15), true);
  assert.equal(rankFloorForProgress(29), 15);
  for (let progress = 0; progress <= LADDER_LEGEND_PROGRESS; progress += 1) {
    assert.equal(ladderProgressForRating(ladderRatingForProgress(progress)), progress);
    if (progress < LADDER_LEGEND_PROGRESS) {
      assert.ok(ladderRankForProgress(progress) >= 1 && ladderRankForProgress(progress) <= 10);
      assert.ok(ladderStarsForProgress(progress) >= 0 && ladderStarsForProgress(progress) < 3);
    }
  }

  let ladder = createRankedSnapshot("2026-08");
  ladder = updateRankedSnapshot(ladder, "win");
  ladder = updateRankedSnapshot(ladder, "win");
  ladder = updateRankedSnapshot(ladder, "win");
  assert.equal(ladder.winStreak, 3);
  assert.equal(ladder.rankProgress, 4, "第三场连胜应把本场基础星级翻倍");
  assert.equal(ladder.rank, 9);
  assert.equal(ladder.stars, 1);
  ladder = updateRankedSnapshot(ladder, "loss");
  assert.equal(ladder.winStreak, 0);
  assert.equal(ladder.rankProgress, 3);
  assert.equal(ladder.losses, 1);

  const beforeDraw = { ...ladder, winStreak: 2 };
  const afterDraw = updateRankedSnapshot(beforeDraw, "draw");
  assert.deepEqual(afterDraw, beforeDraw, "平局不应改变星级、段位、胜负计数或连胜");
  assert.notEqual(afterDraw, beforeDraw, "结算函数应保持不可变更新语义");
});

test("赛季星级倍率在保护段衰减，失败不能跌穿 10/5 段位", () => {
  const atProgress = (progress: number, starBonus = 1, winStreak = 0) => ({
    ...createRankedSnapshot("2026-08", starBonus),
    rating: ladderRatingForProgress(progress),
    tier: ladderLeagueForProgress(progress),
    rank: ladderRankForProgress(progress),
    stars: ladderStarsForProgress(progress),
    rankProgress: progress,
    seasonBestProgress: progress,
    highestRating: ladderRatingForProgress(progress),
    winStreak,
  });

  assert.equal(starBonusForSeasonPeak(0), 1);
  assert.equal(starBonusForSeasonPeak(75), 6);
  assert.equal(starBonusForSeasonPeak(150), 11);
  const nextSeason = resetRankedSnapshotForSeason(atProgress(75), "2026-09");
  assert.equal(nextSeason.rankProgress, 0);
  assert.equal(nextSeason.rank, 10);
  assert.equal(nextSeason.starBonus, 6);
  assert.equal(nextSeason.seasonBestProgress, 0);

  const protectedLoss = updateRankedSnapshot(atProgress(15), "loss");
  assert.equal(protectedLoss.rankProgress, 15, "青铜 5 的 0 星不能继续掉段");
  for (const floor of LADDER_RANK_FLOORS) {
    assert.equal(updateRankedSnapshot(atProgress(floor), "loss").rankProgress, floor);
  }
  const rollbackToFloor = updateRankedSnapshot(atProgress(16), "loss");
  assert.equal(rollbackToFloor.rankProgress, 15);

  const crossesTwoFloors = updateRankedSnapshot(atProgress(14, 11, 2), "win");
  assert.equal(crossesTwoFloors.rankProgress, 36, "三连胜应将 11 倍星级再翻倍");
  assert.equal(crossesTwoFloors.starBonus, 9, "跨过青铜 5 与白银 10 后倍率各减一");

  const diamondFive = updateRankedSnapshot(atProgress(LADDER_DIAMOND_FIVE_PROGRESS, 2, 2), "win");
  assert.equal(diamondFive.rankProgress, LADDER_DIAMOND_FIVE_PROGRESS + 2, "钻石 5 起不再获得连胜翻倍");
  assert.equal(diamondFive.starBonus, 2);
});

test("旧版可见分数会无损迁移为新星级路径且不会伪造赛季倍率", () => {
  assert.equal(ladderProgressForLegacyRating(1000), 30);
  assert.equal(ladderProgressForLegacyRating(1400), 90);
  assert.equal(ladderProgressForLegacyRating(1800), 150);
  const pristine = normalizeRankedSnapshot({
    seasonKey: "2026-08",
    rating: LADDER_START_RATING,
    wins: 0,
    losses: 0,
  }, "2026-09");
  assert.equal(pristine.rankProgress, 0, "从未打过天梯的旧账号应留在青铜 10");
  const migrated = normalizeRankedSnapshot({
    seasonKey: "2026-08",
    rating: 1400,
    tier: "白金",
    stars: 2,
    wins: 12,
    losses: 8,
    highestRating: 1500,
    winStreak: 4,
  }, "2026-09");
  assert.equal(migrated.seasonKey, "2026-08");
  assert.equal(migrated.rankProgress, 90);
  assert.equal(migrated.tier, "白金");
  assert.equal(migrated.rank, 10);
  assert.equal(migrated.stars, 0);
  assert.equal(migrated.starBonus, 1);
  assert.equal(migrated.seasonBestProgress, 90);
  assert.equal(migrated.highestRating, 1500);
  assert.equal(migrated.winStreak, 4);
});

test("所有段位、倍率与连胜组合都保持天梯状态不变量", () => {
  for (let progress = 0; progress <= LADDER_LEGEND_PROGRESS; progress += 1) {
    for (let starBonus = 1; starBonus <= 11; starBonus += 1) {
      for (let winStreak = 0; winStreak <= 4; winStreak += 1) {
        const snapshot = {
          ...createRankedSnapshot("2026-08", starBonus),
          rating: ladderRatingForProgress(progress),
          tier: ladderLeagueForProgress(progress),
          rank: ladderRankForProgress(progress),
          stars: ladderStarsForProgress(progress),
          rankProgress: progress,
          seasonBestProgress: progress,
          highestRating: ladderRatingForProgress(progress),
          winStreak,
        };
        for (const result of ["win", "loss", "draw"] as const) {
          const next = updateRankedSnapshot(snapshot, result);
          assert.ok(next.rankProgress >= 0 && next.rankProgress <= LADDER_LEGEND_PROGRESS);
          assert.equal(next.rating, ladderRatingForProgress(next.rankProgress));
          assert.equal(next.tier, ladderLeagueForProgress(next.rankProgress));
          assert.equal(next.rank, ladderRankForProgress(next.rankProgress));
          assert.equal(next.stars, ladderStarsForProgress(next.rankProgress));
          assert.ok(next.starBonus >= 1 && next.starBonus <= starBonus);
          assert.ok(next.seasonBestProgress >= next.rankProgress);
          if (result === "loss") {
            assert.equal(next.rankProgress, Math.max(rankFloorForProgress(progress), progress - 1));
          }
        }
      }
    }
  }
});

function rankedRewardEconomy(
  progress = 0,
  overrides: Partial<RankedRewardEconomy> = {},
): RankedRewardEconomy {
  const ladder = {
    ...createRankedSnapshot("2026-08"),
    rating: ladderRatingForProgress(progress),
    tier: ladderLeagueForProgress(progress),
    rank: ladderRankForProgress(progress),
    stars: ladderStarsForProgress(progress),
    rankProgress: progress,
    seasonBestProgress: progress,
    highestRating: ladderRatingForProgress(progress),
  };
  return {
    ladder,
    rankedRewards: createRankedRewardState(),
    collection: {},
    packsAvailable: 0,
    ...overrides,
  };
}

test("赛季宝箱与首次段位奖励精确覆盖炉石的十个里程碑", () => {
  assert.deepEqual(
    RANKED_SEASON_REWARD_LEVELS.map(({ floor, reward }) => [floor, reward]),
    [
      [15, { packs: 0, rareCards: 1, epicCards: 0, legendaryCards: 0 }],
      [30, { packs: 1, rareCards: 0, epicCards: 0, legendaryCards: 0 }],
      [45, { packs: 0, rareCards: 2, epicCards: 0, legendaryCards: 0 }],
      [60, { packs: 1, rareCards: 0, epicCards: 0, legendaryCards: 0 }],
      [75, { packs: 0, rareCards: 2, epicCards: 0, legendaryCards: 0 }],
      [90, { packs: 1, rareCards: 0, epicCards: 0, legendaryCards: 0 }],
      [105, { packs: 0, rareCards: 2, epicCards: 0, legendaryCards: 0 }],
      [120, { packs: 1, rareCards: 0, epicCards: 0, legendaryCards: 0 }],
      [135, { packs: 0, rareCards: 0, epicCards: 1, legendaryCards: 0 }],
      [150, { packs: 1, rareCards: 0, epicCards: 0, legendaryCards: 0 }],
    ],
  );
  assert.deepEqual(
    RANKED_FIRST_TIME_REWARD_LEVELS.map(({ floor, reward }) => [floor, reward]),
    [
      [15, { packs: 1, rareCards: 0, epicCards: 0, legendaryCards: 0 }],
      [30, { packs: 0, rareCards: 4, epicCards: 0, legendaryCards: 0 }],
      [45, { packs: 1, rareCards: 0, epicCards: 0, legendaryCards: 0 }],
      [60, { packs: 0, rareCards: 4, epicCards: 0, legendaryCards: 0 }],
      [75, { packs: 1, rareCards: 0, epicCards: 0, legendaryCards: 0 }],
      [90, { packs: 0, rareCards: 0, epicCards: 1, legendaryCards: 0 }],
      [105, { packs: 1, rareCards: 0, epicCards: 0, legendaryCards: 0 }],
      [120, { packs: 0, rareCards: 0, epicCards: 1, legendaryCards: 0 }],
      [135, { packs: 1, rareCards: 0, epicCards: 0, legendaryCards: 0 }],
      [150, { packs: 0, rareCards: 0, epicCards: 0, legendaryCards: 1 }],
    ],
  );
  assert.deepEqual(rankedSeasonRewardForPeak(0), {
    packs: 0,
    rareCards: 0,
    epicCards: 0,
    legendaryCards: 0,
  });
  assert.deepEqual(rankedSeasonRewardForPeak(75), {
    packs: 2,
    rareCards: 5,
    epicCards: 0,
    legendaryCards: 0,
  });
  assert.deepEqual(rankedSeasonRewardForPeak(150), {
    packs: 5,
    rareCards: 7,
    epicCards: 1,
    legendaryCards: 0,
  });
  assert.deepEqual(rankedFirstTimeRewardForFloor(150), {
    packs: 0,
    rareCards: 0,
    epicCards: 0,
    legendaryCards: 1,
  });
});

test("首次段位奖励会补发真实卡牌与卡包，并且重复刷新不重发", () => {
  const first = applyOutstandingRankedRewards(rankedRewardEconomy(75), CARD_CATALOG);
  assert.deepEqual(first.grantedFirstTimeFloors, [15, 30, 45, 60, 75]);
  assert.deepEqual(first.rankedRewards.claimedFirstTimeFloors, [15, 30, 45, 60, 75]);
  assert.equal(first.grantedPacks, 3);
  assert.equal(first.packsAvailable, 3);
  assert.equal(first.grantedCards.reduce((sum, card) => sum + card.count, 0), 8);
  assert.ok(first.grantedCards.every((card) => card.rarity === "稀有"));
  assert.equal(Object.values(first.collection).reduce((sum, count) => sum + count, 0), 8);

  const replay = applyOutstandingRankedRewards(first, CARD_CATALOG);
  assert.deepEqual(replay.grantedFirstTimeFloors, []);
  assert.equal(replay.grantedPacks, 0);
  assert.deepEqual(replay.grantedCards, []);
  assert.equal(replay.packsAvailable, first.packsAvailable);
  assert.deepEqual(replay.collection, first.collection);
});

test("第五场天梯胜利即时解锁当季卡背且之后保持幂等", () => {
  const economy = rankedRewardEconomy(0);
  economy.ladder = { ...economy.ladder, wins: 4 };
  const fifthWin = applyRankedMatchResult(economy, CARD_CATALOG, "win");
  assert.equal(fifthWin.ladder.wins, 5);
  assert.equal(fifthWin.cardBackUnlocked, true);
  assert.deepEqual(fifthWin.rankedRewards.earnedCardBackSeasons, ["2026-08"]);

  const sixthWin = applyRankedMatchResult(fifthWin, CARD_CATALOG, "win");
  assert.equal(sixthWin.ladder.wins, 6);
  assert.equal(sixthWin.cardBackUnlocked, false);
  assert.deepEqual(sixthWin.rankedRewards.earnedCardBackSeasons, ["2026-08"]);
});

test("月度换季只发一次累计宝箱，并按最高段位重置星级倍率", () => {
  const claimedThroughDiamondFive = RANKED_FIRST_TIME_REWARD_LEVELS
    .filter(({ floor }) => floor <= 135)
    .map(({ floor }) => floor);
  const economy = rankedRewardEconomy(135, {
    packsAvailable: 7,
    rankedRewards: {
      claimedFirstTimeFloors: claimedThroughDiamondFive,
      earnedCardBackSeasons: ["2026-08"],
      seasonChests: [],
    },
  });
  const rollover = rollRankedSeason(
    economy,
    CARD_CATALOG,
    "2026-09",
    "2026-09-01T00:00:00.000Z",
  );
  assert.equal(rollover.seasonChest?.seasonKey, "2026-08");
  assert.deepEqual(
    rollover.seasonChest && {
      packs: rollover.seasonChest.packs,
      rareCards: rollover.seasonChest.rareCards,
      epicCards: rollover.seasonChest.epicCards,
      legendaryCards: rollover.seasonChest.legendaryCards,
    },
    { packs: 4, rareCards: 7, epicCards: 1, legendaryCards: 0 },
  );
  assert.equal(rollover.grantedPacks, 4);
  assert.equal(rollover.packsAvailable, 11);
  assert.equal(rollover.grantedCards.reduce((sum, card) => sum + card.count, 0), 8);
  assert.equal(rollover.rankedRewards.seasonChests.length, 1);
  assert.equal(rollover.ladder.seasonKey, "2026-09");
  assert.equal(rollover.ladder.rankProgress, 0);
  assert.equal(rollover.ladder.rank, 10);
  assert.equal(rollover.ladder.starBonus, starBonusForSeasonPeak(135));

  const repeated = rollRankedSeason(
    rollover,
    CARD_CATALOG,
    "2026-09",
    "2026-09-01T00:00:01.000Z",
  );
  assert.equal(repeated.seasonChest, null);
  assert.equal(repeated.grantedPacks, 0);
  assert.deepEqual(repeated.grantedCards, []);
  assert.equal(repeated.packsAvailable, rollover.packsAvailable);
  assert.equal(repeated.rankedRewards.seasonChests.length, 1);
});

test("排名奖励状态会清洗非法月份、重复保护段和重复赛季宝箱", () => {
  const normalized = normalizeRankedRewardState({
    claimedFirstTimeFloors: [30, 15, 15, 16, -1, "30"],
    earnedCardBackSeasons: ["2026-08", "2026-08", "2026-13", "bad"],
    seasonChests: [
      {
        seasonKey: "2026-08",
        peakProgress: 60,
        peakLabel: "伪造标签",
        awardedAt: "not-a-date",
        packs: 2,
        rareCards: 3,
        epicCards: 0,
        legendaryCards: 0,
      },
      {
        seasonKey: "2026-08",
        peakProgress: 75,
        awardedAt: "2026-09-01T00:00:00.000Z",
        packs: 3,
        rareCards: 4,
        epicCards: 0,
        legendaryCards: 0,
      },
      { seasonKey: "2026-00", peakProgress: 150 },
    ],
  });
  assert.deepEqual(normalized.claimedFirstTimeFloors, [15, 30]);
  assert.deepEqual(normalized.earnedCardBackSeasons, ["2026-08"]);
  assert.equal(normalized.seasonChests.length, 1);
  assert.equal(normalized.seasonChests[0]?.peakProgress, 75);
  assert.equal(normalized.seasonChests[0]?.peakLabel, "黄金 5");
  assert.equal(normalized.seasonChests[0]?.packs, 3);

  const left = applyOutstandingRankedRewards(rankedRewardEconomy(60), CARD_CATALOG);
  const right = applyOutstandingRankedRewards(rankedRewardEconomy(60), CARD_CATALOG);
  assert.deepEqual(left.grantedCards, right.grantedCards, "同一奖励里程碑必须产生可重放的确定性卡牌");
});

test("隐藏 MMR 与可见段位解耦，并按对手强弱与样本量调整", () => {
  assert.equal(initialHiddenMmrForVisibleRating(1000), 1500);
  assert.equal(initialHiddenMmrForVisibleRating(1200), 1610);
  assert.equal(hiddenMmrExpectedScore(1500, 1500), 0.5);

  const upsetWin = updateHiddenMmr({ rating: 1500, games: 4 }, 1800, "win");
  const expectedWin = updateHiddenMmr({ rating: 1500, games: 4 }, 1500, "win");
  const veteranWin = updateHiddenMmr({ rating: 1500, games: 80 }, 1500, "win");
  assert.ok(upsetWin.rating > expectedWin.rating);
  assert.ok(expectedWin.rating - 1500 > veteranWin.rating - 1500);
  assert.deepEqual(updateHiddenMmr({ rating: 1500, games: 0 }, 1500, "draw"), { rating: 1500, games: 1 });
  const [winner, loser] = updateHiddenMmrPair(
    { rating: 1500, games: 0 },
    { rating: 1500, games: 0 },
    0,
  );
  assert.deepEqual(winner, { rating: 1524, games: 1 });
  assert.deepEqual(loser, { rating: 1476, games: 1 });
});

test("隐藏 MMR 搜索窗随等待扩张且只暴露粗粒度匹配质量", () => {
  assert.equal(matchmakingSearchWindow(0), 120);
  assert.equal(matchmakingSearchWindow(29_999), 280);
  assert.equal(matchmakingSearchWindow(10 * 60_000), 720);
  assert.equal(matchQualityForGap(40), "ideal");
  assert.equal(matchQualityForGap(160), "close");
  assert.equal(matchQualityForGap(360), "expanded");
});

test("牌组校验报告尺寸、未知卡、超量和混合阵营错误", () => {
  const invalid = [...DEFAULT_STARTER_DECK];
  invalid[0] = "void-mist-lurker";
  invalid[1] = "missing-card";
  invalid[2] = "neutral-thunder-egg";
  invalid[3] = "neutral-thunder-egg";

  const result = validateDeck(invalid.slice(0, 29));
  const codes = new Set(result.errors.map((error) => error.code));
  assert.equal(result.valid, false);
  assert.ok(codes.has("wrong-size"));
  assert.ok(codes.has("unknown-card"));
  assert.ok(codes.has("too-many-copies"));
  assert.ok(codes.has("mixed-factions"));
});

test("相同 seed 创建完全相同的对局，不同 seed 改变洗牌结果", () => {
  const first = createMatch({ seed: 20260727 });
  const second = createMatch({ seed: 20260727 });
  const different = createMatch({ seed: 20260728 });

  assert.deepEqual(first, second);
  assert.notDeepEqual(
    first.players.map((player) => [...player.deck, ...player.hand]),
    different.players.map((player) => [...player.deck, ...player.hand]),
  );
});

test("牌组提交顺序不影响洗牌，镜像牌组使用独立随机流", () => {
  const seed = 20260819;
  const canonical = createMatch({
    seed,
    decks: [DEFAULT_STARTER_DECK, DEFAULT_OPPONENT_DECK],
  });
  const reordered = createMatch({
    seed,
    decks: [
      [...DEFAULT_STARTER_DECK].reverse(),
      [...DEFAULT_OPPONENT_DECK].reverse(),
    ],
  });
  assert.deepEqual(reordered, canonical);

  const mirrored = createMatch({
    seed,
    decks: [DEFAULT_STARTER_DECK, DEFAULT_STARTER_DECK],
  });
  const fullOrder = (player: PlayerId) => [
    ...mirrored.players[player].hand,
    ...mirrored.players[player].deck,
  ];
  assert.notDeepEqual(fullOrder(0), fullOrder(1));
});

test("对局先进入起手换牌，双方可独立确认并在完成后开启第一回合", () => {
  const opening = createMatch({ seed: 20260811 });
  assert.equal(opening.phase, "mulligan");
  assert.deepEqual(opening.mulliganDone, [false, false]);
  assert.equal(opening.players[0].hand.length, 3);
  assert.equal(opening.players[1].hand.length, 4);
  assert.equal(opening.players[0].mana, 0);
  assert.equal(opening.players[1].mana, 0);

  const first = applyCommand(opening, {
    type: "mulligan",
    player: 0,
    cardIndexes: [0, 2],
  });
  assert.equal(first.accepted, true);
  assert.equal(first.state.phase, "mulligan");
  assert.deepEqual(first.state.mulliganDone, [true, false]);
  assert.equal(first.state.players[0].hand.length, 3);
  assert.equal(first.state.players[1].hand.length, 4);

  const duplicate = applyCommand(first.state, {
    type: "mulligan",
    player: 0,
    cardIndexes: [0],
  });
  assert.equal(duplicate.accepted, false);
  assert.equal(duplicate.error?.code, "mulligan-closed");

  const invalid = applyCommand(first.state, {
    type: "mulligan",
    player: 1,
    cardIndexes: [0, 0],
  });
  assert.equal(invalid.accepted, false);
  assert.equal(invalid.error?.code, "invalid-mulligan");

  const completed = applyCommand(first.state, {
    type: "mulligan",
    player: 1,
    cardIndexes: [],
  });
  assert.equal(completed.accepted, true);
  assert.equal(completed.state.phase, "main");
  assert.deepEqual(completed.state.mulliganDone, [true, true]);
  assert.equal(completed.state.activePlayer, 0);
  assert.equal(completed.state.players[0].mana, 1);
  assert.equal(completed.state.players[1].mana, 0);
  assert.equal(completed.state.players[0].hand.length, 4);
  assert.equal(completed.state.players[1].hand.length, 4);
  assert.equal(completed.state.players[1].coinAvailable, true);

  const secondTurn = applyCommand(completed.state, {
    type: "end-turn",
    player: 0,
  });
  assert.equal(secondTurn.accepted, true);
  const coin = applyCommand(secondTurn.state, {
    type: "use-coin",
    player: 1,
  });
  assert.equal(coin.accepted, true);
  assert.equal(coin.state.players[1].coinAvailable, false);
  assert.equal(coin.state.players[1].mana, 2);
});

test("后手身份切换时额外起手牌仍分配给真正的后手", () => {
  const opening = createMatch({ seed: 20260812, startingPlayer: 1 });
  assert.equal(opening.activePlayer, 1);
  assert.equal(opening.players[0].hand.length, 4);
  assert.equal(opening.players[1].hand.length, 3);

  const first = applyCommand(opening, {
    type: "mulligan",
    player: 0,
    cardIndexes: [],
  });
  const completed = applyCommand(first.state, {
    type: "mulligan",
    player: 1,
    cardIndexes: [],
  });
  assert.equal(completed.accepted, true);
  assert.equal(completed.state.players[0].hand.length, 4);
  assert.equal(completed.state.players[1].hand.length, 4);
  assert.equal(completed.state.players[0].coinAvailable, true);
  assert.equal(completed.state.players[1].coinAvailable, false);
});

test("AI 起手换牌会保留低费曲线并替换重复高费牌", () => {
  const state = createMatch({ seed: 20260813 });
  state.players[1].hand = [
    "void-abyss-whale",
    "void-mist-lurker",
    "void-chill-needle",
    "void-abyss-whale",
  ];

  assert.deepEqual(chooseAiMulliganIndexes(state, 1), [0, 3]);
});

test("起手换牌期间不会执行普通行动，双方状态可由 commandId 幂等恢复", () => {
  const opening = createMatch({ seed: 20260812 });
  const before = structuredClone(opening);
  const rejected = applyCommand(opening, {
    type: "end-turn",
    player: 0,
    commandId: "too-early",
  });
  assert.equal(rejected.accepted, false);
  assert.equal(rejected.error?.code, "mulligan-closed");
  assert.deepEqual(opening, before);

  const confirmed = applyCommand(opening, {
    type: "mulligan",
    player: 0,
    cardIndexes: [],
    commandId: "opening-0",
  });
  assert.equal(confirmed.accepted, true);
  const duplicate = applyCommand(confirmed.state, {
    type: "mulligan",
    player: 0,
    cardIndexes: [0],
    commandId: "opening-0",
  });
  assert.equal(duplicate.accepted, true);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.state.version, confirmed.state.version);
});

test("commandId 按玩家隔离，不能复用对手编号制造成功空操作", () => {
  const state = editableMatch();
  const first = applyCommand(state, {
    type: "end-turn",
    player: 0,
    commandId: "shared-command-id",
  });
  assert.equal(first.accepted, true);

  const second = applyCommand(first.state, {
    type: "end-turn",
    player: 1,
    commandId: "shared-command-id",
  });
  assert.equal(second.accepted, true);
  assert.equal(second.duplicate, undefined);
  assert.equal(second.state.version, first.state.version + 1);
});

test("同一副牌在 PVP 双端交换本地视角后仍保持相同顺序", () => {
  const seed = 20260810;
  const hostView = createMatch({
    seed,
    decks: [DEFAULT_STARTER_DECK, DEFAULT_OPPONENT_DECK],
    startingPlayer: 0,
  });
  const guestView = createMatch({
    seed,
    decks: [DEFAULT_OPPONENT_DECK, DEFAULT_STARTER_DECK],
    startingPlayer: 1,
  });

  const cards = (state: MatchState, player: PlayerId) => [
    ...state.players[player].hand,
    ...state.players[player].deck,
  ];
  assert.deepEqual(cards(hostView, 0), cards(guestView, 1));
  assert.deepEqual(cards(hostView, 1), cards(guestView, 0));
  assert.equal(hostView.rngState, guestView.rngState);
});

test("结构化战斗事件会映射为可播放的声光效果", () => {
  const events: BattleEvent[] = [
    {
      seq: 21,
      type: "unit-summoned",
      turn: 2,
      player: 0,
      message: "晨辉斥候进入战场。",
      data: { cardId: "sun-dawn-scout", entityId: "u4" },
    },
    {
      seq: 22,
      type: "attack",
      turn: 3,
      player: 0,
      message: "晨辉斥候发起攻击。",
      data: {
        attackerId: "u4",
        target: { kind: "hero", player: 1 },
      },
    },
    {
      seq: 23,
      type: "damage",
      turn: 3,
      player: 0,
      message: "玩家 1 的英雄受到 2 点伤害。",
      data: {
        amount: 2,
        target: { kind: "hero", player: 1 },
        health: 28,
      },
    },
    {
      seq: 24,
      type: "turn-started",
      turn: 4,
      player: 1,
      message: "玩家 1 的回合开始。",
      data: { mana: 2 },
    },
    {
      seq: 25,
      type: "match-ended",
      turn: 5,
      player: 0,
      message: "玩家 0 获胜。",
      data: { winner: 0, reason: "hero-defeated" },
    },
    {
      seq: 26,
      type: "turn-triggered",
      turn: 5,
      player: 0,
      message: "遗迹冠鹿触发回合结束效果。",
      data: { entityId: "u4", timing: "end" },
    },
    {
      seq: 27,
      type: "temporary-expired",
      turn: 5,
      player: 0,
      message: "临时增益结束。",
      data: { entityId: "u4", attack: 2, health: 1 },
    },
  ];

  const effects = battleEventsToEffects(events);

  assert.deepEqual(
    effects.map((effect) => effect.kind),
    ["summon", "attack", "damage", "turn", "win", "buff", "destroy"],
  );
  assert.deepEqual(effects[1], {
    id: "event-22",
    kind: "attack",
    side: "player",
    sourceId: "u4",
    targetKind: "hero",
    targetSide: "ai",
    label: "突击",
  });
  assert.equal(effects[2]?.amount, 2);
  assert.equal(effects[3]?.label, "敌方回合");
  assert.equal(effects[4]?.label, "演算胜利");
});

test("手牌爆牌会映射为独立的燃毁反馈", () => {
  const effects = battleEventsToEffects([
    {
      seq: 1,
      type: "card-burned",
      turn: 3,
      player: 0,
      message: "手牌已满，一张牌被销毁。",
      data: { cardId: "sun-focused-ray" },
    },
  ]);
  assert.deepEqual(effects[0], {
    id: "event-1",
    kind: "destroy",
    side: "player",
    cardId: "sun-focused-ray",
    label: "手牌燃毁",
  });
});

test("幸运币事件映射为资源反馈，而不是误显示为抽牌", () => {
  const effects = battleEventsToEffects([
    {
      seq: 1,
      type: "hero-power",
      turn: 3,
      player: 0,
      message: "玩家 0 使用幸运币，获得 1 点临时法力。",
      data: { coin: true, bonusMana: 1, cost: 0 },
    },
  ]);
  assert.equal(effects[0]?.kind, "card");
  assert.equal(effects[0]?.label, "幸运币");
  assert.equal(effects[0]?.amount, 1);
});

test("单位伤害与治疗效果保留真实目标阵营", () => {
  const effects = battleEventsToEffects([
    {
      seq: 1,
      type: "damage",
      turn: 2,
      player: 0,
      message: "敌方单位受到 3 点伤害。",
      data: { amount: 3, entityId: "enemy-unit", targetPlayer: 1, health: 2 },
    },
    {
      seq: 2,
      type: "healing",
      turn: 2,
      player: 1,
      message: "我方单位恢复 2 点生命。",
      data: { amount: 2, entityId: "player-unit", targetPlayer: 0, health: 4 },
    },
  ]);

  assert.equal(effects[0]?.targetSide, "ai");
  assert.equal(effects[0]?.targetId, "enemy-unit");
  assert.equal(effects[1]?.targetSide, "player");
  assert.equal(effects[1]?.targetId, "player-unit");
});

test("奥秘触发只显示反制标签，真实伤害事件承载数值动画", () => {
  const effects = battleEventsToEffects([
    {
      seq: 1,
      type: "secret-triggered",
      turn: 2,
      player: 1,
      message: "玩家 1 的奥秘被触发。",
      data: {
        cardId: "dusk-mirror-snare",
        secretEffect: { kind: "damage-attacker", amount: 3 },
        triggeringPlayer: 0,
        attackerPlayer: 0,
      },
    },
    {
      seq: 2,
      type: "damage",
      turn: 2,
      player: 1,
      message: "玩家 0 的英雄受到 3 点伤害。",
      data: {
        amount: 3,
        target: { kind: "hero", player: 0 },
        health: 27,
      },
    },
  ]);

  assert.deepEqual(effects[0], {
    id: "event-1",
    kind: "card",
    side: "ai",
    cardId: "dusk-mirror-snare",
    targetKind: "hero",
    targetSide: "player",
    label: "奥秘反制",
  });
  assert.equal(effects[1]?.kind, "damage");
  assert.equal(effects[1]?.amount, 3);
  assert.equal(effects.filter((effect) => effect.kind === "damage").length, 1);
});

test("单位攻击者与被反制法术的视觉目标属于触发者阵营", () => {
  const effects = battleEventsToEffects([
    {
      seq: 1,
      type: "secret-triggered",
      turn: 2,
      player: 1,
      message: "玩家 1 的奥秘被触发。",
      data: {
        cardId: "dusk-mirror-snare",
        secretEffect: { kind: "damage-attacker", amount: 3 },
        triggeringPlayer: 0,
        attackerId: "player-attacker",
        attackerPlayer: 0,
      },
    },
    {
      seq: 2,
      type: "spell-countered",
      turn: 2,
      player: 1,
      message: "玩家 0 的法术被反制。",
      data: {
        cardId: "sun-focused-ray",
        triggeringPlayer: 0,
      },
    },
  ]);

  assert.equal(effects[0]?.targetId, "player-attacker");
  assert.equal(effects[0]?.targetSide, "player");
  assert.equal(effects[1]?.targetSide, "player");
});

test("英雄技能聚合事件只显示技能标签，数值交给真实效果事件", () => {
  const effects = battleEventsToEffects([
    {
      seq: 1,
      type: "hero-power",
      turn: 2,
      player: 0,
      message: "玩家 0 使用核心技能。",
      data: {
        heroPowerName: "熔火脉冲",
        heroPowerEffect: { kind: "damage-enemy-hero", amount: 1 },
      },
    },
    {
      seq: 2,
      type: "damage",
      turn: 2,
      player: 0,
      message: "玩家 1 的英雄受到 1 点伤害。",
      data: {
        amount: 1,
        target: { kind: "hero", player: 1 },
        health: 29,
      },
    },
  ]);

  assert.equal(effects[0]?.kind, "card");
  assert.equal(effects[0]?.label, "熔火脉冲");
  assert.equal(effects[0]?.amount, undefined);
  assert.equal(effects.filter((effect) => effect.kind === "damage").length, 1);
  assert.equal(effects[1]?.amount, 1);
});

test("抽牌保持抽牌反馈，平局使用中性反馈而不是双方失败", () => {
  const events: BattleEvent[] = [
    {
      seq: 1,
      type: "card-drawn",
      turn: 2,
      player: 0,
      message: "玩家 0 抽取一张牌。",
      data: { cardId: "sun-focused-ray" },
    },
    {
      seq: 2,
      type: "match-ended",
      turn: 90,
      message: "对局以平局结束。",
      data: { winner: null, reason: "draw" },
    },
  ];

  for (const viewer of [0, 1] as const) {
    const viewerEffects = battleEventsToEffects(events, viewer);
    assert.equal(viewerEffects.some((effect) => effect.kind === "loss"), false);
    const result = viewerEffects.at(-1);
    assert.equal(result?.kind, "draw");
    assert.equal(result?.targetSide, undefined);
    assert.equal(result?.label, "演算平局");
  }

  const ownerEffects = battleEventsToEffects(events, 0);
  assert.equal(ownerEffects[0]?.kind, "draw");
  assert.equal(ownerEffects[0]?.label, "抽取战术卡");
});

test("零点伤害或治疗不会占用战斗回放节拍", () => {
  const effects = battleEventsToEffects([
    {
      seq: 1,
      type: "healing",
      turn: 2,
      player: 1,
      message: "目标恢复 0 点生命。",
      data: { amount: 0, target: { kind: "hero", player: 1 }, health: 30 },
    },
    {
      seq: 2,
      type: "damage",
      turn: 2,
      player: 0,
      message: "目标受到 0 点伤害。",
      data: { amount: 0, target: { kind: "hero", player: 1 }, health: 30 },
    },
  ]);
  assert.deepEqual(effects, []);
});

test("护甲吸收会转成独立的护盾回放效果，即使生命伤害为零", () => {
  const effects = battleEventsToEffects([
    {
      seq: 1,
      type: "damage",
      turn: 2,
      player: 0,
      message: "敌方核心受到 0 点伤害。",
      data: {
        amount: 0,
        requestedAmount: 2,
        armorAbsorbed: 2,
        target: { kind: "hero", player: 1 },
        health: 30,
        armor: 0,
      },
    },
  ]);
  assert.deepEqual(effects.map((effect) => effect.kind), ["shield"]);
  assert.equal(effects[0]?.amount, 2);
  assert.equal(effects[0]?.label, "护甲吸收");
  assert.equal(effects[0]?.targetSide, "ai");
});

test("非法出牌会被拒绝且不改变输入状态", () => {
  const state = editableMatch();
  state.players[0].hand = ["sun-focused-ray"];
  state.players[0].mana = 0;
  const before = structuredClone(state);

  const noMana = applyCommand(state, {
    type: "play-card",
    player: 0,
    cardId: "sun-focused-ray",
    target: { kind: "hero", player: 1 },
  });
  assert.equal(noMana.accepted, false);
  assert.equal(noMana.error?.code, "not-enough-mana");
  assert.equal(noMana.state, state);
  assert.deepEqual(state, before);

  state.players[0].mana = 1;
  const noTarget = applyCommand(state, {
    type: "play-card",
    player: 0,
    cardId: "sun-focused-ray",
  });
  assert.equal(noTarget.accepted, false);
  assert.equal(noTarget.error?.code, "target-required");
});

test("没有合法单位目标时，定向法术不能被空放", () => {
  const state = editableMatch();
  state.players[0].hand = ["astral-phase-shift"];
  state.players[0].mana = 4;

  const result = applyCommand(state, {
    type: "play-card",
    player: 0,
    cardId: "astral-phase-shift",
  });

  assert.equal(result.accepted, false);
  assert.equal(result.error?.code, "invalid-target");
  assert.equal(result.state.players[0].mana, 4);
  assert.deepEqual(result.state.players[0].hand, ["astral-phase-shift"]);
});

test("满场时纯召唤法术不可使用且不会消耗手牌或法力", () => {
  const state = editableMatch();
  state.players[0].hand = ["verdant-seedburst"];
  state.players[0].mana = 3;
  state.players[0].board = Array.from({ length: MAX_BOARD_SIZE }, (_, index) =>
    unit(`full-board-${index}`, "neutral-moss-runner", 0));

  const result = applyCommand(state, {
    type: "play-card",
    player: 0,
    cardId: "verdant-seedburst",
  });

  assert.equal(result.accepted, false);
  assert.equal(result.error?.code, "board-full");
  assert.equal(result.state.players[0].mana, 3);
  assert.deepEqual(result.state.players[0].hand, ["verdant-seedburst"]);
  assert.equal(result.state.players[0].board.length, MAX_BOARD_SIZE);
});

test("满场时召唤型英雄技能不可使用", () => {
  const state = editableMatch();
  state.players[0].heroPower = getHeroPower("苍林");
  state.players[0].mana = HERO_POWER_COST;
  state.players[0].board = Array.from({ length: MAX_BOARD_SIZE }, (_, index) =>
    unit(`hero-power-full-${index}`, "neutral-moss-runner", 0));

  const result = applyCommand(state, { type: "hero-power", player: 0 });

  assert.equal(result.accepted, false);
  assert.equal(result.error?.code, "board-full");
  assert.equal(result.state.players[0].mana, HERO_POWER_COST);
  assert.equal(result.state.players[0].heroPowerUsed, false);
});

test("幸运币作为真实手牌占用第十个手牌位", () => {
  const state = editableMatch();
  state.players[0].heroPower = getHeroPower("星穹");
  state.players[0].mana = HERO_POWER_COST;
  state.players[0].coinAvailable = true;
  state.players[0].hand = Array.from({ length: MAX_HAND_SIZE - 1 }, () => "neutral-moss-runner");
  state.players[0].deck = ["sun-focused-ray"];

  const result = applyCommand(state, { type: "hero-power", player: 0 });

  assert.equal(result.accepted, true);
  assert.equal(result.state.players[0].hand.length, MAX_HAND_SIZE - 1);
  assert.equal(result.state.players[0].deck.length, 0);
  assert.ok(result.state.events.some(
    (event) => event.type === "card-burned" && event.data?.cardId === "sun-focused-ray",
  ));
});

test("法术伤害、版本检查与 commandId 幂等均通过 reducer", () => {
  const state = editableMatch();
  state.players[0].hand = ["sun-focused-ray"];
  state.players[0].mana = 1;

  const played = applyCommand(state, {
    type: "play-card",
    player: 0,
    cardId: "sun-focused-ray",
    target: { kind: "hero", player: 1 },
    expectedVersion: state.version,
    commandId: "spell-1",
  });
  assert.equal(played.accepted, true);
  assert.equal(played.state.players[1].hero.health, 28);
  assert.equal(state.players[1].hero.health, 30);
  assert.equal(played.state.version, state.version + 1);

  const duplicate = applyCommand(played.state, {
    type: "play-card",
    player: 0,
    cardId: "sun-focused-ray",
    target: { kind: "hero", player: 1 },
    commandId: "spell-1",
  });
  assert.equal(duplicate.accepted, true);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.state, played.state);

  const stale = applyCommand(played.state, {
    type: "end-turn",
    player: 0,
    expectedVersion: 0,
  });
  assert.equal(stale.accepted, false);
  assert.equal(stale.error?.code, "version-conflict");
});

test("潜行单位不能被敌方角色型定向战术直接选中", () => {
  const state = editableMatch();
  state.players[0].hand = ["sun-focused-ray"];
  state.players[0].mana = 1;
  state.players[1].board = [unit("hidden-target", "astral-eclipse-stalker", 1, {
    summonedTurn: 1,
    stealthActive: true,
    keywords: ["stealth"],
  })];

  const result = applyCommand(state, {
    type: "play-card",
    player: 0,
    cardId: "sun-focused-ray",
    target: { kind: "unit", entityId: "hidden-target" },
  });
  assert.equal(result.accepted, false);
  assert.equal(result.error?.code, "invalid-target");
  assert.equal(result.state.players[0].mana, 1);
  assert.equal(result.state.players[0].hand[0], "sun-focused-ray");
});

test("激昂会在战斗伤害后触发", () => {
  const state = editableMatch();
  state.turn = 4;
  state.players[0].board = [unit("combat-attacker", "sun-dawn-scout", 0, {
    summonedTurn: 1,
    summoningSick: false,
  })];
  state.players[1].board = [unit("fury-target", "sun-banner-bearer", 1, {
    summonedTurn: 1,
    health: 3,
    maxHealth: 3,
  })];

  const result = applyCommand(state, {
    type: "attack",
    player: 0,
    attackerId: "combat-attacker",
    target: { kind: "unit", entityId: "fury-target" },
  });
  assert.equal(result.accepted, true);
  assert.equal(result.state.players[1].board[0]?.health, 1);
  assert.equal(result.state.players[1].board[0]?.attack, 4);
  assert.equal(result.state.players[1].board[0]?.furyStacks, 1);
  assert.ok(result.state.events.some((event) => event.type === "unit-buffed" && event.data?.entityId === "fury-target"));
});

test("英雄护甲会在伤害事件中保留吸收量，便于战斗反馈显示真实结果", () => {
  const state = editableMatch();
  state.players[0].hand = ["sun-focused-ray"];
  state.players[0].mana = 1;
  state.players[1].hero.armor = 2;

  const result = applyCommand(state, {
    type: "play-card",
    player: 0,
    cardId: "sun-focused-ray",
    target: { kind: "hero", player: 1 },
  });
  const damage = result.state.events.find((event) => event.type === "damage");
  assert.equal(result.accepted, true);
  assert.equal(damage?.data?.amount, 0);
  assert.equal(damage?.data?.requestedAmount, 2);
  assert.equal(damage?.data?.armorAbsorbed, 2);
  assert.equal(damage?.data?.armor, 0);
});

test("治疗法术可以指定满血角色，但不会产生治疗事件", () => {
  const state = editableMatch();
  state.players[0].hand = ["sun-dew-blessing"];
  state.players[0].mana = 2;
  const result = applyCommand(state, {
    type: "play-card",
    player: 0,
    cardId: "sun-dew-blessing",
    target: { kind: "hero", player: 0 },
  });

  assert.equal(result.accepted, true);
  assert.equal(result.state.players[0].mana, 0);
  assert.deepEqual(result.state.players[0].hand, []);
  assert.equal(result.state.players[0].hero.health, 30);
  assert.equal(result.state.events.some((event) => event.type === "healing"), false);
});

test("没有受伤角色时，治疗型登场战吼仍可指定满血目标部署", () => {
  const state = editableMatch();
  state.players[0].hand = ["sun-choir-acolyte"];
  state.players[0].mana = 2;
  const result = applyCommand(state, {
    type: "play-card",
    player: 0,
    cardId: "sun-choir-acolyte",
    target: { kind: "hero", player: 0 },
  });

  assert.equal(result.accepted, true);
  assert.equal(result.state.players[0].board.at(-1)?.cardId, "sun-choir-acolyte");
  assert.equal(result.state.events.some((event) => event.type === "healing"), false);
});

test("秘契会强化数值战术，抽牌等非数值效果不受影响", () => {
  const state = editableMatch();
  state.players[0].board = [
    unit("arcane-a", "sun-banner-bearer", 0),
    unit("arcane-b", "sun-lion-guard", 0),
  ];
  state.players[0].hand = ["sun-focused-ray"];
  state.players[0].mana = 1;

  const result = applyCommand(state, {
    type: "play-card",
    player: 0,
    cardId: "sun-focused-ray",
    target: { kind: "hero", player: 1 },
  });
  assert.equal(result.accepted, true);
  assert.equal(result.state.players[1].hero.health, 27);
});

test("同名单位全费合并为二星，保留受伤与攻击状态并再次触发登场效果", () => {
  const state = editableMatch();
  state.turn = 5;
  state.nextEntityId = 42;
  state.players[0].board = [
    unit("upgrade-target", "sun-banner-bearer", 0, {
      health: 2,
      hasAttacked: true,
      summonedTurn: 2,
    }),
  ];
  state.players[0].hand = ["sun-banner-bearer"];
  state.players[0].mana = 3;
  const deckCount = state.players[0].deck.length;

  const result = applyCommand(state, {
    type: "play-card",
    player: 0,
    cardId: "sun-banner-bearer",
  });
  assert.equal(result.accepted, true);
  assert.equal(result.state.players[0].board.length, 1);
  assert.equal(result.state.nextEntityId, 42);
  assert.deepEqual(
    result.state.players[0].board[0],
    unit("upgrade-target", "sun-banner-bearer", 0, {
      attack: 5,
      health: 4,
      maxHealth: 5,
      baseAttack: 5,
      baseHealth: 5,
      stars: 2,
      furyStacks: 0,
      hasAttacked: true,
      summonedTurn: 2,
    }),
  );
  assert.equal(result.state.players[0].deck.length, deckCount - 1);
  assert.ok(
    result.state.events.some(
      (event) => event.type === "unit-buffed" && event.data?.upgrade === true,
    ),
  );
});

test("满场仍可进行同名升阶，其他单位继续受到战场上限约束", () => {
  const state = editableMatch();
  state.players[0].board = [
    unit("merge", "sun-dawn-scout", 0),
    unit("slot-2", "sun-mirror-warden", 0),
    unit("slot-3", "sun-banner-bearer", 0),
    unit("slot-4", "sun-lion-guard", 0),
    unit("slot-5", "neutral-moss-runner", 0),
    unit("slot-6", "neutral-wandering-alchemist", 0),
    unit("slot-7", "neutral-caravan-guard", 0),
  ];
  state.players[0].hand = ["sun-dawn-scout", "neutral-clockwork-beetle"];
  state.players[0].mana = 3;

  const upgraded = applyCommand(state, {
    type: "play-card",
    player: 0,
    cardId: "sun-dawn-scout",
  });
  assert.equal(upgraded.accepted, true);
  assert.equal(upgraded.state.players[0].board.length, 7);
  assert.equal(upgraded.state.players[0].board[0].stars, 2);

  const blocked = applyCommand(upgraded.state, {
    type: "play-card",
    player: 0,
    cardId: "neutral-clockwork-beetle",
  });
  assert.equal(blocked.accepted, false);
  assert.equal(blocked.error?.code, "board-full");
});

test("战吼可以影响整条友方战线并留下逐单位战斗事件", () => {
  const state = editableMatch();
  state.players[0].board = [
    unit("frontline-a", "neutral-moss-runner", 0),
    unit("frontline-b", "sun-mirror-warden", 0),
  ];
  state.players[0].hand = ["neutral-mobile-forge"];
  state.players[0].mana = 6;

  const result = applyCommand(state, {
    type: "play-card",
    player: 0,
    cardId: "neutral-mobile-forge",
  });
  assert.equal(result.accepted, true);
  assert.deepEqual(
    result.state.players[0].board.map((entry) => [entry.name, entry.attack, entry.maxHealth]),
    [
      ["苔径奔行兽", 2, 3],
      ["镜盾守望者", 3, 4],
      ["自走熔铸炉", 6, 9],
    ],
  );
  assert.equal(
    result.state.events.filter((event) => event.type === "unit-buffed").length,
    3,
  );
});

test("没有合法目标时，定向战吼仍可让单位下场但不结算战吼", () => {
  const state = editableMatch();
  state.players[0].hand = ["verdant-bloom-banner"];
  state.players[0].mana = 3;

  const result = applyCommand(state, {
    type: "play-card",
    player: 0,
    cardId: "verdant-bloom-banner",
  });

  assert.equal(result.accepted, true);
  assert.equal(result.state.players[0].board.length, 1);
  assert.equal(
    result.state.events.some((event) => event.type === "unit-buffed"),
    false,
  );
});

test("有合法目标时，定向战吼必须先完成目标选择", () => {
  const state = editableMatch();
  state.players[0].hand = ["neutral-wandering-alchemist"];
  state.players[0].mana = 3;
  state.players[0].hero.health = 29;
  const before = structuredClone(state);

  const missingTarget = applyCommand(state, {
    type: "play-card",
    player: 0,
    cardId: "neutral-wandering-alchemist",
  });

  assert.equal(missingTarget.accepted, false);
  assert.equal(missingTarget.error?.code, "target-required");
  assert.deepEqual(missingTarget.state, before);

  const targeted = applyCommand(state, {
    type: "play-card",
    player: 0,
    cardId: "neutral-wandering-alchemist",
    target: { kind: "hero", player: 0 },
  });
  assert.equal(targeted.accepted, true);
  assert.equal(targeted.state.players[0].board.length, 1);
  assert.ok(targeted.state.events.some((event) => event.type === "unit-summoned"));
});

test("致命战吼后仍会完成随从的召唤后奥秘窗口", () => {
  const state = editableMatch();
  state.players[0].hand = ["ember-oath-pyromancer"];
  state.players[0].mana = 5;
  state.players[1].hero.health = 1;
  state.players[1].secrets = [
    {
      cardId: "ember-fireline-lockdown",
      secretId: "battlecry-lethal-summon-secret",
      name: "火线封锁",
      description: "",
      trigger: "opponent-summons-unit",
      effect: { kind: "damage-enemy-hero", amount: 2 },
    },
  ];

  const result = applyCommand(state, {
    type: "play-card",
    player: 0,
    cardId: "ember-oath-pyromancer",
    target: { kind: "hero", player: 1 },
  });

  assert.equal(result.accepted, true);
  assert.equal(result.state.phase, "game-over");
  assert.deepEqual(result.state.result, { winner: 0, reason: "hero-defeated" });
  assert.equal(result.state.players[0].hero.health, 28);
  assert.equal(result.state.players[1].secrets.length, 0);
  const battlecryDamage = result.state.events.findIndex(
    (event) => event.type === "damage" && event.data?.target?.kind === "hero" && event.data?.target?.player === 1,
  );
  const secretIndex = result.state.events.findIndex((event) => event.type === "secret-triggered");
  const endIndex = result.state.events.findIndex((event) => event.type === "match-ended");
  assert.ok(battlecryDamage >= 0 && secretIndex > battlecryDamage && endIndex > secretIndex);
});

test("战术施放触发会按当前战线结算，并且沉默后不再触发", () => {
  const state = editableMatch();
  state.players[0].board = [
    unit("duelist", "neutral-crossroad-duelist", 0, { summonedTurn: 1 }),
    unit("sentry", "storm-capacitor-sentry", 0, { summonedTurn: 1 }),
  ];
  state.players[0].hand = ["sun-focused-ray"];
  state.players[0].mana = 1;
  const cast = applyCommand(state, {
    type: "play-card",
    player: 0,
    cardId: "sun-focused-ray",
    target: { kind: "hero", player: 1 },
  });
  assert.equal(cast.accepted, true);
  assert.equal(cast.state.players[0].board[0]?.attack, 4);
  assert.equal(cast.state.players[0].hero.armor, 1);
  assert.equal(
    cast.state.events.filter((event) => event.type === "card-triggered").length,
    2,
  );
  assert.ok(
    battleEventsToEffects(cast.state.events).some((effect) => effect.label === "战术触发"),
  );

  const silenced = cloneMatch(cast.state);
  silenced.players[0].hand = ["sun-focused-ray"];
  silenced.players[0].mana = 1;
  for (const boardUnit of silenced.players[0].board) {
    boardUnit.silenced = true;
    boardUnit.keywords = [];
  }
  const afterSilence = applyCommand(silenced, {
    type: "play-card",
    player: 0,
    cardId: "sun-focused-ray",
    target: { kind: "hero", player: 1 },
  });
  assert.equal(afterSilence.accepted, true);
  assert.equal(afterSilence.state.players[0].board[0]?.attack, 4);
  assert.equal(afterSilence.state.players[0].hero.armor, 1);
});

test("可交易卡牌会消耗 1 点法力并循环抽取替代牌", () => {
  const state = editableMatch();
  state.players[0].hand = ["sun-refraction-aid"];
  state.players[0].deck = ["sun-focused-ray"];
  state.players[0].mana = 2;
  const beforeCards = [...state.players[0].hand, ...state.players[0].deck].sort();

  const traded = applyCommand(state, {
    type: "trade-card",
    player: 0,
    cardId: "sun-refraction-aid",
  });
  assert.equal(traded.accepted, true);
  assert.equal(traded.state.players[0].mana, 1);
  assert.deepEqual(traded.state.players[0].hand, ["sun-focused-ray"]);
  assert.deepEqual(traded.state.players[0].deck, ["sun-refraction-aid"]);
  assert.deepEqual(
    [...traded.state.players[0].hand, ...traded.state.players[0].deck].sort(),
    beforeCards,
  );
  assert.ok(
    traded.state.events.some(
      (event) => event.type === "card-traded" && event.data?.cardId === "sun-refraction-aid",
    ),
  );
  assert.equal(
    battleEventsToEffects(traded.state.events).at(-2)?.kind,
    "trade",
  );
});

test("牌库为空时不能交易卡牌", () => {
  const state = editableMatch();
  state.players[0].hand = ["sun-refraction-aid"];
  state.players[0].deck = [];
  state.players[0].mana = 2;

  const traded = applyCommand(state, {
    type: "trade-card",
    player: 0,
    cardId: "sun-refraction-aid",
  });

  assert.equal(traded.accepted, false);
  assert.equal(traded.error?.code, "not-tradeable");
  assert.equal(traded.state, state);
  assert.deepEqual(traded.state.players[0].hand, ["sun-refraction-aid"]);
  assert.deepEqual(traded.state.players[0].deck, []);
  assert.equal(traded.state.players[0].mana, 2);
  assert.equal(
    traded.state.events.some((event) => event.type === "card-traded"),
    false,
  );
});

test("巧铸会为二星共鸣提供额外属性", () => {
  const state = editableMatch();
  state.players[0].board = [
    unit("crafted", "sun-mirror-warden", 0),
    unit("craft-link", "neutral-clockwork-beetle", 0),
  ];
  state.players[0].hand = ["sun-mirror-warden"];
  state.players[0].mana = 2;

  const result = applyCommand(state, {
    type: "play-card",
    player: 0,
    cardId: "sun-mirror-warden",
  });
  const upgraded = result.state.players[0].board[0];
  assert.equal(result.accepted, true);
  assert.equal(upgraded.stars, 2);
  assert.equal(upgraded.attack, 4);
  assert.equal(upgraded.health, 6);
  assert.equal(upgraded.maxHealth, 6);
});

test("攻击遵守嘲讽，护盾抵消首次伤害，单位只攻击一次", () => {
  const state = editableMatch();
  state.turn = 4;
  state.players[0].board = [
    unit("attacker", "neutral-stonehorn", 0, {
      summonedTurn: 2,
    }),
  ];
  state.players[1].board = [
    unit("defender", "void-undertow-guard", 1, {
      keywords: ["taunt", "shield"],
    }),
  ];

  const blocked = applyCommand(state, {
    type: "attack",
    player: 0,
    attackerId: "attacker",
    target: { kind: "hero", player: 1 },
  });
  assert.equal(blocked.accepted, false);
  assert.equal(blocked.error?.code, "taunt-blocking");

  const combat = applyCommand(state, {
    type: "attack",
    player: 0,
    attackerId: "attacker",
    target: { kind: "unit", entityId: "defender" },
  });
  assert.equal(combat.accepted, true);
  assert.deepEqual(combat.state.players[1].board[0].keywords, ["taunt"]);
  assert.equal(combat.state.players[1].board[0].health, 4);
  assert.equal(combat.state.players[0].board[0].health, 3);
  assert.equal(combat.state.players[0].board[0].attack, 5);
  assert.equal(combat.state.players[0].board[0].furyStacks, 1);

  const repeat = applyCommand(combat.state, {
    type: "attack",
    player: 0,
    attackerId: "attacker",
    target: { kind: "unit", entityId: "defender" },
  });
  assert.equal(repeat.accepted, false);
  assert.equal(repeat.error?.code, "attacker-exhausted");
});

test("死亡单位不能继续作为攻击或法术目标，也不会残留嘲讽拦截", () => {
  const attackState = editableMatch();
  attackState.turn = 4;
  attackState.players[0].board = [
    unit("live-attacker", "neutral-stonehorn", 0, {
      summonedTurn: 1,
      summoningSick: false,
    }),
  ];
  attackState.players[1].board = [
    unit("dead-taunt", "void-undertow-guard", 1, {
      health: 0,
      maxHealth: 5,
      keywords: ["taunt"],
      summonedTurn: 1,
    }),
  ];

  const deadTarget = applyCommand(attackState, {
    type: "attack",
    player: 0,
    attackerId: "live-attacker",
    target: { kind: "unit", entityId: "dead-taunt" },
  });
  assert.equal(deadTarget.accepted, false);
  assert.equal(deadTarget.error?.code, "invalid-target");

  const heroTarget = applyCommand(attackState, {
    type: "attack",
    player: 0,
    attackerId: "live-attacker",
    target: { kind: "hero", player: 1 },
  });
  assert.equal(heroTarget.accepted, true);
  assert.equal(heroTarget.state.players[1].hero.health, 26);

  const spellState = editableMatch();
  spellState.players[0].hand = ["sun-daybreak-order"];
  spellState.players[0].mana = 3;
  spellState.players[0].board = [
    unit("dead-friendly", "neutral-moss-runner", 0, {
      health: 0,
      maxHealth: 3,
      summonedTurn: 1,
    }),
    unit("live-friendly", "neutral-moss-runner", 0, {
      summonedTurn: 1,
    }),
  ];

  const invalidSpellTarget = applyCommand(spellState, {
    type: "play-card",
    player: 0,
    cardId: "sun-daybreak-order",
    target: { kind: "unit", entityId: "dead-friendly" },
  });
  assert.equal(invalidSpellTarget.accepted, false);
  assert.equal(invalidSpellTarget.error?.code, "invalid-target");

  const validSpellTarget = applyCommand(spellState, {
    type: "play-card",
    player: 0,
    cardId: "sun-daybreak-order",
    target: { kind: "unit", entityId: "live-friendly" },
  });
  assert.equal(validSpellTarget.accepted, true);
  assert.equal(
    validSpellTarget.state.players[0].board.find((entry) => entry.entityId === "live-friendly")?.attack,
    3,
  );
});

test("单位战斗伤害同时结算，即使先手击杀防守者也会受到反击", () => {
  const state = editableMatch();
  state.turn = 4;
  state.players[0].board = [
    unit("attacker", "neutral-clockwork-beetle", 0, {
      attack: 5,
      health: 2,
      maxHealth: 2,
      keywords: [],
      summonedTurn: 1,
    }),
  ];
  state.players[1].board = [
    unit("defender", "void-undertow-guard", 1, {
      attack: 2,
      health: 1,
      maxHealth: 1,
      keywords: ["taunt"],
      summonedTurn: 1,
    }),
  ];

  const result = applyCommand(state, {
    type: "attack",
    player: 0,
    attackerId: "attacker",
    target: { kind: "unit", entityId: "defender" },
  });

  assert.equal(result.accepted, true);
  assert.deepEqual(result.state.players[0].board, []);
  assert.deepEqual(result.state.players[1].board, []);
  assert.ok(
    result.state.events.some(
      (event) => event.type === "damage" && event.data?.entityId === "attacker",
    ),
  );
  assert.ok(
    result.state.events.some(
      (event) => event.type === "damage" && event.data?.entityId === "defender",
    ),
  );
});

test("冻结在控制者回合开始时解除，并允许单位当回合攻击", () => {
  const state = editableMatch();
  state.turn = 4;
  state.activePlayer = 0;
  state.players[0].board = [
    unit("frozen", "neutral-moss-runner", 0, {
      attack: 1,
      health: 2,
      maxHealth: 2,
      summonedTurn: 1,
      frozenTurns: 1,
      hasAttacked: true,
      attacksMade: 0,
      summoningSick: false,
    }),
  ];

  const nextTurn = applyCommand(state, { type: "end-turn", player: 0 });
  assert.equal(nextTurn.accepted, true);
  const unfrozen = nextTurn.state.players[1].board[0];
  assert.equal(unfrozen, undefined);

  const backToOwner = applyCommand(nextTurn.state, { type: "end-turn", player: 1 });
  assert.equal(backToOwner.accepted, true);
  const ready = backToOwner.state.players[0].board[0];
  assert.equal(ready?.frozenTurns, 0);
  assert.equal(ready?.hasAttacked, false);
  assert.equal(ready?.summoningSick, false);

  const attack = applyCommand(backToOwner.state, {
    type: "attack",
    player: 0,
    attackerId: "frozen",
    target: { kind: "hero", player: 1 },
  });
  assert.equal(attack.accepted, true);
  assert.equal(attack.state.players[1].hero.health, 29);
});

test("冻结会跳过受影响单位的下一次攻击，而不是在对手回合开始时提前解除", () => {
  const state = editableMatch();
  state.turn = 4;
  state.activePlayer = 0;
  state.players[1].board = [unit("frozen-attacker", "neutral-moss-runner", 1, {
    attack: 1,
    health: 2,
    maxHealth: 2,
    summonedTurn: 1,
    frozenTurns: 1,
    summoningSick: false,
  })];

  const toFrozenPlayer = applyCommand(state, { type: "end-turn", player: 0 });
  assert.equal(toFrozenPlayer.accepted, true);
  const blocked = applyCommand(toFrozenPlayer.state, {
    type: "attack",
    player: 1,
    attackerId: "frozen-attacker",
    target: { kind: "hero", player: 0 },
  });
  assert.equal(blocked.accepted, false);
  assert.equal(blocked.error?.code, "attacker-exhausted");

  const backToOpponent = applyCommand(toFrozenPlayer.state, {
    type: "end-turn",
    player: 1,
  });
  const readyTurn = applyCommand(backToOpponent.state, {
    type: "end-turn",
    player: 0,
  });
  const attack = applyCommand(readyTurn.state, {
    type: "attack",
    player: 1,
    attackerId: "frozen-attacker",
    target: { kind: "hero", player: 0 },
  });
  assert.equal(attack.accepted, true);
  assert.equal(attack.state.players[0].hero.health, 29);
});

test("普通单位用尽攻击后才被冻结时，会持续到该单位下回合结束", () => {
  const state = editableMatch();
  state.turn = 4;
  state.activePlayer = 1;
  state.players[1].board = [unit("already-attacked", "neutral-moss-runner", 1, {
    attack: 1,
    health: 2,
    maxHealth: 2,
    summonedTurn: 1,
    frozenTurns: 1,
    attacksMade: 1,
    hasAttacked: true,
    summoningSick: false,
  })];

  const opponentTurn = applyCommand(state, { type: "end-turn", player: 1 });
  assert.equal(opponentTurn.accepted, true);
  assert.equal(opponentTurn.state.players[1].board[0]?.frozenTurns, 1);

  const frozenTurn = applyCommand(opponentTurn.state, {
    type: "end-turn",
    player: 0,
  });
  const blocked = frozenTurn.state.players[1].board[0];
  assert.equal(blocked?.frozenTurns, 1);
  assert.equal(blocked?.freezeBlocked, true);
  assert.equal(blocked?.attacksMade, 1);

  const afterSkippedAttack = applyCommand(frozenTurn.state, {
    type: "end-turn",
    player: 1,
  });
  assert.equal(afterSkippedAttack.state.players[1].board[0]?.frozenTurns, 0);

  const readyTurn = applyCommand(afterSkippedAttack.state, {
    type: "end-turn",
    player: 0,
  });
  const attack = applyCommand(readyTurn.state, {
    type: "attack",
    player: 1,
    attackerId: "already-attacked",
    target: { kind: "hero", player: 0 },
  });
  assert.equal(attack.accepted, true);
  assert.equal(attack.state.players[0].hero.health, 29);
});

test("风怒单位第一次攻击后被冻结，会失去第二次攻击并在回合结束时解冻", () => {
  const state = editableMatch();
  state.turn = 4;
  state.activePlayer = 1;
  state.players[1].board = [unit("windfury-frozen", "neutral-clockwork-beetle", 1, {
    attack: 1,
    health: 3,
    maxHealth: 3,
    keywords: ["windfury"],
    summonedTurn: 1,
    frozenTurns: 1,
    attacksMade: 1,
    hasAttacked: true,
    summoningSick: false,
  })];

  const opponentTurn = applyCommand(state, { type: "end-turn", player: 1 });
  assert.equal(opponentTurn.accepted, true);
  assert.equal(opponentTurn.state.players[1].board[0]?.frozenTurns, 0);

  const readyTurn = applyCommand(opponentTurn.state, { type: "end-turn", player: 0 });
  const first = applyCommand(readyTurn.state, {
    type: "attack",
    player: 1,
    attackerId: "windfury-frozen",
    target: { kind: "hero", player: 0 },
  });
  assert.equal(first.accepted, true);
  const second = applyCommand(first.state, {
    type: "attack",
    player: 1,
    attackerId: "windfury-frozen",
    target: { kind: "hero", player: 0 },
  });
  assert.equal(second.accepted, true);
  assert.equal(second.state.players[0].hero.health, 28);
});

test("0 攻击单位不能发起攻击", () => {
  const state = editableMatch();
  state.players[0].board = [unit("zero-attack", "neutral-moss-runner", 0, {
    attack: 0,
    health: 2,
    maxHealth: 2,
    summonedTurn: 1,
    summoningSick: false,
  })];

  const result = applyCommand(state, {
    type: "attack",
    player: 0,
    attackerId: "zero-attack",
    target: { kind: "hero", player: 1 },
  });
  assert.equal(result.accepted, false);
  assert.equal(result.error?.code, "attacker-exhausted");
});

test("随机冻结可以命中潜行单位，但不会选中已濒死单位", () => {
  const state = editableMatch();
  state.turn = 4;
  state.activePlayer = 0;
  state.players[0].hand = ["void-ink-storm"];
  state.players[0].mana = 4;
  state.players[1].board = [unit("stealth-freeze-target", "astral-eclipse-stalker", 1, {
    health: 4,
    maxHealth: 4,
    summonedTurn: 1,
    stealthActive: true,
    frozenTurns: 0,
    keywords: ["shield", "stealth"],
  })];

  const result = applyCommand(state, {
    type: "play-card",
    player: 0,
    cardId: "void-ink-storm",
  });

  assert.equal(result.accepted, true);
  assert.equal(result.state.players[1].board[0]?.stealthActive, true);
  assert.equal(result.state.players[1].board[0]?.keywords.includes("shield"), false);
  assert.equal(result.state.players[1].board[0]?.health, 4);
  assert.equal(result.state.players[1].board[0]?.frozenTurns, 1);
});

test("武器可装备并让英雄攻击，耐久耗尽后失效且受嘲讽约束", () => {
  const state = editableMatch();
  state.turn = 5;
  state.players[0].hand = ["sun-supernova-judgment"];
  state.players[0].mana = 6;

  const equipped = applyCommand(state, {
    type: "play-card",
    player: 0,
    cardId: "sun-supernova-judgment",
  });
  assert.equal(equipped.accepted, true);
  assert.deepEqual(equipped.state.players[0].weapon, {
    cardId: "sun-supernova-judgment",
    name: "新星裁决刃",
    attack: 6,
    durability: 2,
    maxDurability: 2,
  });

  equipped.state.players[1].board = [
    unit("taunt", "void-undertow-guard", 1, {
      health: 8,
      maxHealth: 8,
      keywords: ["taunt"],
    }),
  ];
  const blocked = applyCommand(equipped.state, {
    type: "hero-attack",
    player: 0,
    target: { kind: "hero", player: 1 },
  });
  assert.equal(blocked.accepted, false);
  assert.equal(blocked.error?.code, "taunt-blocking");

  const first = applyCommand(equipped.state, {
    type: "hero-attack",
    player: 0,
    target: { kind: "unit", entityId: "taunt" },
  });
  assert.equal(first.accepted, true);
  assert.equal(first.state.players[1].board[0].health, 2);
  assert.equal(first.state.players[0].hero.health, 28);
  assert.equal(first.state.players[0].weapon?.durability, 1);

  const repeat = applyCommand(first.state, {
    type: "hero-attack",
    player: 0,
    target: { kind: "unit", entityId: "taunt" },
  });
  assert.equal(repeat.accepted, false);
  assert.equal(repeat.error?.code, "hero-exhausted");

  const nextTurn = applyCommand(first.state, { type: "end-turn", player: 0 });
  const second = applyCommand(nextTurn.state, {
    type: "hero-attack",
    player: 1,
    target: { kind: "hero", player: 0 },
  });
  assert.equal(second.accepted, false);
  assert.equal(second.error?.code, "weapon-unavailable");

  const playerTurn = applyCommand(nextTurn.state, { type: "end-turn", player: 1 });
  const final = applyCommand(playerTurn.state, {
    type: "hero-attack",
    player: 0,
    target: { kind: "unit", entityId: "taunt" },
  });
  assert.equal(final.accepted, true);
  assert.equal(final.state.players[0].weapon, null);
  assert.ok(final.state.events.some((event) => event.type === "weapon-broke"));
});

test("英雄武器攻击也会遵守坚阵战斗减伤", () => {
  const state = editableMatch();
  state.turn = 5;
  state.players[0].hand = ["sun-supernova-judgment"];
  state.players[0].mana = 6;
  const equipped = applyCommand(state, {
    type: "play-card",
    player: 0,
    cardId: "sun-supernova-judgment",
  });
  assert.equal(equipped.accepted, true);
  equipped.state.players[1].board = [
    unit("taunt", "void-undertow-guard", 1, {
      health: 8,
      maxHealth: 8,
      keywords: ["taunt"],
    }),
    unit("bulwark", "sun-mirror-warden", 1, {
      keywords: [],
    }),
  ];
  const attacked = applyCommand(equipped.state, {
    type: "hero-attack",
    player: 0,
    target: { kind: "unit", entityId: "taunt" },
  });
  assert.equal(attacked.accepted, true);
  assert.equal(attacked.state.players[1].board[0].health, 3);
});

test("英雄与防守单位同时致死时仍会先完整结算亡语", () => {
  const state = editableMatch();
  state.players[0].hero.health = 1;
  state.players[0].weapon = {
    cardId: "sun-supernova-judgment",
    name: "新星裁决刃",
    attack: 6,
    durability: 2,
    maxDurability: 2,
  };
  state.players[1].board = [unit("lethal-deathrattle", "sun-zenith-golem", 1, {
    attack: 1,
    health: 1,
    maxHealth: 7,
    playOrder: 1,
    keywords: ["deathrattle"],
  })];

  const result = applyCommand(state, {
    type: "hero-attack",
    player: 0,
    target: { kind: "unit", entityId: "lethal-deathrattle" },
  });

  assert.equal(result.accepted, true);
  assert.deepEqual(result.state.result, { winner: 1, reason: "hero-defeated" });
  assert.ok(result.state.players[1].board.some((entry) => entry.cardId === "sun-dawn-scout"));
  const diedIndex = result.state.events.findIndex(
    (event) => event.type === "unit-died" && event.data?.entityId === "lethal-deathrattle",
  );
  const summonedIndex = result.state.events.findIndex(
    (event) => event.type === "unit-summoned" && event.data?.cardId === "sun-dawn-scout",
  );
  const endedIndex = result.state.events.findIndex((event) => event.type === "match-ended");
  assert.ok(diedIndex >= 0 && summonedIndex > diedIndex && endedIndex > summonedIndex);
});

test("装备新武器会先销毁旧武器并留下可播放的替换事件", () => {
  const state = editableMatch();
  state.turn = 8;
  state.players[0].hand = ["sun-supernova-judgment", "neutral-grand-expedition"];
  state.players[0].mana = 13;

  const first = applyCommand(state, {
    type: "play-card",
    player: 0,
    cardId: "sun-supernova-judgment",
  });
  assert.equal(first.accepted, true);

  const second = applyCommand(first.state, {
    type: "play-card",
    player: 0,
    cardId: "neutral-grand-expedition",
  });
  assert.equal(second.accepted, true);
  assert.equal(second.state.players[0].weapon?.cardId, "neutral-grand-expedition");
  const eventTypes = second.state.events.slice(-3).map((event) => event.type);
  assert.deepEqual(eventTypes, ["card-played", "weapon-broke", "weapon-equipped"]);
  const replacement = second.state.events.find(
    (event) => event.type === "weapon-broke" && event.data?.reason === "replaced",
  );
  assert.equal(replacement?.data?.cardId, "sun-supernova-judgment");
  assert.equal(replacement?.data?.replacementCardId, "neutral-grand-expedition");
});

test("奥秘会暗置、按触发条件结算，并且只触发一次", () => {
  const state = editableMatch();
  state.players[0].hand = ["sun-dawn-muster"];
  state.players[0].mana = 4;

  const armed = applyCommand(state, {
    type: "play-card",
    player: 0,
    cardId: "sun-dawn-muster",
  });
  assert.equal(armed.accepted, true);
  assert.equal(armed.state.players[0].secrets.length, 1);
  assert.equal(armed.state.players[0].secrets[0].secretId, "sun-dawn-muster");
  assert.equal(armed.state.players[1].hero.health, 30);

  armed.state.activePlayer = 1;
  armed.state.turn = 4;
  armed.state.players[1].board = [
    unit("secret-attacker", "neutral-moss-runner", 1, {
      summonedTurn: 1,
      health: 10,
      maxHealth: 10,
    }),
  ];
  const triggered = applyCommand(armed.state, {
    type: "attack",
    player: 1,
    attackerId: "secret-attacker",
    target: { kind: "hero", player: 0 },
  });
  assert.equal(triggered.accepted, true);
  assert.equal(triggered.state.players[0].secrets.length, 0);
  assert.equal(triggered.state.players[1].board[0].health, 7);
  assert.equal(triggered.state.players[0].hero.health, 29);
  assert.ok(triggered.state.events.some((event) => event.type === "secret-triggered"));

  const noSecondTrigger = applyCommand(triggered.state, {
    type: "end-turn",
    player: 1,
  });
  assert.equal(noSecondTrigger.accepted, true);
  assert.equal(noSecondTrigger.state.players[0].secrets.length, 0);
});

test("同名奥秘不能重复暗置", () => {
  const state = editableMatch();
  state.turn = 4;
  state.players[0].hand = ["sun-dawn-muster", "sun-dawn-muster"];
  state.players[0].mana = 10;

  const first = applyCommand(state, {
    type: "play-card",
    player: 0,
    cardId: "sun-dawn-muster",
  });
  assert.equal(first.accepted, true);
  const beforeSecond = structuredClone(first.state);
  const second = applyCommand(first.state, {
    type: "play-card",
    player: 0,
    cardId: "sun-dawn-muster",
  });

  assert.equal(second.accepted, false);
  assert.equal(second.error?.code, "secret-duplicate");
  assert.deepEqual(second.state, beforeSecond);
});

test("法术会在效果结算前经过奥秘窗口，并可被反制", () => {
  const state = editableMatch();
  state.phase = "main";
  state.activePlayer = 1;
  state.players[0].secrets.push({
    cardId: "void-echoing-current",
    secretId: "void-echoing-current",
    name: CARD_BY_ID["void-echoing-current"]?.name ?? "回响暗流",
    description: CARD_BY_ID["void-echoing-current"]?.description ?? "",
    trigger: "opponent-plays-spell",
    effect: { kind: "counterspell" },
  });
  state.players[1].hand = ["storm-chain-discharge"];
  state.players[1].mana = 3;
  const result = applyCommand(state, {
    type: "play-card",
    player: 1,
    cardId: "storm-chain-discharge",
  });

  assert.equal(result.accepted, true);
  assert.equal(result.state.players[0].secrets.length, 0);
  assert.equal(result.state.players[0].hero.health, 30);
  assert.equal(result.state.players[1].mana, 0);
  assert.equal(result.state.players[1].overload, 0);
  assert.equal(result.state.players[1].hand.length, 0);
  assert.ok(result.state.events.some((event) => event.type === "spell-countered"));
  assert.equal(result.state.events.some((event) => event.type === "mana-overloaded"), false);
  assert.equal(result.state.events.some((event) => event.type === "damage"), false);
});

test("多个反制奥秘中只有先手反制会消费施放事件", () => {
  const state = editableMatch();
  state.phase = "main";
  state.activePlayer = 0;
  state.players[0].hand = ["sun-focused-ray"];
  state.players[0].mana = 1;
  state.players[1].secrets = [
    {
      cardId: "void-echoing-current",
      secretId: "counterspell-first",
      name: "回响暗流 A",
      description: "",
      trigger: "opponent-plays-spell",
      effect: { kind: "counterspell" },
    },
    {
      cardId: "void-echoing-current",
      secretId: "counterspell-second",
      name: "回响暗流 B",
      description: "",
      trigger: "opponent-plays-spell",
      effect: { kind: "counterspell" },
    },
  ];

  const result = applyCommand(state, {
    type: "play-card",
    player: 0,
    cardId: "sun-focused-ray",
    target: { kind: "hero", player: 1 },
  });

  assert.equal(result.accepted, true);
  assert.equal(result.state.players[1].hero.health, 30);
  assert.deepEqual(
    result.state.players[1].secrets.map((secret) => secret.secretId),
    ["counterspell-second"],
  );
});

test("奥秘伤害会继承控制者的法术伤害加成", () => {
  const state = editableMatch();
  state.phase = "main";
  state.activePlayer = 1;
  state.players[0].secrets.push({
    cardId: "ember-fireline-lockdown",
    secretId: "ember-fireline-lockdown",
    name: CARD_BY_ID["ember-fireline-lockdown"]?.name ?? "火线封锁",
    description: CARD_BY_ID["ember-fireline-lockdown"]?.description ?? "",
    trigger: "opponent-plays-spell",
    effect: { kind: "damage-enemy-hero", amount: 2 },
  });
  state.players[0].board.push(unit("spell-amp", "neutral-relic-appraiser", 0));
  state.players[1].hand = ["sun-focused-ray"];
  state.players[1].mana = 1;
  const result = applyCommand(state, {
    type: "play-card",
    player: 1,
    cardId: "sun-focused-ray",
    target: { kind: "hero", player: 0 },
  });

  assert.equal(result.accepted, true);
  assert.equal(result.state.players[0].hero.health, 28);
  assert.equal(result.state.players[1].hero.health, 27);
});

test("单位攻击型奥秘不会被英雄用武器攻击错误消耗", () => {
  const state = editableMatch();
  state.players[0].hand = ["sun-dawn-muster", "sun-supernova-judgment"];
  state.players[0].mana = 10;
  const armed = applyCommand(state, {
    type: "play-card",
    player: 0,
    cardId: "sun-dawn-muster",
  });
  assert.equal(armed.accepted, true);
  const equipped = applyCommand(armed.state, {
    type: "play-card",
    player: 0,
    cardId: "sun-supernova-judgment",
  });
  assert.equal(equipped.accepted, true);
  equipped.state.activePlayer = 0;
  equipped.state.turn = 5;
  const attacked = applyCommand(equipped.state, {
    type: "hero-attack",
    player: 0,
    target: { kind: "hero", player: 1 },
  });
  assert.equal(attacked.accepted, true);
  assert.equal(attacked.state.players[0].secrets.length, 1);
  assert.equal(attacked.state.players[1].hero.health, 24);
});

test("英雄攻击敌方核心会触发伤害攻击者奥秘", () => {
  const state = editableMatch();
  state.turn = 5;
  state.activePlayer = 0;
  state.players[0].hand = ["sun-supernova-judgment"];
  state.players[0].mana = 6;
  state.players[1].secrets = [
    {
      cardId: "sun-dawn-muster",
      secretId: "hero-attack-secret",
      name: "晨阵集结",
      description: "",
      trigger: "opponent-attacks-hero",
      effect: { kind: "damage-attacker", amount: 3 },
    },
  ];

  const equipped = applyCommand(state, {
    type: "play-card",
    player: 0,
    cardId: "sun-supernova-judgment",
  });
  assert.equal(equipped.accepted, true);
  const attacked = applyCommand(equipped.state, {
    type: "hero-attack",
    player: 0,
    target: { kind: "hero", player: 1 },
  });

  assert.equal(attacked.accepted, true);
  assert.equal(attacked.state.players[0].hero.health, 27);
  assert.equal(attacked.state.players[1].hero.health, 24);
  assert.equal(attacked.state.players[0].weapon?.durability, 1);
  assert.equal(attacked.state.players[1].secrets.length, 0);
});

test("英雄被攻击者奥秘击败时不会完成攻击或消耗武器耐久", () => {
  const state = editableMatch();
  state.turn = 5;
  state.activePlayer = 0;
  state.players[0].hand = ["sun-supernova-judgment"];
  state.players[0].mana = 6;
  state.players[0].hero.health = 2;
  state.players[1].secrets = [
    {
      cardId: "sun-dawn-muster",
      secretId: "hero-lethal-secret",
      name: "晨阵集结",
      description: "",
      trigger: "opponent-attacks-hero",
      effect: { kind: "damage-attacker", amount: 3 },
    },
  ];

  const equipped = applyCommand(state, {
    type: "play-card",
    player: 0,
    cardId: "sun-supernova-judgment",
  });
  assert.equal(equipped.accepted, true);
  const attacked = applyCommand(equipped.state, {
    type: "hero-attack",
    player: 0,
    target: { kind: "hero", player: 1 },
  });

  assert.equal(attacked.accepted, true);
  assert.equal(attacked.state.phase, "game-over");
  assert.equal(attacked.state.players[1].hero.health, 30);
  assert.equal(attacked.state.players[0].weapon?.durability, 2);
});

test("英雄攻击触发的多个奥秘会在致命伤害后完成同一队列", () => {
  const state = editableMatch();
  state.activePlayer = 1;
  state.turn = 4;
  state.players[1].hero.health = 2;
  state.players[0].secrets = [
    {
      cardId: "sun-dawn-muster",
      secretId: "hero-lethal-a",
      name: "晨阵集结 A",
      description: "",
      trigger: "opponent-attacks-hero",
      effect: { kind: "damage-attacker", amount: 3 },
    },
    {
      cardId: "sun-dawn-muster",
      secretId: "hero-lethal-b",
      name: "晨阵集结 B",
      description: "",
      trigger: "opponent-attacks-hero",
      effect: { kind: "armor", amount: 2 },
    },
  ];
  state.players[1].weapon = {
    cardId: "sun-supernova-judgment",
    name: "新星裁决刃",
    attack: 6,
    durability: 2,
    maxDurability: 2,
  };

  const result = applyCommand(state, {
    type: "hero-attack",
    player: 1,
    target: { kind: "hero", player: 0 },
  });

  assert.equal(result.accepted, true);
  assert.equal(result.state.phase, "game-over");
  assert.deepEqual(result.state.result, { winner: 0, reason: "hero-defeated" });
  assert.equal(result.state.players[0].secrets.length, 0);
  assert.equal(result.state.players[0].hero.armor, 2);
  assert.equal(result.state.players[1].weapon?.durability, 2);
  const triggered = result.state.events.filter((event) => event.type === "secret-triggered");
  assert.deepEqual(
    triggered.map((event) => event.data?.secretId),
    ["hero-lethal-a", "hero-lethal-b"],
  );
});

test("同一攻击触发的后续奥秘若失去目标会保留", () => {
  const state = editableMatch();
  state.players[0].secrets = [
    {
      cardId: "sun-dawn-muster",
      secretId: "sun-dawn-muster-a",
      name: "晨阵集结 A",
      description: "",
      trigger: "opponent-attacks-hero",
      effect: { kind: "damage-attacker", amount: 3 },
    },
    {
      cardId: "sun-dawn-muster",
      secretId: "sun-dawn-muster-b",
      name: "晨阵集结 B",
      description: "",
      trigger: "opponent-attacks-hero",
      effect: { kind: "damage-attacker", amount: 3 },
    },
  ];
  state.activePlayer = 1;
  state.turn = 4;
  state.players[1].board = [
    unit("secret-attacker-two", "neutral-moss-runner", 1, {
      summonedTurn: 1,
      health: 3,
      maxHealth: 3,
    }),
  ];

  const result = applyCommand(state, {
    type: "attack",
    player: 1,
    attackerId: "secret-attacker-two",
    target: { kind: "hero", player: 0 },
  });

  assert.equal(result.accepted, true);
  assert.equal(result.state.players[0].secrets.length, 1);
  assert.equal(result.state.players[0].secrets[0]?.secretId, "sun-dawn-muster-b");
  assert.equal(result.state.players[1].hero.health, 30);
});

test("攻击奥秘全部结算后才进入攻击者亡语窗口", () => {
  const state = editableMatch();
  state.activePlayer = 1;
  state.turn = 4;
  state.players[0].secrets = [
    {
      cardId: "sun-dawn-muster",
      secretId: "death-window-first",
      name: "晨阵集结 A",
      description: "",
      trigger: "opponent-attacks-hero",
      effect: { kind: "damage-attacker", amount: 3 },
    },
    {
      cardId: "sun-dawn-muster",
      secretId: "death-window-second",
      name: "晨阵集结 B",
      description: "",
      trigger: "opponent-attacks-hero",
      effect: { kind: "damage-attacker", amount: 3 },
    },
  ];
  state.players[1].board = [unit("phoenix-attacker", "ember-ashwing-phoenix", 1, {
    summonedTurn: 1,
    health: 3,
    maxHealth: 3,
    keywords: [],
  })];

  const result = applyCommand(state, {
    type: "attack",
    player: 1,
    attackerId: "phoenix-attacker",
    target: { kind: "hero", player: 0 },
  });

  assert.equal(result.accepted, true);
  assert.equal(result.state.players[0].secrets.length, 1);
  assert.equal(result.state.players[0].secrets[0]?.secretId, "death-window-second");
  const firstSecret = result.state.events.findIndex(
    (event) => event.type === "secret-triggered" && event.data?.secretId === "death-window-first",
  );
  const died = result.state.events.findIndex(
    (event) => event.type === "unit-died" && event.data?.entityId === "phoenix-attacker",
  );
  assert.ok(firstSecret >= 0 && died > firstSecret);
});

test("发现会暂停行动，并将选择加入手牌", () => {
  const state = editableMatch();
  state.players[0].hand = ["astral-chart-revelation"];
  state.players[0].mana = 1;

  const started = applyCommand(state, {
    type: "play-card",
    player: 0,
    cardId: "astral-chart-revelation",
  });
  assert.equal(started.accepted, true);
  assert.equal(started.state.phase, "discover");
  assert.equal(started.state.discover?.choices.length, 3);
  assert.equal(started.state.players[0].hand.includes("astral-chart-revelation"), false);

  const blocked = applyCommand(started.state, { type: "end-turn", player: 0 });
  assert.equal(blocked.accepted, false);
  assert.equal(blocked.error?.code, "discover-closed");

  const selectedCard = started.state.discover?.choices[0] ?? "astral-stardust-familiar";
  const chosen = applyCommand(started.state, {
    type: "choose-discover",
    player: 0,
    cardId: selectedCard,
  });
  assert.equal(chosen.accepted, true);
  assert.equal(chosen.state.phase, "main");
  assert.equal(chosen.state.discover, null);
  assert.ok(chosen.state.players[0].hand.includes(selectedCard));
  assert.ok(chosen.state.events.some((event) => event.type === "discover-chosen"));
});

test("大发现池会按 seed 可复现地随机展示三张候选牌", () => {
  const makeStarted = (seed: number) => {
    const state = editableMatch(seed);
    state.players[0].hand = ["neutral-route-ledger"];
    state.players[0].mana = 2;
    return applyCommand(state, {
      type: "play-card",
      player: 0,
      cardId: "neutral-route-ledger",
    });
  };

  const first = makeStarted(20260811);
  const second = makeStarted(20260811);
  assert.equal(first.accepted, true);
  assert.equal(second.accepted, true);
  const firstChoices = first.state.discover?.choices ?? [];
  const secondChoices = second.state.discover?.choices ?? [];
  assert.equal(firstChoices.length, 3);
  assert.equal(new Set(firstChoices).size, 3);
  assert.deepEqual(firstChoices, secondChoices);
  assert.ok(firstChoices.every((cardId) => [
    "neutral-moss-runner",
    "neutral-clockwork-beetle",
    "neutral-tactical-map",
    "neutral-field-reinforcement",
    "neutral-pocket-remedy",
  ].includes(cardId)));
  assert.notEqual(first.state.rngState, editableMatch(20260811).rngState);
});

test("抉择会暂停行动，并只结算玩家选择的一个分支", () => {
  const state = editableMatch();
  state.players[0].hand = ["neutral-field-reinforcement"];
  state.players[0].mana = 2;
  state.players[0].board = [unit("choose-target", "neutral-moss-runner", 0, {
    summonedTurn: 1,
    attack: 4,
    health: 2,
    maxHealth: 2,
  })];

  const started = applyCommand(state, {
    type: "play-card",
    player: 0,
    cardId: "neutral-field-reinforcement",
    target: { kind: "unit", entityId: "choose-target" },
  });
  assert.equal(started.accepted, true);
  assert.equal(started.state.phase, "choose-one");
  assert.equal(started.state.chooseOne?.options.length, 2);
  assert.equal(started.state.players[0].board[0]?.attack, 4);

  const blocked = applyCommand(started.state, { type: "end-turn", player: 0 });
  assert.equal(blocked.accepted, false);
  assert.equal(blocked.error?.code, "choose-one-closed");

  const chosen = applyCommand(started.state, {
    type: "choose-one",
    player: 0,
    optionIndex: 1,
  });
  assert.equal(chosen.accepted, true);
  assert.equal(chosen.state.phase, "main");
  assert.equal(chosen.state.chooseOne, null);
  assert.equal(chosen.state.players[0].board[0]?.attack, 7);
  assert.equal(chosen.state.players[0].board[0]?.maxHealth, 3);
  assert.ok(chosen.state.events.some((event) => event.type === "choose-one-chosen"));
});

test("抉择牌在选项确认后才进入反制窗口", () => {
  const state = editableMatch();
  state.players[0].hand = ["neutral-field-reinforcement"];
  state.players[0].mana = 2;
  state.players[0].board = [unit("choose-counter-target", "neutral-moss-runner", 0, {
    summonedTurn: 1,
    attack: 4,
    health: 2,
    maxHealth: 2,
  })];
  state.players[1].secrets = [{
    cardId: "void-echoing-current",
    secretId: "choose-counterspell",
    name: "回响暗流",
    description: "",
    trigger: "opponent-plays-spell",
    effect: { kind: "counterspell" },
  }];

  const started = applyCommand(state, {
    type: "play-card",
    player: 0,
    cardId: "neutral-field-reinforcement",
    target: { kind: "unit", entityId: "choose-counter-target" },
  });
  assert.equal(started.accepted, true);
  assert.equal(started.state.phase, "choose-one");
  assert.equal(started.state.players[1].secrets.length, 1);

  const chosen = applyCommand(started.state, {
    type: "choose-one",
    player: 0,
    optionIndex: 1,
  });
  assert.equal(chosen.accepted, true);
  assert.equal(chosen.state.phase, "main");
  assert.equal(chosen.state.players[0].board[0]?.attack, 4);
  assert.equal(chosen.state.players[0].board[0]?.maxHealth, 2);
  assert.equal(chosen.state.players[1].secrets.length, 0);
});

test("变形会替换单位并清除原有增益与关键词", () => {
  const state = editableMatch();
  state.players[0].hand = ["astral-phase-shift"];
  state.players[0].mana = 4;
  state.players[1].board = [unit("transform-target", "sun-zenith-golem", 1, {
    summonedTurn: 1,
    attack: 9,
    health: 10,
    maxHealth: 10,
    keywords: ["taunt", "shield", "deathrattle"],
  })];

  const transformed = applyCommand(state, {
    type: "play-card",
    player: 0,
    cardId: "astral-phase-shift",
    target: { kind: "unit", entityId: "transform-target" },
  });
  assert.equal(transformed.accepted, true);
  const result = transformed.state.players[1].board[0];
  assert.equal(result?.entityId, "transform-target");
  assert.equal(result?.cardId, "neutral-moss-runner");
  assert.equal(result?.attack, 1);
  assert.equal(result?.health, 2);
  assert.deepEqual(result?.keywords, []);
  assert.ok(transformed.state.events.some((event) => event.type === "unit-transformed"));
});

test("变形不是召唤，不会触发召唤奥秘并会刷新入场顺序", () => {
  const state = editableMatch();
  state.nextEntityId = 50;
  state.players[0].hand = ["astral-phase-shift"];
  state.players[0].mana = 4;
  state.players[0].secrets = [
    {
      cardId: "ember-fireline-lockdown",
      secretId: "transform-summon-secret",
      name: "火线封锁",
      description: "",
      trigger: "opponent-summons-unit",
      effect: { kind: "damage-enemy-hero", amount: 2 },
    },
  ];
  state.players[1].board = [unit("transform-summon-target", "sun-zenith-golem", 1, {
    playOrder: 7,
    summonedTurn: 1,
    health: 7,
    maxHealth: 7,
  })];

  const result = applyCommand(state, {
    type: "play-card",
    player: 0,
    cardId: "astral-phase-shift",
    target: { kind: "unit", entityId: "transform-summon-target" },
  });

  assert.equal(result.accepted, true);
  assert.equal(result.state.players[1].hero.health, 30);
  assert.equal(result.state.players[0].secrets.length, 1);
  assert.equal(result.state.players[1].board[0]?.entityId, "transform-summon-target");
  assert.equal(result.state.players[1].board[0]?.playOrder, 50);
  assert.equal(result.state.events.some(
    (event) => event.type === "secret-triggered" && event.data?.trigger === "opponent-summons-unit",
  ), false);
});

test("临时增益会在所属玩家结束回合时准确移除", () => {
  const state = editableMatch();
  state.players[0].hand = ["ember-ignite-morale"];
  state.players[0].mana = 2;
  state.players[0].board = [unit("temporary-target", "neutral-moss-runner", 0, {
    summonedTurn: 1,
  })];

  const buffed = applyCommand(state, {
    type: "play-card",
    player: 0,
    cardId: "ember-ignite-morale",
    target: { kind: "unit", entityId: "temporary-target" },
  });
  assert.equal(buffed.accepted, true);
  assert.equal(buffed.state.players[0].board[0]?.attack, 3);
  assert.equal(buffed.state.players[0].board[0]?.maxHealth, 3);
  assert.equal(buffed.state.players[0].board[0]?.temporaryAttackBonus, 2);

  const ended = applyCommand(buffed.state, { type: "end-turn", player: 0 });
  assert.equal(ended.accepted, true);
  assert.equal(ended.state.activePlayer, 1);
  assert.equal(ended.state.players[0].board[0]?.attack, 1);
  assert.equal(ended.state.players[0].board[0]?.maxHealth, 2);
  assert.equal(ended.state.players[0].board[0]?.temporaryAttackBonus, 0);
  assert.ok(ended.state.events.some((event) => event.type === "temporary-expired"));
});

test("单位会在回合结束与回合开始触发持续效果", () => {
  const state = editableMatch();
  state.turn = 4;
  state.players[0].board = [unit("end-trigger", "neutral-ruin-stag", 0, { summonedTurn: 1 })];
  state.players[1].board = [unit("start-trigger", "void-abyssal-chanter", 1, { summonedTurn: 1 })];
  state.players[0].mana = 0;
  state.players[1].hero.armor = 0;

  const ended = applyCommand(state, { type: "end-turn", player: 0 });
  assert.equal(ended.accepted, true);
  assert.equal(ended.state.players[0].board[0]?.attack, 6);
  assert.equal(ended.state.players[1].hero.armor, 1);
  assert.ok(ended.state.events.some((event) => event.type === "turn-triggered" && event.data?.timing === "end"));
  assert.ok(ended.state.events.some((event) => event.type === "turn-triggered" && event.data?.timing === "start"));
  const turnStartIndex = ended.state.events.findIndex(
    (event) => event.type === "turn-started" && event.player === 1,
  );
  const startTriggerIndex = ended.state.events.findIndex(
    (event) => event.type === "turn-triggered" && event.player === 1 && event.data?.timing === "start",
  );
  const naturalDrawIndex = ended.state.events.findIndex(
    (event, index) => index > turnStartIndex && event.type === "card-drawn" && event.player === 1,
  );
  assert.ok(turnStartIndex >= 0 && startTriggerIndex > turnStartIndex);
  assert.ok(naturalDrawIndex > startTriggerIndex);

  const arcaneState = editableMatch(20260820);
  arcaneState.players[0].board = [
    unit("arcane-end-trigger", "neutral-ruin-stag", 0, { summonedTurn: 1 }),
    unit("arcane-one", "sun-banner-bearer", 0, { summonedTurn: 1 }),
    unit("arcane-two", "sun-lion-guard", 0, { summonedTurn: 1 }),
  ];
  const triggerBefore = arcaneState.players[0].board[0];
  const triggered = applyCommand(arcaneState, { type: "end-turn", player: 0 });
  assert.equal(triggered.accepted, true);
  assert.equal(triggered.state.players[0].board[0]?.attack, triggerBefore.attack + 1);
  assert.equal(triggered.state.players[0].board[0]?.maxHealth, triggerBefore.maxHealth);
});

test("炉石式关键词会实际改变战斗结算", () => {
  assert.ok(CARD_BY_ID["sun-horizon-hunter"]?.keywords?.includes("rush"));
  assert.ok(CARD_BY_ID["void-nightfin-raider"]?.keywords?.includes("windfury"));
  assert.ok(CARD_BY_ID["neutral-repair-sprite"]?.keywords?.includes("poisonous"));
  assert.ok(CARD_BY_ID["neutral-stonehorn"]?.keywords?.includes("reborn"));
  assert.equal(CARD_BY_ID["sun-zenith-golem"]?.onDeath?.[0]?.kind, "summon");

  const windfuryState = editableMatch();
  windfuryState.turn = 4;
  windfuryState.players[0].board = [
    unit("wind", "void-nightfin-raider", 0, {
      summonedTurn: 1,
      health: 10,
    }),
  ];
  windfuryState.players[1].board = [
    unit("wind-target", "neutral-moss-runner", 1, {
      attack: 0,
      health: 20,
      maxHealth: 20,
    }),
  ];
  const first = applyCommand(windfuryState, {
    type: "attack",
    player: 0,
    attackerId: "wind",
    target: { kind: "unit", entityId: "wind-target" },
  });
  const second = applyCommand(first.state, {
    type: "attack",
    player: 0,
    attackerId: "wind",
    target: { kind: "unit", entityId: "wind-target" },
  });
  const third = applyCommand(second.state, {
    type: "attack",
    player: 0,
    attackerId: "wind",
    target: { kind: "unit", entityId: "wind-target" },
  });
  assert.equal(first.accepted, true);
  assert.equal(second.accepted, true);
  assert.equal(third.error?.code, "attacker-exhausted");

  const poisonousState = editableMatch();
  poisonousState.turn = 4;
  poisonousState.players[0].board = [
    unit("venom", "neutral-repair-sprite", 0, {
      summonedTurn: 1,
      health: 10,
    }),
  ];
  poisonousState.players[1].board = [
    unit("large", "neutral-moss-runner", 1, {
      attack: 0,
      health: 20,
      maxHealth: 20,
    }),
  ];
  const poisonResult = applyCommand(poisonousState, {
    type: "attack",
    player: 0,
    attackerId: "venom",
    target: { kind: "unit", entityId: "large" },
  });
  assert.equal(poisonResult.accepted, true);
  assert.equal(
    poisonResult.state.players[1].board.some((entry) => entry.entityId === "large"),
    false,
  );

  const rebornState = editableMatch();
  rebornState.turn = 4;
  rebornState.players[0].board = [
    unit("finisher", "sun-dawn-scout", 0, {
      summonedTurn: 1,
      health: 10,
    }),
  ];
  rebornState.players[1].board = [
    unit("reborn", "neutral-stonehorn", 1, {
      attack: 0,
      health: 1,
      maxHealth: 1,
    }),
  ];
  const rebornResult = applyCommand(rebornState, {
    type: "attack",
    player: 0,
    attackerId: "finisher",
    target: { kind: "unit", entityId: "reborn" },
  });
  assert.equal(rebornResult.accepted, true);
  assert.equal(
    rebornResult.state.players[1].board.some(
      (entry) =>
        entry.cardId === "neutral-stonehorn" &&
        entry.health === 1 &&
        !entry.keywords.includes("reborn"),
    ),
    true,
  );
});

test("普通单位有登场限制，冲锋单位可在出牌回合攻击", () => {
  const state = editableMatch();
  state.players[0].hand = ["neutral-moss-runner", "sun-dawn-scout"];
  state.players[0].mana = 2;

  const normalPlay = applyCommand(state, {
    type: "play-card",
    player: 0,
    cardId: "neutral-moss-runner",
  });
  assert.equal(normalPlay.accepted, true);
  const normalId = normalPlay.state.players[0].board[0].entityId;
  const sleepy = applyCommand(normalPlay.state, {
    type: "attack",
    player: 0,
    attackerId: normalId,
    target: { kind: "hero", player: 1 },
  });
  assert.equal(sleepy.accepted, false);
  assert.equal(sleepy.error?.code, "attacker-summoning-sick");

  const chargePlay = applyCommand(normalPlay.state, {
    type: "play-card",
    player: 0,
    cardId: "sun-dawn-scout",
  });
  assert.equal(chargePlay.accepted, true);
  const chargeId = chargePlay.state.players[0].board[1].entityId;
  const chargeAttack = applyCommand(chargePlay.state, {
    type: "attack",
    player: 0,
    attackerId: chargeId,
    target: { kind: "hero", player: 1 },
  });
  assert.equal(chargeAttack.accepted, true);
  assert.equal(chargeAttack.state.players[1].hero.health, 27);
});

test("迅锋与坚阵修正战斗伤害，猎痕在击杀后治疗存活单位", () => {
  const state = editableMatch();
  state.turn = 4;
  state.players[0].board = [
    unit("hunter", "sun-skyfire-roc", 0, {
      health: 3,
      maxHealth: 3,
      summonedTurn: 1,
    }),
    unit("swift-pair", "neutral-moss-runner", 0),
  ];
  state.players[1].board = [
    unit("defender", "void-undertow-guard", 1, { health: 3 }),
    unit("wall-pair", "neutral-caravan-guard", 1),
  ];

  const result = applyCommand(state, {
    type: "attack",
    player: 0,
    attackerId: "hunter",
    target: { kind: "unit", entityId: "defender" },
  });
  assert.equal(result.accepted, true);
  assert.equal(
    result.state.players[1].board.some((entry) => entry.entityId === "defender"),
    false,
  );
  // The defender still deals its 2 attack before the hunt heal resolves:
  // 3 health -> 1, then the tier-1 hunt bonus restores 1.
  assert.equal(result.state.players[0].board[0].health, 2);
});

test("汲取按单位实际造成的伤害回复核心，激昂最多累计两层", () => {
  const lifesteal = editableMatch();
  lifesteal.turn = 4;
  lifesteal.players[0].hero.health = 20;
  lifesteal.players[0].board = [
    unit("drainer", "neutral-wandering-alchemist", 0, { summonedTurn: 1 }),
  ];
  const drained = applyCommand(lifesteal, {
    type: "attack",
    player: 0,
    attackerId: "drainer",
    target: { kind: "hero", player: 1 },
  });
  assert.equal(drained.state.players[0].hero.health, 23);

  const fury = editableMatch();
  fury.turn = 4;
  fury.players[0].board = [
    unit("furious", "neutral-stonehorn", 0, {
      furyStacks: 2,
      summonedTurn: 1,
    }),
  ];
  fury.players[1].board = [
    unit("striker", "neutral-clockwork-beetle", 1),
  ];
  const capped = applyCommand(fury, {
    type: "attack",
    player: 0,
    attackerId: "furious",
    target: { kind: "unit", entityId: "striker" },
  });
  assert.equal(capped.state.players[0].board[0].attack, 4);
  assert.equal(capped.state.players[0].board[0].furyStacks, 2);
});

test("汲取会按实际造成的总伤害回复，包括被护甲吸收的部分", () => {
  const state = editableMatch();
  state.turn = 4;
  state.players[0].hero.health = 20;
  state.players[0].board = [unit("armored-drainer", "neutral-wandering-alchemist", 0, {
    summonedTurn: 1,
    summoningSick: false,
  })];
  state.players[1].hero.armor = 3;

  const drained = applyCommand(state, {
    type: "attack",
    player: 0,
    attackerId: "armored-drainer",
    target: { kind: "hero", player: 1 },
  });

  assert.equal(drained.accepted, true);
  assert.equal(drained.state.players[1].hero.armor, 0);
  assert.equal(drained.state.players[1].hero.health, 30);
  assert.equal(drained.state.players[0].hero.health, 23);
});

test("单位战吼伤害会继承汲取与剧毒来源关键词", () => {
  const lifesteal = editableMatch();
  lifesteal.players[0].hero.health = 20;
  lifesteal.players[0].hand = ["astral-season-08"];
  lifesteal.players[0].mana = 10;
  const drained = applyCommand(lifesteal, {
    type: "play-card",
    player: 0,
    cardId: "astral-season-08",
    target: { kind: "hero", player: 1 },
  });
  assert.equal(drained.accepted, true);
  assert.equal(drained.state.players[1].hero.health, 27);
  assert.equal(drained.state.players[0].hero.health, 23);

  const poisonous = editableMatch();
  poisonous.players[0].hand = ["gloomwood-season-29"];
  poisonous.players[0].mana = 10;
  poisonous.players[1].board = [
    unit("battlecry-poison-target", "neutral-moss-runner", 1, {
      health: 10,
      maxHealth: 10,
    }),
  ];
  const poisoned = applyCommand(poisonous, {
    type: "play-card",
    player: 0,
    cardId: "gloomwood-season-29",
    target: { kind: "unit", entityId: "battlecry-poison-target" },
  });
  assert.equal(poisoned.accepted, true);
  assert.equal(
    poisoned.state.players[1].board.some(
      (entry) => entry.entityId === "battlecry-poison-target",
    ),
    false,
  );
  const poisonDamageEvents = poisoned.state.events.filter(
    (event) => event.type === "damage" && event.data?.entityId === "battlecry-poison-target",
  );
  assert.equal(poisonDamageEvents.length, 1);
  assert.equal(poisonDamageEvents[0]?.data?.poisonous, true);
});

test("结束回合补满法力、重置单位并抽牌", () => {
  const state = editableMatch();
  state.players[1].board = [
    unit("ready-next-turn", "neutral-clockwork-beetle", 1, {
      hasAttacked: true,
    }),
  ];
  const nextDraw = state.players[1].deck[0];
  const handSize = state.players[1].hand.length;

  const result = applyCommand(state, {
    type: "end-turn",
    player: 0,
  });
  assert.equal(result.accepted, true);
  assert.equal(result.state.activePlayer, 1);
  assert.equal(result.state.turn, 2);
  assert.equal(result.state.players[1].maxMana, 1);
  assert.equal(result.state.players[1].mana, 1);
  assert.equal(result.state.players[1].board[0].hasAttacked, false);
  assert.equal(result.state.players[1].hand.length, handSize + 1);
  assert.equal(result.state.players[1].hand.at(-1), nextDraw);
});

test("服务器超时结束回合会留下可播放的明确事件", () => {
  const state = editableMatch();
  const result = applyCommand(state, {
    type: "end-turn",
    player: 0,
    reason: "timeout",
  });
  assert.equal(result.accepted, true);
  const timeoutEvent = result.state.events.find((event) => event.type === "turn-timed-out");
  assert.ok(timeoutEvent);
  assert.equal(timeoutEvent?.data?.timeout, true);
  assert.equal(timeoutEvent?.player, 0);
  const effects = battleEventsToEffects(result.state.events);
  assert.ok(effects.some((effect) => effect.kind === "turn" && effect.label === "行动超时，自动结束"));
});

test("过载会在下一回合锁定法力水晶，并在资源区留下反馈", () => {
  const state = editableMatch();
  state.turn = 4;
  state.players[0].maxMana = 3;
  state.players[0].mana = 3;
  state.players[0].hand = ["storm-chain-discharge"];
  const cast = applyCommand(state, {
    type: "play-card",
    player: 0,
    cardId: "storm-chain-discharge",
  });
  assert.equal(cast.accepted, true);
  assert.equal(cast.state.players[0].mana, 0);
  assert.equal(cast.state.players[0].overload, 1);
  assert.ok(cast.state.events.some((event) => event.type === "mana-overloaded"));

  const opponentTurn = applyCommand(cast.state, { type: "end-turn", player: 0 });
  assert.equal(opponentTurn.accepted, true);
  const next = applyCommand(opponentTurn.state, { type: "end-turn", player: 1 });
  assert.equal(next.accepted, true);
  assert.equal(next.state.players[0].maxMana, 4);
  assert.equal(next.state.players[0].mana, 3);
  assert.equal(next.state.players[0].overload, 0);
});

test("超过最大法力的过载会先吞掉幸运币的临时法力", () => {
  const state = editableMatch();
  state.activePlayer = 0;
  state.players[0].maxMana = 2;
  state.players[0].mana = 0;
  state.players[0].overload = 4;
  state.players[0].coinAvailable = true;

  const opponentTurn = applyCommand(state, { type: "end-turn", player: 0 });
  const next = applyCommand(opponentTurn.state, { type: "end-turn", player: 1 });
  assert.equal(next.accepted, true);
  assert.equal(next.state.players[0].maxMana, 3);
  assert.equal(next.state.players[0].mana, 0);
  assert.equal(next.state.players[0].overloadLocked, 4);

  const coin = applyCommand(next.state, { type: "use-coin", player: 0 });
  assert.equal(coin.accepted, true);
  assert.equal(coin.state.players[0].mana, 0);
  assert.equal(coin.state.players[0].overloadLocked, 3);
  assert.ok(coin.state.events.some((event) => event.data?.overloadAbsorbed === 1));
});

test("幸运币按 0 费法术进入奥秘与施法后触发链", () => {
  const state = editableMatch();
  state.players[0].mana = 1;
  state.players[0].coinAvailable = true;
  state.players[1].secrets = [{
    cardId: "sun-dawn-muster",
    secretId: "sun-dawn-muster",
    name: "黎明集结",
    description: "反制下一个敌方法术。",
    trigger: "opponent-plays-spell",
    effect: { kind: "counterspell" },
  }];

  const countered = applyCommand(state, { type: "use-coin", player: 0 });
  assert.equal(countered.accepted, true);
  assert.equal(countered.state.players[0].coinAvailable, false);
  assert.equal(countered.state.players[0].mana, 1);
  assert.ok(countered.state.events.some((event) => event.type === "spell-countered"));
  assert.ok(countered.state.events.some((event) => event.data?.cardId === "the-coin"));
  assert.equal(countered.state.players[1].secrets.length, 0);

  const plain = editableMatch(102);
  plain.players[0].mana = 1;
  plain.players[0].coinAvailable = true;
  const played = applyCommand(plain, { type: "use-coin", player: 0 });
  assert.equal(played.accepted, true);
  assert.equal(played.state.players[0].coinAvailable, false);
  assert.equal(played.state.players[0].mana, 2);
  assert.equal(played.state.players[0].cardsPlayedThisTurn, 1);
  assert.ok(played.state.events.some((event) => event.type === "hero-power" && event.data?.coin === true));

  const comboState = editableMatch(103);
  comboState.players[0].mana = 3;
  comboState.players[0].coinAvailable = true;
  comboState.players[0].hand = ["neutral-calibrated-bolt"];
  const coin = applyCommand(comboState, { type: "use-coin", player: 0 });
  const combo = applyCommand(coin.state, {
    type: "play-card",
    player: 0,
    cardId: "neutral-calibrated-bolt",
    target: { kind: "hero", player: 1 },
  });
  assert.equal(combo.accepted, true);
  assert.equal(combo.state.players[1].hero.health, 24);
  assert.ok(combo.state.events.some((event) => event.type === "combo-triggered"));
});

test("连击只在本回合先使用过其他牌时触发，并在回合开始重置", () => {
  const state = editableMatch();
  state.turn = 4;
  state.players[0].maxMana = 3;
  state.players[0].mana = 3;
  state.players[0].hand = ["neutral-calibrated-bolt"];
  const first = applyCommand(state, {
    type: "play-card",
    player: 0,
    cardId: "neutral-calibrated-bolt",
    target: { kind: "hero", player: 1 },
  });
  assert.equal(first.accepted, true);
  assert.equal(first.state.players[1].hero.health, 26);
  assert.equal(first.state.players[0].cardsPlayedThisTurn, 1);

  const comboState = cloneMatch(first.state);
  comboState.players[0].hand = ["neutral-calibrated-bolt"];
  comboState.players[0].mana = 3;
  const combo = applyCommand(comboState, {
    type: "play-card",
    player: 0,
    cardId: "neutral-calibrated-bolt",
    target: { kind: "hero", player: 1 },
  });
  assert.equal(combo.accepted, true);
  assert.equal(combo.state.players[1].hero.health, 20);
  assert.ok(combo.state.events.some((event) => event.type === "combo-triggered"));

  const ended = applyCommand(combo.state, { type: "end-turn", player: 0 });
  assert.equal(ended.accepted, true);
  const reset = applyCommand(ended.state, { type: "end-turn", player: 1 });
  assert.equal(reset.accepted, true);
  assert.equal(reset.state.players[0].cardsPlayedThisTurn, 0);
});

test("法术伤害单位会强化伤害性法术，但不会改变基础单位攻击", () => {
  const state = editableMatch();
  state.turn = 3;
  state.players[0].maxMana = 2;
  state.players[0].mana = 1;
  state.players[0].board = [unit("appraiser", "neutral-relic-appraiser", 0)];
  state.players[0].hand = ["sun-focused-ray"];

  const cast = applyCommand(state, {
    type: "play-card",
    player: 0,
    cardId: "sun-focused-ray",
    target: { kind: "hero", player: 1 },
  });
  assert.equal(cast.accepted, true);
  assert.equal(cast.state.players[1].hero.health, 27);
  assert.equal(cast.state.players[0].board[0].attack, 2);
  assert.ok(
    cast.state.events.some(
      (event) => event.type === "damage" && event.data?.amount === 3,
    ),
  );

  const healingState = editableMatch(20260811);
  healingState.turn = 3;
  healingState.players[0].maxMana = 2;
  healingState.players[0].mana = 2;
  healingState.players[0].hero.health = 20;
  healingState.players[0].board = [unit("appraiser", "neutral-relic-appraiser", 0)];
  healingState.players[0].hand = ["sun-dew-blessing"];
  const healing = applyCommand(healingState, {
    type: "play-card",
    player: 0,
    cardId: "sun-dew-blessing",
    target: { kind: "hero", player: 0 },
  });
  assert.equal(healing.accepted, true);
  assert.equal(healing.state.players[0].hero.health, 24);
});

test("激昂只响应战斗伤害，不会被法术误触发", () => {
  const state = editableMatch();
  state.players[0].hand = ["sun-focused-ray"];
  state.players[0].mana = 1;
  state.players[1].board = [unit("spell-wounded-fury", "ember-scorchland-hydra", 1, {
    health: 5,
    maxHealth: 5,
    summonedTurn: 1,
  })];

  const result = applyCommand(state, {
    type: "play-card",
    player: 0,
    cardId: "sun-focused-ray",
    target: { kind: "unit", entityId: "spell-wounded-fury" },
  });
  assert.equal(result.accepted, true);
  assert.equal(result.state.players[1].board[0]?.health, 3);
  assert.equal(result.state.players[1].board[0]?.furyStacks, 0);
  assert.equal(result.state.players[1].board[0]?.attack, CARD_BY_ID["ember-scorchland-hydra"]?.attack);
});

test("法术召唤与复生召唤都会触发敌方召唤奥秘", () => {
  const spellState = editableMatch();
  spellState.turn = 4;
  spellState.players[0].maxMana = 3;
  spellState.players[0].mana = 3;
  spellState.players[0].hand = ["verdant-seedburst"];
  spellState.players[1].secrets.push({
    cardId: "ember-fireline-lockdown",
    secretId: "ember-fireline-lockdown",
    name: CARD_BY_ID["ember-fireline-lockdown"]?.name ?? "火线封锁",
    description: CARD_BY_ID["ember-fireline-lockdown"]?.description ?? "",
    trigger: "opponent-summons-unit",
    effect: { kind: "damage-enemy-hero", amount: 2 },
  });

  const spellResult = applyCommand(spellState, {
    type: "play-card",
    player: 0,
    cardId: "verdant-seedburst",
  });
  assert.equal(spellResult.accepted, true);
  assert.equal(spellResult.state.players[0].board.length, 2);
  assert.equal(spellResult.state.players[0].hero.health, 28);
  assert.equal(spellResult.state.players[1].secrets.length, 0);
  assert.equal(
    spellResult.state.events.filter(
      (event) =>
        event.type === "secret-triggered" &&
        event.data?.trigger === "opponent-summons-unit",
    ).length,
    1,
  );

  const rebornState = editableMatch();
  rebornState.turn = 4;
  rebornState.players[0].board = [
    unit("reborn-hunter", "sun-dawn-scout", 0, {
      attack: 3,
      summonedTurn: 1,
      summoningSick: false,
    }),
  ];
  rebornState.players[1].board = [
    unit("reborn-target", "neutral-stonehorn", 1, {
      attack: 0,
      health: 1,
      maxHealth: 1,
    }),
  ];
  rebornState.players[0].secrets.push({
    cardId: "ember-fireline-lockdown",
    secretId: "ember-fireline-lockdown",
    name: CARD_BY_ID["ember-fireline-lockdown"]?.name ?? "火线封锁",
    description: CARD_BY_ID["ember-fireline-lockdown"]?.description ?? "",
    trigger: "opponent-summons-unit",
    effect: { kind: "damage-enemy-hero", amount: 2 },
  });

  const attackResult = applyCommand(rebornState, {
    type: "attack",
    player: 0,
    attackerId: "reborn-hunter",
    target: { kind: "unit", entityId: "reborn-target" },
  });
  assert.equal(attackResult.accepted, true);
  assert.equal(attackResult.state.players[1].hero.health, 28);
  assert.equal(attackResult.state.players[0].secrets.length, 0);
  assert.ok(
    attackResult.state.events.some(
      (event) =>
        event.type === "unit-summoned" &&
        event.data?.reborn === true &&
        event.data?.cardId === "neutral-stonehorn",
    ),
  );
});

test("同时死亡会锁定死亡窗口并完整结算所有亡语", () => {
  const state = editableMatch();
  state.turn = 4;
  state.players[0].board = [
    unit("dead-golem-a", "sun-zenith-golem", 0, { health: 0 }),
    unit("dead-golem-b", "sun-zenith-golem", 0, { health: 0 }),
  ];

  const ended = applyCommand(state, { type: "end-turn", player: 0 });
  assert.equal(ended.accepted, true);
  assert.equal(
    ended.state.events.filter((event) => event.type === "unit-died").length,
    2,
  );
  assert.equal(
    ended.state.events.filter(
      (event) =>
        event.type === "unit-summoned" &&
        event.data?.cardId === "sun-dawn-scout",
    ).length,
    2,
  );
  assert.equal(ended.state.players[0].board.length, 2);
});

test("同一死亡窗口会先结算全部亡语，再处理复生", () => {
  const state = editableMatch();
  state.players[0].board = [
    unit("older-reborn", "ember-ashwing-phoenix", 0, {
      health: 0,
      playOrder: 1,
      rebornUsed: false,
    }),
    unit("later-deathrattle", "sun-zenith-golem", 0, {
      health: 0,
      playOrder: 2,
    }),
  ];

  const ended = applyCommand(state, { type: "end-turn", player: 0 });
  assert.equal(ended.accepted, true);
  const laterDeathIndex = ended.state.events.findIndex(
    (event) => event.type === "unit-died" && event.data?.entityId === "later-deathrattle",
  );
  const laterDeathrattleIndex = ended.state.events.findIndex(
    (event) => event.type === "unit-summoned" && event.data?.cardId === "sun-dawn-scout",
  );
  const rebornIndex = ended.state.events.findIndex(
    (event) => event.type === "unit-summoned" && event.data?.reborn === true,
  );
  assert.ok(laterDeathIndex >= 0);
  assert.ok(laterDeathrattleIndex > laterDeathIndex);
  assert.ok(rebornIndex > laterDeathrattleIndex);
});

test("跨双方同时死亡时，亡语按入场顺序而不是玩家编号结算", () => {
  const state = editableMatch();
  state.turn = 4;
  // Player 1's body entered first, then player 0's body.  The board arrays
  // intentionally use the opposite owner order to catch player-index sorting.
  state.players[1].board = [unit("older", "sun-zenith-golem", 1, {
    health: 0,
    playOrder: 1,
  })];
  state.players[0].board = [unit("newer", "verdant-ancient-bough-guardian", 0, {
    health: 0,
    playOrder: 2,
  })];

  const ended = applyCommand(state, { type: "end-turn", player: 0 });
  assert.equal(ended.accepted, true);
  const deathNames = ended.state.events
    .filter((event) => event.type === "unit-died")
    .map((event) => event.message);
  assert.deepEqual(deathNames.slice(0, 2), ["正午晶铠像 被击败。", "古枝壁垒 被击败。"]);
  const summonEvents = ended.state.events.filter((event) => event.type === "unit-summoned");
  assert.equal(summonEvents[0]?.data?.cardId, "sun-dawn-scout");
  assert.equal(summonEvents[1]?.data?.cardId, "verdant-seedsong-sprite");
});

test("范围伤害会同时命中敌方核心与所有敌方单位", () => {
  const state = editableMatch();
  state.turn = 5;
  state.players[0].maxMana = 4;
  state.players[0].mana = 4;
  state.players[0].board = [unit("appraiser", "neutral-relic-appraiser", 0)];
  state.players[0].hand = ["void-ink-storm"];
  state.players[1].board = [
    unit("enemy-one", "void-undertow-guard", 1, { health: 4 }),
    unit("enemy-two", "neutral-caravan-guard", 1, { health: 3 }),
  ];

  const cast = applyCommand(state, {
    type: "play-card",
    player: 0,
    cardId: "void-ink-storm",
  });
  assert.equal(cast.accepted, true);
  assert.equal(cast.state.players[1].hero.health, 28);
  assert.equal(cast.state.players[1].board[0].health, 2);
  assert.equal(cast.state.players[1].board[1].health, 1);
  assert.equal(
    cast.state.events.filter(
      (event) => event.type === "damage" && event.data?.amount === 2,
    ).length,
    3,
  );
});

test("英雄被范围法术击至 0 点生命时，整张法术文本仍会先完成结算", () => {
  const state = editableMatch();
  state.players[0].hand = ["void-ink-storm"];
  state.players[0].mana = 4;
  state.players[1].hero.health = 1;
  state.players[1].board = [unit("survivor", "neutral-moss-runner", 1, {
    attack: 1,
    health: 2,
    maxHealth: 2,
    summonedTurn: 1,
    frozenTurns: 0,
  })];

  const result = applyCommand(state, {
    type: "play-card",
    player: 0,
    cardId: "void-ink-storm",
  });

  assert.equal(result.accepted, true);
  assert.equal(result.state.phase, "game-over");
  assert.equal(result.state.winner, 0);
  assert.equal(result.state.players[1].board[0]?.health, 1);
  assert.equal(result.state.players[1].board[0]?.frozenTurns, 1);
  const damageIndex = result.state.events.findIndex(
    (event) => event.type === "damage" && event.data?.entityId === "survivor",
  );
  const freezeIndex = result.state.events.findIndex(
    (event) =>
      event.type === "unit-buffed" &&
      event.data?.entityId === "survivor" &&
      event.data?.frozenTurns === 1,
  );
  const endIndex = result.state.events.findIndex((event) => event.type === "match-ended");
  assert.ok(damageIndex >= 0 && freezeIndex > damageIndex && endIndex > freezeIndex);
});

test("英雄在同一效果阶段降至 0 后仍可于死亡创建步骤前恢复", () => {
  const state = editableMatch();
  state.players[0].hand = ["astral-lucid-script"];
  state.players[0].mana = 2;
  state.players[0].deck = [];
  state.players[0].fatigue = 0;
  state.players[0].hero.health = 1;

  const result = applyCommand(state, {
    type: "play-card",
    player: 0,
    cardId: "astral-lucid-script",
    target: { kind: "hero", player: 0 },
  });

  assert.equal(result.accepted, true);
  assert.equal(result.state.phase, "main");
  assert.equal(result.state.result, null);
  assert.equal(result.state.players[0].hero.health, 2);
  const fatigueIndex = result.state.events.findIndex((event) => event.type === "fatigue");
  const healingIndex = result.state.events.findIndex((event) => event.type === "healing");
  assert.ok(fatigueIndex >= 0 && healingIndex > fatigueIndex);
  assert.equal(result.state.events.some((event) => event.type === "match-ended"), false);
});

test("死亡创建步骤标记的英雄不能被后续亡语阶段救回", () => {
  const state = editableMatch();
  state.players[0].hand = ["void-ink-storm"];
  state.players[0].mana = 4;
  state.players[0].hero.health = 1;
  state.players[0].secrets = [{
    cardId: "astral-constellation-call",
    secretId: "death-window-heal",
    name: "星群呼唤",
    description: "",
    trigger: "opponent-summons-unit",
    effect: { kind: "heal-friendly-hero", amount: 3 },
  }];
  state.players[1].secrets = [{
    cardId: "ember-fireline-lockdown",
    secretId: "primary-lethal",
    name: "火线封锁",
    description: "",
    trigger: "opponent-plays-spell",
    effect: { kind: "damage-enemy-hero", amount: 2 },
  }];
  state.players[1].board = [unit("deathrattle-heal-window", "sun-zenith-golem", 1, {
    health: 1,
    maxHealth: 1,
    keywords: ["deathrattle"],
    summonedTurn: 1,
    frozenTurns: 0,
  })];

  const result = applyCommand(state, {
    type: "play-card",
    player: 0,
    cardId: "void-ink-storm",
  });

  assert.equal(result.accepted, true);
  assert.equal(result.state.phase, "game-over");
  assert.deepEqual(result.state.result, { winner: 1, reason: "hero-defeated" });
  assert.equal(result.state.players[0].hero.health, 0);
  assert.equal(result.state.players[0].secrets.length, 0);
  const diedIndex = result.state.events.findIndex(
    (event) => event.type === "unit-died" && event.data?.entityId === "deathrattle-heal-window",
  );
  const summonedIndex = result.state.events.findIndex(
    (event) => event.type === "unit-summoned" && event.data?.cardId === "sun-dawn-scout",
  );
  const healSecretIndex = result.state.events.findIndex(
    (event) => event.type === "secret-triggered" && event.data?.secretId === "death-window-heal",
  );
  const endedIndex = result.state.events.findIndex((event) => event.type === "match-ended");
  assert.ok(
    diedIndex >= 0 &&
    summonedIndex > diedIndex &&
    healSecretIndex > summonedIndex &&
    endedIndex > healSecretIndex,
  );
  assert.equal(
    result.state.events.some(
      (event) => event.type === "healing" && event.data?.target?.kind === "hero",
    ),
    false,
  );
});

test("后续亡语阶段令另一英雄致命时，双方死亡仍结算为平局", () => {
  const state = editableMatch();
  state.players[0].hand = ["void-ink-storm"];
  state.players[0].mana = 4;
  state.players[0].hero.health = 1;
  state.players[0].secrets = [
    {
      cardId: "ember-fireline-lockdown",
      secretId: "death-window-counterlethal",
      name: "火线封锁",
      description: "",
      trigger: "opponent-summons-unit",
      effect: { kind: "damage-enemy-hero", amount: 2 },
    },
    {
      cardId: "astral-constellation-call",
      secretId: "death-window-late-heal",
      name: "星群呼唤",
      description: "",
      trigger: "opponent-summons-unit",
      effect: { kind: "heal-friendly-hero", amount: 3 },
    },
  ];
  state.players[1].hero.health = 3;
  state.players[1].secrets = [{
    cardId: "ember-fireline-lockdown",
    secretId: "primary-lethal-for-draw",
    name: "火线封锁",
    description: "",
    trigger: "opponent-plays-spell",
    effect: { kind: "damage-enemy-hero", amount: 2 },
  }];
  state.players[1].board = [unit("deathrattle-draw-window", "sun-zenith-golem", 1, {
    health: 1,
    maxHealth: 1,
    keywords: ["deathrattle"],
    summonedTurn: 1,
    frozenTurns: 0,
  })];

  const result = applyCommand(state, {
    type: "play-card",
    player: 0,
    cardId: "void-ink-storm",
  });

  assert.equal(result.accepted, true);
  assert.equal(result.state.players[0].hero.health, 0);
  assert.equal(result.state.players[1].hero.health, 0);
  assert.deepEqual(result.state.result, { winner: null, reason: "draw" });
  assert.deepEqual(
    result.state.events
      .filter((event) => event.type === "secret-triggered")
      .map((event) => event.data?.secretId),
    ["primary-lethal-for-draw", "death-window-counterlethal", "death-window-late-heal"],
  );
  assert.equal(
    result.state.events.some(
      (event) => event.type === "healing" && event.data?.target?.kind === "hero",
    ),
    false,
  );
  assert.equal(result.state.events.at(-1)?.type, "match-ended");
});

test("致命法术仍会完成连击与施法后触发", () => {
  const state = editableMatch();
  state.turn = 5;
  state.players[0].hand = ["neutral-calibrated-bolt"];
  state.players[0].mana = 3;
  state.players[0].cardsPlayedThisTurn = 1;
  state.players[0].board = [unit("spell-trigger", "storm-capacitor-sentry", 0, {
    summonedTurn: 1,
    summoningSick: false,
  })];
  state.players[1].hero.health = 4;

  const result = applyCommand(state, {
    type: "play-card",
    player: 0,
    cardId: "neutral-calibrated-bolt",
    target: { kind: "hero", player: 1 },
  });

  assert.equal(result.accepted, true);
  assert.equal(result.state.phase, "game-over");
  assert.deepEqual(result.state.result, { winner: 0, reason: "hero-defeated" });
  assert.equal(result.state.players[1].hero.health, 0);
  assert.equal(result.state.players[0].hero.armor, 1);
  const damageEvents = result.state.events.filter((event) => event.type === "damage");
  assert.deepEqual(
    damageEvents.map((event) => event.data?.requestedAmount),
    [4, 2],
  );
  const comboIndex = result.state.events.findIndex((event) => event.type === "combo-triggered");
  const triggerIndex = result.state.events.findIndex(
    (event) => event.type === "card-triggered" && event.data?.entityId === "spell-trigger",
  );
  const endIndex = result.state.events.findIndex((event) => event.type === "match-ended");
  assert.ok(comboIndex >= 0 && triggerIndex > comboIndex && endIndex > triggerIndex);
});

test("同一张范围法术的后续效果先结算，再进入亡语窗口", () => {
  const state = editableMatch();
  state.phase = "main";
  state.activePlayer = 0;
  state.turn = 4;
  state.players[0].hand = ["void-ink-storm"];
  state.players[0].mana = 4;
  state.players[1].board = [
    unit("aoe-death", "sun-zenith-golem", 1, {
      health: 1,
      keywords: ["taunt", "deathrattle"],
    }),
  ];

  const result = applyCommand(state, {
    type: "play-card",
    player: 0,
    cardId: "void-ink-storm",
  });

  assert.equal(result.accepted, true);
  assert.ok(result.state.players[1].board.some((entry) => entry.cardId === "sun-dawn-scout"));
  const diedIndex = result.state.events.findIndex(
    (event) => event.type === "unit-died" && event.data?.entityId === "aoe-death",
  );
  const rebornIndex = result.state.events.findIndex(
    (event) => event.type === "unit-summoned" && event.data?.cardId === "sun-dawn-scout",
  );
  assert.ok(diedIndex >= 0 && rebornIndex > diedIndex);
  assert.equal(
    result.state.events.some(
      (event) => event.type === "unit-buffed" && event.data?.entityId === "aoe-death",
    ),
    false,
  );
});

test("沉默会移除临时增益与关键词，并阻止沉默单位触发亡语", () => {
  const state = editableMatch();
  state.turn = 5;
  state.players[0].maxMana = 2;
  state.players[0].mana = 2;
  state.players[0].board = [
    unit("silence-caster", "sun-skyfire-roc", 0, {
      attack: 10,
      summonedTurn: 1,
      summoningSick: false,
    }),
  ];
  state.players[0].hand = ["void-pressure-spike"];
  state.players[1].board = [
    unit("silenced-golem", "sun-zenith-golem", 1, {
      attack: 6,
      health: 9,
      maxHealth: 9,
      keywords: ["taunt", "deathrattle"],
    }),
  ];

  const silenced = applyCommand(state, {
    type: "play-card",
    player: 0,
    cardId: "void-pressure-spike",
    target: { kind: "unit", entityId: "silenced-golem" },
  });
  assert.equal(silenced.accepted, true);
  const target = silenced.state.players[1].board[0];
  assert.equal(target.attack, 4);
  assert.equal(target.health, 4);
  assert.equal(target.maxHealth, 7);
  assert.deepEqual(target.keywords, []);
  assert.equal(target.silenced, true);
  assert.ok(silenced.state.events.some((event) => event.type === "unit-silenced"));

  const killed = applyCommand(silenced.state, {
    type: "attack",
    player: 0,
    attackerId: "silence-caster",
    target: { kind: "unit", entityId: "silenced-golem" },
  });
  assert.equal(killed.accepted, true);
  assert.equal(killed.state.players[1].board.length, 0);
  assert.equal(
    killed.state.events.some(
      (event) => event.type === "unit-summoned" && event.data?.cardId === "sun-dawn-scout",
    ),
    false,
  );
});

test("阵营英雄技能各有差异，且每回合只能使用一次", () => {
  const state = editableMatch();
  assert.equal(state.players[0].heroPower.name, "日耀修复");
  state.players[0].hero.health = 25;
  state.players[0].mana = HERO_POWER_COST;
  const first = applyCommand(state, {
    type: "hero-power",
    player: 0,
    target: { kind: "hero", player: 0 },
  });
  assert.equal(first.accepted, true);
  assert.equal(first.state.players[0].mana, 0);
  assert.equal(first.state.players[0].hero.health, 27);
  assert.equal(first.state.players[0].heroPowerUsed, true);

  const repeat = applyCommand(first.state, { type: "hero-power", player: 0 });
  assert.equal(repeat.accepted, false);
  assert.equal(repeat.error?.code, "hero-power-used");

  const next = applyCommand(first.state, { type: "end-turn", player: 0 });
  assert.equal(next.accepted, true);
  assert.equal(next.state.players[1].heroPowerUsed, false);

  let tide = cloneMatch(createMatch({
    decks: [DEFAULT_OPPONENT_DECK, DEFAULT_STARTER_DECK],
  }));
  for (const player of [0, 1] as const) {
    const mulligan = applyCommand(tide, {
      type: "mulligan",
      player,
      cardIndexes: [],
    });
    assert.equal(mulligan.accepted, true);
    tide = mulligan.state;
  }
  assert.equal(tide.players[0].heroPower.name, "潮汐脉冲");
  tide.players[0].mana = HERO_POWER_COST;
  const tidePower = applyCommand(tide, { type: "hero-power", player: 0 });
  assert.equal(tidePower.accepted, true);
  assert.equal(tidePower.state.players[1].hero.health, 29);
});

test("曜光英雄技能可以选择受伤的友方单位，烬火英雄技能可以点杀敌方单位", () => {
  const radiant = editableMatch();
  radiant.players[0].mana = HERO_POWER_COST;
  radiant.players[0].board = [unit("wounded-radiant", "sun-mirror-warden", 0, {
    summonedTurn: 1,
    health: 1,
    maxHealth: 4,
  })];
  const healed = applyCommand(radiant, {
    type: "hero-power",
    player: 0,
    target: { kind: "unit", entityId: "wounded-radiant" },
  });
  assert.equal(healed.accepted, true);
  assert.equal(healed.state.players[0].board[0]?.health, 3);

  const fullHealth = editableMatch(203);
  fullHealth.players[0].mana = HERO_POWER_COST;
  const spent = applyCommand(fullHealth, {
    type: "hero-power",
    player: 0,
    target: { kind: "hero", player: 0 },
  });
  assert.equal(spent.accepted, true);
  assert.equal(spent.state.players[0].mana, 0);
  assert.equal(spent.state.players[0].heroPowerUsed, true);
  assert.equal(spent.state.players[0].hero.health, 30);
  assert.equal(spent.state.events.some((event) => event.type === "healing"), false);

  const emberDeck = CARD_CATALOG
    .filter((card) => card.faction === "烬火")
    .slice(0, 15)
    .flatMap((card) => [card.id, card.id]);
  const ember = editableMatchWithDecks([emberDeck, DEFAULT_OPPONENT_DECK]);
  ember.players[0].mana = HERO_POWER_COST;
  ember.players[1].board = [unit("ember-target", "neutral-moss-runner", 1, {
    summonedTurn: 1,
    health: 2,
    maxHealth: 2,
  })];
  const destroyed = applyCommand(ember, {
    type: "hero-power",
    player: 0,
    target: { kind: "unit", entityId: "ember-target" },
  });
  assert.equal(destroyed.accepted, true);
  assert.equal(destroyed.state.players[1].board.length, 0);
  const invalidState = editableMatchWithDecks([emberDeck, DEFAULT_OPPONENT_DECK]);
  invalidState.players[0].mana = HERO_POWER_COST;
  const invalidHero = applyCommand(invalidState, {
    type: "hero-power",
    player: 0,
    target: { kind: "hero", player: 1 },
  });
  assert.equal(invalidHero.accepted, false);
  assert.equal(invalidHero.error?.code, "invalid-target");
});

test("AI 只通过命令执行出牌、攻击并结束回合", () => {
  const state = editableMatch();
  state.activePlayer = 1;
  state.turn = 6;
  state.players[1].mana = 3;
  state.players[1].maxMana = 3;
  state.players[1].hand = ["void-chill-needle", "void-mist-lurker"];
  state.players[1].board = [
    unit("ai-attacker", "neutral-clockwork-beetle", 1, {
      summonedTurn: 2,
    }),
  ];

  const after = runAiTurn(state, 1);
  assert.equal(after.activePlayer, 0);
  assert.equal(after.turn, 7);
  assert.equal(after.players[0].hero.health, 24);
  assert.ok(after.players[1].board.some((entry) => entry.cardId === "void-mist-lurker"));
  assert.ok(after.events.some((event) => event.type === "card-played"));
  assert.ok(after.events.some((event) => event.type === "attack"));
  assert.ok(after.events.some((event) => event.type === "turn-ended"));
});

test("AI 回合可以按已接受命令逐步回放", () => {
  const state = editableMatch();
  state.activePlayer = 1;
  state.turn = 5;
  state.players[1].mana = 5;
  state.players[1].maxMana = 5;
  state.players[1].hand = ["void-mist-lurker", "void-chill-needle"];
  state.players[1].board = [];

  const steps: Array<{ state: MatchState; type: string }> = [];
  const after = runAiTurn(state, 1, (stepState, command) => {
    steps.push({ state: stepState, type: command.type });
  });

  assert.ok(steps.length >= 2, "AI 至少应产生一个行动和结束回合步骤");
  assert.equal(steps.at(-1)?.state.events.length, after.events.length);
  assert.equal(steps.at(-1)?.type, "end-turn");
  assert.ok(steps.some((step) => step.type === "play-card"));
  assert.ok(steps.every((step, index) => index === 0 || step.state.events.length > (steps[index - 1]?.state.events.length ?? 0)));
});

test("AI 先手会在人类确认起手后完成首回合并交回行动窗", () => {
  let state = createMatch({ seed: 20260820, startingPlayer: 1 });
  const aiMulligan = applyCommand(state, {
    type: "mulligan",
    player: 1,
    cardIndexes: chooseAiMulliganIndexes(state, 1),
  });
  assert.equal(aiMulligan.accepted, true);
  state = aiMulligan.state;
  assert.equal(shouldScheduleLocalAiTurn(state, false), false, "人类尚未确认时不能提前调度 AI");

  const humanMulligan = applyCommand(state, {
    type: "mulligan",
    player: 0,
    cardIndexes: [],
  });
  assert.equal(humanMulligan.accepted, true);
  state = humanMulligan.state;
  assert.equal(state.phase, "main");
  assert.equal(state.activePlayer, 1);
  assert.equal(shouldScheduleLocalAiTurn(state, false), true);
  assert.equal(shouldScheduleLocalAiTurn(state, true), false, "联机对局必须等待服务器而非本地 AI");

  const replay = planAiTurnReplay(state, 1);
  assert.ok(replay.steps.length > 0);
  assert.equal(replay.steps.length, replay.commands.length);
  assert.equal(replay.commands.at(-1)?.type, "end-turn");
  assert.equal(replay.finalState.phase, "main");
  assert.equal(replay.finalState.activePlayer, 0);
  assert.equal(replay.finalState.turn, 2);
  assert.equal(state.activePlayer, 1, "回放规划不能修改起始快照");
});

test("AI 会为目标型英雄技能选择可见的最佳单位", () => {
  const emberDeck = CARD_CATALOG
    .filter((card) => card.faction === "烬火")
    .slice(0, 15)
    .flatMap((card) => [card.id, card.id]);
  const state = editableMatchWithDecks([DEFAULT_OPPONENT_DECK, emberDeck]);
  state.activePlayer = 1;
  state.turn = 4;
  state.players[1].mana = HERO_POWER_COST;
  state.players[1].maxMana = 4;
  state.players[1].hand = [];
  state.players[1].coinAvailable = false;
  state.players[1].board = [];
  state.players[0].board = [unit("ai-power-target", "neutral-moss-runner", 0, {
    summonedTurn: 1,
    health: 2,
    maxHealth: 2,
  })];

  const after = runAiTurn(state, 1);
  assert.equal(after.activePlayer, 0);
  assert.equal(after.players[0].board.length, 0);
  assert.ok(after.events.some((event) => event.type === "hero-power"));
});

test("AI 会使用幸运币部署比当前法力高 1 费的单位", () => {
  const state = editableMatch();
  state.activePlayer = 1;
  state.turn = 2;
  state.players[1].mana = 1;
  state.players[1].maxMana = 1;
  state.players[1].coinAvailable = true;
  state.players[1].hand = ["void-undertow-guard"];
  state.players[1].board = [];

  const after = runAiTurn(state, 1);
  assert.equal(after.players[1].coinAvailable, false);
  assert.ok(after.players[1].board.some((entry) => entry.cardId === "void-undertow-guard"));
  assert.ok(after.events.some((event) => event.type === "hero-power" && event.data?.coin === true));
});

test("AI 会统计整条战线的伤害完成合计斩杀", () => {
  const state = editableMatch();
  state.activePlayer = 1;
  state.turn = 6;
  state.players[1].mana = 0;
  state.players[1].hand = [];
  state.players[1].coinAvailable = false;
  state.players[1].board = [
    unit("ai-lethal-a", "neutral-clockwork-beetle", 1, { summonedTurn: 1, summoningSick: false }),
    unit("ai-lethal-b", "neutral-clockwork-beetle", 1, { summonedTurn: 1, summoningSick: false }),
  ];
  state.players[0].hero.health = 6;
  state.players[0].board = [unit("lethal-decoy", "neutral-moss-runner", 0, {
    summonedTurn: 1,
    attack: 1,
    health: 1,
    maxHealth: 1,
  })];

  const after = runAiTurn(state, 1);
  assert.equal(after.phase, "game-over");
  assert.equal(after.winner, 1);
  assert.equal(after.players[0].board.length, 1);
});

test("AI 会把定向直伤与战线伤害合并计算斩杀", () => {
  const state = editableMatch();
  state.activePlayer = 1;
  state.turn = 6;
  state.players[1].mana = 1;
  state.players[1].hand = ["void-chill-needle"];
  state.players[1].coinAvailable = false;
  state.players[1].board = [unit("combo-attacker", "neutral-clockwork-beetle", 1, {
    summonedTurn: 1,
    summoningSick: false,
  })];
  state.players[0].hero.health = 5;
  state.players[0].board = [unit("combo-decoy", "neutral-moss-runner", 0, {
    summonedTurn: 1,
    attack: 1,
    health: 1,
    maxHealth: 1,
  })];

  const after = runAiTurn(state, 1);
  assert.equal(after.phase, "game-over");
  assert.equal(after.winner, 1);
  assert.equal(after.players[0].board.length, 1);
});

test("AI 会用足够的小单位交换，保留大单位打击核心", () => {
  const state = editableMatch();
  state.activePlayer = 1;
  state.turn = 6;
  state.players[1].mana = 0;
  state.players[1].hand = [];
  state.players[1].coinAvailable = false;
  state.players[1].board = [
    unit("ai-large", "neutral-stonehorn", 1, {
      summonedTurn: 1,
      summoningSick: false,
      attack: 8,
      health: 8,
      maxHealth: 8,
    }),
    unit("ai-small", "neutral-clockwork-beetle", 1, {
      summonedTurn: 1,
      summoningSick: false,
      attack: 2,
      health: 2,
      maxHealth: 2,
    }),
  ];
  state.players[0].board = [unit("small-defender", "neutral-moss-runner", 0, {
    summonedTurn: 1,
    attack: 2,
    health: 2,
    maxHealth: 2,
  })];

  const after = runAiTurn(state, 1);
  assert.equal(after.players[0].board.length, 0);
  assert.equal(after.players[0].hero.health, 22);
  assert.ok(after.players[1].board.some((entry) => entry.entityId === "ai-large"));
});

test("AI 不会把护盾单位误判为一次可击杀目标", () => {
  const state = editableMatch();
  state.activePlayer = 1;
  state.turn = 6;
  state.players[1].mana = 0;
  state.players[1].hand = [];
  state.players[1].coinAvailable = false;
  state.players[1].board = [unit("shield-reader", "neutral-clockwork-beetle", 1, {
    summonedTurn: 1,
    summoningSick: false,
    attack: 3,
    health: 4,
    maxHealth: 4,
  })];
  state.players[0].board = [
    unit("shield-decoy", "sun-mirror-warden", 0, {
      summonedTurn: 1,
      keywords: ["shield"],
      attack: 3,
      health: 1,
      maxHealth: 1,
    }),
    unit("plain-target", "neutral-moss-runner", 0, {
      summonedTurn: 1,
      attack: 2,
      health: 2,
      maxHealth: 2,
    }),
  ];

  const after = runAiTurn(state, 1);
  assert.equal(after.players[0].board.some((entry) => entry.entityId === "plain-target"), false);
  assert.equal(after.players[0].board.some((entry) => entry.entityId === "shield-decoy"), true);
});

test("AI 会在出牌前使用直伤英雄技能完成斩杀", () => {
  const state = editableMatch();
  state.activePlayer = 1;
  state.turn = 5;
  state.players[1].mana = 2;
  state.players[1].maxMana = 2;
  state.players[1].hand = ["void-undertow-guard"];
  state.players[1].coinAvailable = false;
  state.players[1].board = [];
  state.players[0].hero.health = 1;

  const after = runAiTurn(state, 1);
  assert.equal(after.phase, "game-over");
  assert.equal(after.winner, 1);
  assert.equal(after.players[1].hand.includes("void-undertow-guard"), true);
  assert.ok(after.events.some((event) => event.type === "hero-power"));
});

test("AI 会为组合斩杀预留英雄技能法力", () => {
  const state = editableMatch();
  state.activePlayer = 1;
  state.turn = 6;
  state.players[1].mana = 3;
  state.players[1].maxMana = 3;
  state.players[1].hand = ["void-chill-needle", "void-deepwater-draught"];
  state.players[1].coinAvailable = false;
  state.players[1].board = [unit("reserved-power-attacker", "neutral-moss-runner", 1, {
    summonedTurn: 1,
    summoningSick: false,
    attack: 2,
  })];
  state.players[0].hero.health = 5;

  const after = runAiTurn(state, 1);
  assert.equal(after.phase, "game-over");
  assert.equal(after.winner, 1);
  assert.ok(after.events.some((event) => event.type === "hero-power"));
});

test("AI 会用定向伤害战吼清除可击杀的高威胁单位", () => {
  const emberDeck = CARD_CATALOG
    .filter((card) => card.faction === "烬火")
    .slice(0, 15)
    .flatMap((card) => [card.id, card.id]);
  const state = editableMatchWithDecks([DEFAULT_OPPONENT_DECK, emberDeck]);
  state.activePlayer = 1;
  state.turn = 6;
  state.players[1].mana = 5;
  state.players[1].maxMana = 5;
  state.players[1].hand = ["ember-oath-pyromancer"];
  state.players[1].coinAvailable = false;
  state.players[1].board = [];
  state.players[0].board = [unit("battlecry-threat", "neutral-moss-runner", 0, {
    summonedTurn: 1,
    attack: 8,
    health: 2,
    maxHealth: 2,
  })];

  const after = runAiTurn(state, 1);
  assert.equal(after.players[0].board.length, 0);
  assert.ok(after.players[1].board.some((entry) => entry.cardId === "ember-oath-pyromancer"));
});

test("AI 会执行四个风怒单位的全部八次攻击", () => {
  const state = editableMatch();
  state.activePlayer = 1;
  state.turn = 8;
  state.players[1].mana = 0;
  state.players[1].hand = [];
  state.players[1].coinAvailable = false;
  state.players[1].board = Array.from({ length: 4 }, (_, index) =>
    unit(`windfury-${index}`, "neutral-moss-runner", 1, {
      summonedTurn: 1,
      summoningSick: false,
      attack: 1,
      keywords: ["windfury"],
      attacksMade: 0,
      hasAttacked: false,
    }));

  const after = runAiTurn(state, 1);
  const attacks = after.events.filter((event) => event.type === "attack");
  assert.equal(attacks.length, 8);
  assert.equal(after.players[0].hero.health, 22);
});

test("AI 会优先执行可识别的斩杀，而不是继续交换单位", () => {
  const state = editableMatch();
  state.activePlayer = 1;
  state.turn = 6;
  state.players[1].mana = 0;
  state.players[1].maxMana = 6;
  state.players[1].hand = [];
  state.players[1].coinAvailable = false;
  state.players[1].board = [unit("ai-lethal", "neutral-clockwork-beetle", 1, {
    summonedTurn: 1,
    attack: 3,
    health: 2,
    maxHealth: 2,
  })];
  state.players[0].hero.health = 3;
  state.players[0].board = [unit("defender", "neutral-stonehorn", 0, {
    summonedTurn: 1,
  })];

  const after = runAiTurn(state, 1);
  assert.equal(after.phase, "game-over");
  assert.equal(after.winner, 1);
  assert.equal(after.players[0].hero.health, 0);
  assert.ok(after.events.some((event) => event.type === "attack"));
});

test("AI 的定向直伤会先检查英雄斩杀，再处理低血量单位", () => {
  const state = editableMatch();
  state.activePlayer = 1;
  state.turn = 4;
  state.players[1].mana = 1;
  state.players[1].maxMana = 4;
  state.players[1].hand = ["void-chill-needle"];
  state.players[1].board = [];
  state.players[0].hero.health = 2;
  state.players[0].board = [unit("small-target", "neutral-moss-runner", 0, {
    summonedTurn: 1,
    attack: 1,
    health: 1,
    maxHealth: 1,
  })];

  const after = runAiTurn(state, 1);
  assert.equal(after.phase, "game-over");
  assert.equal(after.winner, 1);
  assert.equal(after.players[0].hero.health, 0);
  assert.equal(after.players[0].board.length, 1);
  assert.ok(after.events.some((event) => event.type === "card-played"));
});

test("AI 在无法击杀敌方单位时会转火核心，避免无意义的撞墙", () => {
  const state = editableMatch();
  state.activePlayer = 1;
  state.turn = 6;
  state.players[1].mana = 0;
  state.players[1].maxMana = 6;
  state.players[1].hand = [];
  state.players[1].coinAvailable = false;
  state.players[1].board = [unit("ai-pressure", "neutral-clockwork-beetle", 1, {
    summonedTurn: 1,
    attack: 3,
    health: 2,
  })];
  state.players[0].board = [unit("large-defender", "neutral-stonehorn", 0, {
    summonedTurn: 1,
  })];

  const after = runAiTurn(state, 1);
  assert.equal(after.activePlayer, 0);
  assert.equal(after.players[0].hero.health, 27);
  assert.equal(after.players[0].board[0]?.health, 5);
});

test("AI 会跳过没有可见目标的控制牌并继续部署其他牌", () => {
  const state = editableMatch();
  state.activePlayer = 1;
  state.turn = 4;
  state.players[1].mana = 2;
  state.players[1].maxMana = 2;
  state.players[1].hand = ["void-pressure-spike", "void-mist-lurker"];
  state.players[0].board = [unit("hidden-target", "astral-eclipse-stalker", 0, {
    summonedTurn: 1,
    stealthActive: true,
    keywords: ["stealth"],
  })];

  const after = runAiTurn(state, 1);
  assert.ok(
    after.events.some(
      (event) => event.type === "card-played" && event.data?.cardId === "void-mist-lurker",
    ),
  );
  assert.equal(
    after.events.some(
      (event) => event.type === "card-played" && event.data?.cardId === "void-pressure-spike",
    ),
    false,
  );
  assert.ok(after.players[1].board.some((entry) => entry.cardId === "void-mist-lurker"));
  assert.equal(after.activePlayer, 0);
});

test("AI 使用发现卡后会自动选择并继续完成回合", () => {
  const state = editableMatch();
  state.activePlayer = 1;
  state.turn = 4;
  state.players[1].mana = 3;
  state.players[1].maxMana = 3;
  state.players[1].hand = ["void-moonpool-mutation"];

  const after = runAiTurn(state, 1);
  assert.equal(after.phase, "main");
  assert.equal(after.activePlayer, 0);
  assert.equal(after.discover, null);
  assert.ok(after.players[1].hand.some((cardId) => [
    "void-mist-lurker",
    "void-undertow-guard",
    "void-chill-needle",
  ].includes(cardId)));
  assert.ok(after.events.some((event) => event.type === "discover-started"));
  assert.ok(after.events.some((event) => event.type === "discover-chosen"));
});

test("AI 会自动完成抉择并继续结束回合", () => {
  const state = editableMatch();
  state.activePlayer = 1;
  state.turn = 4;
  state.players[1].mana = 2;
  state.players[1].maxMana = 2;
  state.players[1].hand = ["neutral-field-reinforcement"];
  state.players[1].board = [unit("ai-choose-target", "neutral-moss-runner", 1, {
    summonedTurn: 1,
  })];

  const after = runAiTurn(state, 1);
  assert.equal(after.phase, "main");
  assert.equal(after.activePlayer, 0);
  assert.equal(after.chooseOne, null);
  assert.ok(after.players[1].board[0]?.maxHealth === 5 || after.players[1].board[0]?.attack === 4);
  assert.ok(after.events.some((event) => event.type === "choose-one-started"));
  assert.ok(after.events.some((event) => event.type === "choose-one-chosen"));
});

test("AI 的抉择会根据受伤单位选择更高生命分支", () => {
  const state = editableMatch();
  state.activePlayer = 1;
  state.turn = 4;
  state.players[1].mana = 2;
  state.players[1].maxMana = 2;
  state.players[1].hand = ["neutral-field-reinforcement"];
  state.players[1].board = [unit("ai-wounded-choice", "neutral-moss-runner", 1, {
    summonedTurn: 1,
    health: 1,
    maxHealth: 2,
  })];

  const after = runAiTurn(state, 1);
  const chosen = after.events.find((event) => event.type === "choose-one-chosen");
  assert.equal(chosen?.data?.optionLabel, "坚守阵线（+1/+3）");
  assert.equal(after.players[1].board[0]?.maxHealth, 5);
  assert.equal(after.players[1].board[0]?.attack, 2);
});

test("英雄生命归零立即结算胜负", () => {
  const state = editableMatch();
  state.players[0].hand = ["sun-focused-ray"];
  state.players[0].mana = 1;
  state.players[1].hero.health = 2;

  const result = applyCommand(state, {
    type: "play-card",
    player: 0,
    cardId: "sun-focused-ray",
    target: { kind: "hero", player: 1 },
  });
  assert.equal(result.accepted, true);
  assert.equal(result.state.phase, "game-over");
  assert.equal(result.state.winner, 0);
  assert.deepEqual(result.state.result, {
    winner: 0,
    reason: "hero-defeated",
  });
});

test("空牌库按递增疲劳伤害结算胜负", () => {
  const state = editableMatch();
  state.players[1].deck = [];
  state.players[1].hero.health = 1;
  state.players[1].fatigue = 0;

  const result = applyCommand(state, {
    type: "end-turn",
    player: 0,
  });
  assert.equal(result.accepted, true);
  assert.equal(result.state.players[1].fatigue, 1);
  assert.equal(result.state.players[1].hero.health, 0);
  assert.equal(result.state.phase, "game-over");
  assert.deepEqual(result.state.result, {
    winner: 0,
    reason: "fatigue",
  });
});

test("疲劳是伤害，会先消耗护甲再扣除英雄生命", () => {
  const state = editableMatch();
  state.players[1].deck = [];
  state.players[1].hero.health = 7;
  state.players[1].hero.armor = 2;
  state.players[1].fatigue = 2;

  const result = applyCommand(state, {
    type: "end-turn",
    player: 0,
  });
  const fatigue = result.state.events.findLast((event) => event.type === "fatigue");

  assert.equal(result.accepted, true);
  assert.equal(result.state.players[1].fatigue, 3);
  assert.equal(result.state.players[1].hero.armor, 0);
  assert.equal(result.state.players[1].hero.health, 6);
  assert.equal(fatigue?.data?.amount, 3);
  assert.equal(fatigue?.data?.armorAbsorbed, 2);
  assert.equal(fatigue?.data?.healthDamage, 1);
  const effects = battleEventsToEffects([fatigue!]);
  assert.deepEqual(
    effects.map((effect) => [effect.kind, effect.amount]),
    [["shield", 2], ["damage", 1]],
  );
});

test("第 90 回合不会开启行动窗口，而是按炉石规则结束为平局", () => {
  const state = editableMatch();
  state.turn = 89;
  state.activePlayer = 0;

  const result = applyCommand(state, {
    type: "end-turn",
    player: 0,
  });

  assert.equal(result.accepted, true);
  assert.equal(result.state.phase, "game-over");
  assert.deepEqual(result.state.result, { winner: null, reason: "draw" });
  assert.equal(result.state.turn, 90);
  assert.ok(
    result.state.events.some(
      (event) => event.type === "match-ended" && event.data?.reason === "draw",
    ),
  );
  assert.equal(
    result.state.events.some(
      (event) => event.type === "turn-started" && event.turn === 90,
    ),
    false,
  );
});

test("法术中的疲劳不会提前截断同一张牌的后续效果", () => {
  const state = editableMatch();
  state.players[0].hand = ["ember-cinder-dispatch"];
  state.players[0].mana = 2;
  state.players[0].deck = [];
  state.players[0].hero.health = 1;
  state.players[1].hero.health = 30;

  const result = applyCommand(state, {
    type: "play-card",
    player: 0,
    cardId: "ember-cinder-dispatch",
  });

  assert.equal(result.accepted, true);
  assert.equal(result.state.phase, "game-over");
  assert.deepEqual(result.state.result, { winner: 1, reason: "fatigue" });
  assert.equal(result.state.players[0].fatigue, 1);
  assert.equal(result.state.players[1].hero.health, 29);
  assert.ok(
    result.state.events.some(
      (event) => event.type === "damage" && event.data?.target?.kind === "hero",
    ),
  );
});
