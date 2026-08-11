import assert from "node:assert/strict";
import test from "node:test";

import {
  CARD_BY_ID,
  CARD_CATALOG,
  DEFAULT_OPPONENT_DECK,
  DEFAULT_STARTER_DECK,
  HERO_POWER_COST,
  applyCommand,
  battleEventsToEffects,
  chooseAiMulliganIndexes,
  cloneMatch,
  createMatch,
  runAiTurn,
  getTraitStatuses,
  validateDeck,
} from "../lib/game/index.ts";
import type {
  BattleEvent,
  MatchState,
  PlayerId,
  UnitState,
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

test("目录包含七个阵营各 30 张原创卡，并覆盖单位、战术和武器", () => {
  const factions = ["曜光", "幽潮", "中立", "烬火", "星穹", "苍林", "雷铸"] as const;

  assert.equal(CARD_CATALOG.length, 210);
  assert.equal(new Set(CARD_CATALOG.map((card) => card.id)).size, CARD_CATALOG.length);
  assert.equal(new Set(CARD_CATALOG.map((card) => card.name)).size, CARD_CATALOG.length);

  for (const faction of factions) {
    const cards = CARD_CATALOG.filter((card) => card.faction === faction);
    assert.equal(cards.length, 30, `${faction} 应有 30 张卡`);
    assert.equal(cards.filter((card) => card.type === "unit").length, 20, `${faction} 应有 20 个单位`);
    assert.equal(cards.filter((card) => card.type === "spell").length, 9, `${faction} 应有 9 张战术`);
    assert.equal(cards.filter((card) => card.type === "weapon").length, 1, `${faction} 应有 1 把武器`);
    assert.ok(cards.some((card) => card.keywords?.includes("secret")), `${faction} 应至少有 1 张奥秘`);
    assert.ok(cards.some((card) => card.keywords?.includes("discover")), `${faction} 应至少有 1 张发现`);

    const rosterDeck = validateDeck(cards.map((card) => card.id));
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
  assert.equal(traded.state.players[0].hand.length, 1);
  assert.equal(traded.state.players[0].deck.length, 1);
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
      (entry) => entry.cardId === "neutral-stonehorn" && entry.health === 1,
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
  assert.equal(result.state.players[0].board[0].health, 4);
});

test("汲取只在主动攻击实际造成伤害后回复核心，激昂最多累计两层", () => {
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
  assert.equal(target.health, 6);
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
  const first = applyCommand(state, { type: "hero-power", player: 0 });
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
