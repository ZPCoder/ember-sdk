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
    keywords: [...(card.keywords ?? [])],
    stars: 1,
    furyStacks: 0,
    hasAttacked: false,
    summonedTurn: 0,
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

test("目录包含七个阵营各 30 张原创卡，并覆盖单位和战术", () => {
  const factions = ["曜光", "幽潮", "中立", "烬火", "星穹", "苍林", "雷铸"] as const;

  assert.equal(CARD_CATALOG.length, 210);
  assert.equal(new Set(CARD_CATALOG.map((card) => card.id)).size, CARD_CATALOG.length);
  assert.equal(new Set(CARD_CATALOG.map((card) => card.name)).size, CARD_CATALOG.length);

  for (const faction of factions) {
    const cards = CARD_CATALOG.filter((card) => card.faction === faction);
    assert.equal(cards.length, 30, `${faction} 应有 30 张卡`);
    assert.equal(cards.filter((card) => card.type === "unit").length, 20, `${faction} 应有 20 个单位`);
    assert.equal(cards.filter((card) => card.type === "spell").length, 10, `${faction} 应有 10 张战术`);

    const rosterDeck = validateDeck(cards.map((card) => card.id));
    assert.equal(rosterDeck.valid, true, `${faction} 的完整阵营牌组应可直接进入对战`);
    assert.equal(rosterDeck.faction, faction === "中立" ? null : faction);
  }

  for (const card of CARD_CATALOG) {
    if (card.type === "unit") {
      assert.ok(card.traits && card.traits.length > 0, `${card.name} 缺少特质`);
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
  assert.equal(opening.players[1].hand.length, 3);
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
  ];

  const effects = battleEventsToEffects(events);

  assert.deepEqual(
    effects.map((effect) => effect.kind),
    ["summon", "attack", "damage", "turn", "win"],
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
  ];
  state.players[0].hand = ["sun-dawn-scout", "neutral-clockwork-beetle"];
  state.players[0].mana = 3;

  const upgraded = applyCommand(state, {
    type: "play-card",
    player: 0,
    cardId: "sun-dawn-scout",
  });
  assert.equal(upgraded.accepted, true);
  assert.equal(upgraded.state.players[0].board.length, 5);
  assert.equal(upgraded.state.players[0].board[0].stars, 2);

  const blocked = applyCommand(upgraded.state, {
    type: "play-card",
    player: 0,
    cardId: "neutral-clockwork-beetle",
  });
  assert.equal(blocked.accepted, false);
  assert.equal(blocked.error?.code, "board-full");
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
  assert.equal(result.state.players[0].board[0].health, 2);
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
  assert.equal(drained.state.players[0].hero.health, 21);

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

test("核心脉冲每回合只能使用一次，并在回合开始时重置", () => {
  const state = editableMatch();
  state.players[0].mana = HERO_POWER_COST;
  const first = applyCommand(state, { type: "hero-power", player: 0 });
  assert.equal(first.accepted, true);
  assert.equal(first.state.players[0].mana, 0);
  assert.equal(first.state.players[1].hero.health, 29);
  assert.equal(first.state.players[0].heroPowerUsed, true);

  const repeat = applyCommand(first.state, { type: "hero-power", player: 0 });
  assert.equal(repeat.accepted, false);
  assert.equal(repeat.error?.code, "hero-power-used");

  const next = applyCommand(first.state, { type: "end-turn", player: 0 });
  assert.equal(next.accepted, true);
  assert.equal(next.state.players[1].heroPowerUsed, false);
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
