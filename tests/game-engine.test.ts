import assert from "node:assert/strict";
import test from "node:test";

import {
  CARD_BY_ID,
  CARD_CATALOG,
  DEFAULT_OPPONENT_DECK,
  DEFAULT_STARTER_DECK,
  applyCommand,
  battleEventsToEffects,
  cloneMatch,
  createMatch,
  runAiTurn,
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
    hasAttacked: false,
    summonedTurn: 0,
    ...overrides,
  };
}

function editableMatch(seed = 101): MatchState {
  return cloneMatch(createMatch({ seed }));
}

test("目录包含至少 18 张原创卡，覆盖两阵营、中立、单位和法术", () => {
  assert.ok(CARD_CATALOG.length >= 18);
  assert.equal(new Set(CARD_CATALOG.map((card) => card.id)).size, CARD_CATALOG.length);

  for (const faction of ["曜光", "幽潮", "中立"] as const) {
    const cards = CARD_CATALOG.filter((card) => card.faction === faction);
    assert.ok(cards.some((card) => card.type === "unit"), `${faction} 缺少单位`);
    assert.ok(cards.some((card) => card.type === "spell"), `${faction} 缺少法术`);
  }
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

  const repeat = applyCommand(combat.state, {
    type: "attack",
    player: 0,
    attackerId: "attacker",
    target: { kind: "unit", entityId: "defender" },
  });
  assert.equal(repeat.accepted, false);
  assert.equal(repeat.error?.code, "attacker-exhausted");
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
  assert.equal(chargeAttack.state.players[1].hero.health, 28);
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
  assert.equal(after.players[0].hero.health, 25);
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
