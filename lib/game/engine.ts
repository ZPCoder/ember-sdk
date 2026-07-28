import {
  CARD_BY_ID,
  DEFAULT_OPPONENT_DECK,
  DEFAULT_STARTER_DECK,
} from "./catalog.ts";
import { validateDeck } from "./deck.ts";
import { nextRandom, normalizeSeed, shuffleWithSeed } from "./rng.ts";
import type {
  BattleCommand,
  BattleEvent,
  BattleEventType,
  BattleTarget,
  CardDefinition,
  CardEffect,
  CardTargetRule,
  CommandError,
  CommandResult,
  CreateMatchOptions,
  MatchEndReason,
  MatchState,
  PlayerId,
  PlayerState,
  UnitState,
} from "./types.ts";

export const HERO_MAX_HEALTH = 30;
export const MAX_MANA = 10;
export const MAX_BOARD_SIZE = 5;
export const MAX_HAND_SIZE = 10;
export const STARTING_HAND_SIZE = 3;

function otherPlayer(player: PlayerId): PlayerId {
  return player === 0 ? 1 : 0;
}

function hasGameEnded(state: MatchState): boolean {
  return state.phase === "game-over";
}

function clonePlayer(player: PlayerState): PlayerState {
  return {
    ...player,
    hero: { ...player.hero },
    deck: [...player.deck],
    hand: [...player.hand],
    board: player.board.map((unit) => ({
      ...unit,
      keywords: [...unit.keywords],
    })),
  };
}

export function cloneMatch(state: MatchState): MatchState {
  return {
    ...state,
    players: [clonePlayer(state.players[0]), clonePlayer(state.players[1])],
    events: state.events.map((event) => ({
      ...event,
      data: event.data ? { ...event.data } : undefined,
    })),
    processedCommandIds: [...state.processedCommandIds],
    result: state.result ? { ...state.result } : null,
  };
}

function appendEvent(
  state: MatchState,
  type: BattleEventType,
  message: string,
  player?: PlayerId,
  data?: Record<string, unknown>,
): void {
  const previous = state.events.at(-1);
  const event: BattleEvent = {
    seq: previous ? previous.seq + 1 : 1,
    type,
    turn: state.turn,
    message,
  };

  if (player !== undefined) {
    event.player = player;
  }
  if (data !== undefined) {
    event.data = data;
  }

  state.events.push(event);
}

function reject(state: MatchState, error: CommandError): CommandResult {
  return {
    state,
    accepted: false,
    error,
  };
}

function makePlayer(
  id: PlayerId,
  deck: string[],
  starts: boolean,
): PlayerState {
  return {
    id,
    hero: {
      health: HERO_MAX_HEALTH,
      maxHealth: HERO_MAX_HEALTH,
    },
    maxMana: starts ? 1 : 0,
    mana: starts ? 1 : 0,
    deck,
    hand: [],
    board: [],
    fatigue: 0,
  };
}

function findUnit(
  state: MatchState,
  entityId: string,
): UnitState | undefined {
  return (
    state.players[0].board.find((unit) => unit.entityId === entityId) ??
    state.players[1].board.find((unit) => unit.entityId === entityId)
  );
}

function getTargetOwner(
  state: MatchState,
  target: BattleTarget,
): PlayerId | undefined {
  if (target.kind === "hero") {
    return target.player;
  }
  return findUnit(state, target.entityId)?.owner;
}

function isTargetValid(
  state: MatchState,
  player: PlayerId,
  rule: CardTargetRule,
  target: BattleTarget | undefined,
): boolean {
  if (rule === "none") {
    return target === undefined;
  }
  if (!target) {
    return false;
  }

  const owner = getTargetOwner(state, target);
  if (owner === undefined) {
    return false;
  }

  switch (rule) {
    case "enemy-character":
      return owner === otherPlayer(player);
    case "friendly-character":
      return owner === player;
    case "any-character":
      return true;
    case "enemy-unit":
      return target.kind === "unit" && owner === otherPlayer(player);
    case "friendly-unit":
      return target.kind === "unit" && owner === player;
    default:
      return false;
  }
}

function finishMatch(
  state: MatchState,
  winner: PlayerId | null,
  reason: MatchEndReason,
): void {
  if (state.phase === "game-over") {
    return;
  }

  state.phase = "game-over";
  state.winner = winner;
  state.result = { winner, reason };
  appendEvent(
    state,
    "match-ended",
    winner === null ? "对局以平局结束。" : `玩家 ${winner} 获胜。`,
    winner ?? undefined,
    { winner, reason },
  );
}

function checkHeroOutcome(
  state: MatchState,
  reason: Exclude<MatchEndReason, "concede" | "draw">,
): void {
  const dead0 = state.players[0].hero.health <= 0;
  const dead1 = state.players[1].hero.health <= 0;
  if (!dead0 && !dead1) {
    return;
  }

  if (dead0 && dead1) {
    finishMatch(state, null, "draw");
  } else {
    finishMatch(state, dead0 ? 1 : 0, reason);
  }
}

function drawCard(state: MatchState, player: PlayerId): void {
  if (state.phase === "game-over") {
    return;
  }

  const owner = state.players[player];
  const cardId = owner.deck.shift();

  if (!cardId) {
    owner.fatigue += 1;
    owner.hero.health = Math.max(0, owner.hero.health - owner.fatigue);
    appendEvent(
      state,
      "fatigue",
      `玩家 ${player} 受到 ${owner.fatigue} 点疲劳伤害。`,
      player,
      { amount: owner.fatigue, health: owner.hero.health },
    );
    checkHeroOutcome(state, "fatigue");
    return;
  }

  if (owner.hand.length >= MAX_HAND_SIZE) {
    appendEvent(
      state,
      "card-burned",
      `玩家 ${player} 的手牌已满，一张牌被销毁。`,
      player,
      { cardId },
    );
    return;
  }

  owner.hand.push(cardId);
  appendEvent(
    state,
    "card-drawn",
    `玩家 ${player} 抽了一张牌。`,
    player,
    { cardId },
  );
}

function createUnit(
  state: MatchState,
  player: PlayerId,
  card: CardDefinition,
): UnitState {
  const entityId = `u${state.nextEntityId}`;
  state.nextEntityId += 1;

  return {
    entityId,
    cardId: card.id,
    name: card.name,
    owner: player,
    attack: card.attack ?? 0,
    health: card.health ?? 1,
    maxHealth: card.health ?? 1,
    keywords: [...(card.keywords ?? [])],
    hasAttacked: false,
    summonedTurn: state.turn,
  };
}

function removeDeadUnits(state: MatchState): void {
  for (const player of [0, 1] as const) {
    const dead = state.players[player].board.filter((unit) => unit.health <= 0);
    for (const unit of dead) {
      appendEvent(
        state,
        "unit-died",
        `${unit.name} 被击败。`,
        unit.owner,
        { entityId: unit.entityId, cardId: unit.cardId },
      );
    }
    state.players[player].board = state.players[player].board.filter(
      (unit) => unit.health > 0,
    );
  }
}

function dealDamage(
  state: MatchState,
  target: BattleTarget,
  amount: number,
  sourcePlayer: PlayerId,
  endReason: "hero-defeated" | "fatigue" = "hero-defeated",
): void {
  if (amount <= 0 || state.phase === "game-over") {
    return;
  }

  if (target.kind === "hero") {
    const hero = state.players[target.player].hero;
    hero.health = Math.max(0, hero.health - amount);
    appendEvent(
      state,
      "damage",
      `玩家 ${target.player} 的英雄受到 ${amount} 点伤害。`,
      sourcePlayer,
      { amount, target, health: hero.health },
    );
    checkHeroOutcome(state, endReason);
    return;
  }

  const unit = findUnit(state, target.entityId);
  if (!unit) {
    return;
  }

  const shieldIndex = unit.keywords.indexOf("shield");
  if (shieldIndex >= 0) {
    unit.keywords.splice(shieldIndex, 1);
    appendEvent(
      state,
      "shield-broken",
      `${unit.name} 的护盾抵消了伤害。`,
      unit.owner,
      { amount, entityId: unit.entityId },
    );
    return;
  }

  unit.health -= amount;
  appendEvent(
    state,
    "damage",
    `${unit.name} 受到 ${amount} 点伤害。`,
    sourcePlayer,
    { amount, entityId: unit.entityId, health: unit.health },
  );
}

function healTarget(
  state: MatchState,
  target: BattleTarget,
  amount: number,
  sourcePlayer: PlayerId,
): void {
  if (target.kind === "hero") {
    const hero = state.players[target.player].hero;
    const healed = Math.min(amount, hero.maxHealth - hero.health);
    hero.health += healed;
    appendEvent(
      state,
      "healing",
      `玩家 ${target.player} 的英雄恢复 ${healed} 点生命。`,
      sourcePlayer,
      { amount: healed, target, health: hero.health },
    );
    return;
  }

  const unit = findUnit(state, target.entityId);
  if (!unit) {
    return;
  }

  const healed = Math.min(amount, unit.maxHealth - unit.health);
  unit.health += healed;
  appendEvent(
    state,
    "healing",
    `${unit.name} 恢复 ${healed} 点生命。`,
    sourcePlayer,
    { amount: healed, entityId: unit.entityId, health: unit.health },
  );
}

function buffTarget(
  state: MatchState,
  target: BattleTarget,
  attack: number,
  health: number,
  sourcePlayer: PlayerId,
): void {
  if (target.kind !== "unit") {
    return;
  }

  const unit = findUnit(state, target.entityId);
  if (!unit) {
    return;
  }

  unit.attack += attack;
  unit.maxHealth += health;
  unit.health += health;
  appendEvent(
    state,
    "unit-buffed",
    `${unit.name} 获得 +${attack}/+${health}。`,
    sourcePlayer,
    {
      entityId: unit.entityId,
      attack: unit.attack,
      health: unit.health,
      maxHealth: unit.maxHealth,
    },
  );
}

function resolveEffect(
  state: MatchState,
  player: PlayerId,
  effect: CardEffect,
  target: BattleTarget | undefined,
): void {
  if (state.phase === "game-over") {
    return;
  }

  switch (effect.kind) {
    case "damage":
      if (target) {
        dealDamage(state, target, effect.amount, player);
      }
      break;
    case "heal":
      if (target) {
        healTarget(state, target, effect.amount, player);
      }
      break;
    case "draw":
      for (let count = 0; count < effect.count; count += 1) {
        drawCard(state, player);
        if (hasGameEnded(state)) {
          break;
        }
      }
      break;
    case "buff":
      if (target) {
        buffTarget(state, target, effect.attack, effect.health, player);
      }
      break;
    case "summon": {
      const summonedCard = CARD_BY_ID[effect.cardId];
      if (!summonedCard || summonedCard.type !== "unit") {
        break;
      }
      for (
        let count = 0;
        count < effect.count &&
        state.players[player].board.length < MAX_BOARD_SIZE;
        count += 1
      ) {
        const unit = createUnit(state, player, summonedCard);
        state.players[player].board.push(unit);
        appendEvent(
          state,
          "unit-summoned",
          `${summonedCard.name} 被召唤。`,
          player,
          { cardId: summonedCard.id, entityId: unit.entityId },
        );
      }
      break;
    }
    case "random-enemy-damage": {
      const enemy = otherPlayer(player);
      const targets: BattleTarget[] = [
        { kind: "hero", player: enemy },
        ...state.players[enemy].board.map(
          (unit): BattleTarget => ({
            kind: "unit",
            entityId: unit.entityId,
          }),
        ),
      ];
      const random = nextRandom(state.rngState);
      state.rngState = random.state;
      const randomTarget =
        targets[Math.floor(random.value * targets.length)] ??
        targets[0];
      dealDamage(state, randomTarget, effect.amount, player);
      break;
    }
  }

  removeDeadUnits(state);
}

function resolveEffects(
  state: MatchState,
  player: PlayerId,
  effects: readonly CardEffect[],
  target: BattleTarget | undefined,
): void {
  for (const effect of effects) {
    resolveEffect(state, player, effect, target);
    if (state.phase === "game-over") {
      break;
    }
  }
}

function handlePlayCard(
  state: MatchState,
  command: Extract<BattleCommand, { type: "play-card" }>,
): CommandError | null {
  const owner = state.players[command.player];
  const handIndex = owner.hand.indexOf(command.cardId);
  if (handIndex < 0) {
    return {
      code: "card-not-in-hand",
      message: "该卡牌不在玩家手牌中。",
    };
  }

  const card = CARD_BY_ID[command.cardId];
  if (!card) {
    return {
      code: "card-not-in-hand",
      message: "该卡牌不存在于当前内容版本。",
    };
  }

  if (owner.mana < card.cost) {
    return {
      code: "not-enough-mana",
      message: `需要 ${card.cost} 点法力，当前只有 ${owner.mana} 点。`,
    };
  }

  if (card.type === "unit" && owner.board.length >= MAX_BOARD_SIZE) {
    return {
      code: "board-full",
      message: `场上最多只能有 ${MAX_BOARD_SIZE} 个单位。`,
    };
  }

  const targetRule = card.target ?? "none";
  if (targetRule !== "none" && !command.target) {
    return {
      code: "target-required",
      message: "这张卡牌需要选择一个目标。",
    };
  }
  if (!isTargetValid(state, command.player, targetRule, command.target)) {
    return {
      code: "invalid-target",
      message: "所选目标不符合卡牌要求。",
    };
  }

  owner.hand.splice(handIndex, 1);
  owner.mana -= card.cost;
  appendEvent(
    state,
    "card-played",
    `玩家 ${command.player} 使用了 ${card.name}。`,
    command.player,
    { cardId: card.id, cost: card.cost, target: command.target },
  );

  if (card.type === "unit") {
    const unit = createUnit(state, command.player, card);
    owner.board.push(unit);
    appendEvent(
      state,
      "unit-summoned",
      `${card.name} 进入战场。`,
      command.player,
      { cardId: card.id, entityId: unit.entityId },
    );
    resolveEffects(state, command.player, card.onPlay ?? [], command.target);
  } else {
    resolveEffects(state, command.player, card.effect ?? [], command.target);
  }

  return null;
}

function handleAttack(
  state: MatchState,
  command: Extract<BattleCommand, { type: "attack" }>,
): CommandError | null {
  const attacker = findUnit(state, command.attackerId);
  if (!attacker || attacker.owner !== command.player) {
    return {
      code: "attacker-not-found",
      message: "找不到可由该玩家控制的攻击单位。",
    };
  }
  if (attacker.hasAttacked) {
    return {
      code: "attacker-exhausted",
      message: "该单位本回合已经攻击过。",
    };
  }
  if (
    attacker.summonedTurn === state.turn &&
    !attacker.keywords.includes("charge")
  ) {
    return {
      code: "attacker-summoning-sick",
      message: "该单位刚刚登场，除非具有冲锋，否则不能攻击。",
    };
  }

  const targetOwner = getTargetOwner(state, command.target);
  const enemy = otherPlayer(command.player);
  if (targetOwner !== enemy) {
    return {
      code: "invalid-target",
      message: "单位只能攻击敌方角色。",
    };
  }

  const enemyTaunts = state.players[enemy].board.filter((unit) =>
    unit.keywords.includes("taunt"),
  );
  if (
    enemyTaunts.length > 0 &&
    command.target.kind !== "unit"
  ) {
    return {
      code: "taunt-blocking",
      message: "必须优先攻击具有嘲讽的敌方单位。",
    };
  }
  if (enemyTaunts.length > 0 && command.target.kind === "unit") {
    const targetEntityId = command.target.entityId;
    if (!enemyTaunts.some((unit) => unit.entityId === targetEntityId)) {
      return {
        code: "taunt-blocking",
        message: "必须优先攻击具有嘲讽的敌方单位。",
      };
    }
  }

  const defendingUnit =
    command.target.kind === "unit"
      ? findUnit(state, command.target.entityId)
      : undefined;
  if (command.target.kind === "unit" && !defendingUnit) {
    return {
      code: "invalid-target",
      message: "目标单位不存在。",
    };
  }

  attacker.hasAttacked = true;
  appendEvent(
    state,
    "attack",
    `${attacker.name} 发起攻击。`,
    command.player,
    {
      attackerId: attacker.entityId,
      target: command.target,
    },
  );

  const attackerDamage = attacker.attack;
  const defenderDamage = defendingUnit?.attack ?? 0;
  dealDamage(state, command.target, attackerDamage, command.player);
  if (defendingUnit && state.phase !== "game-over") {
    dealDamage(
      state,
      { kind: "unit", entityId: attacker.entityId },
      defenderDamage,
      enemy,
    );
  }
  removeDeadUnits(state);

  return null;
}

function handleEndTurn(
  state: MatchState,
  player: PlayerId,
): CommandError | null {
  appendEvent(
    state,
    "turn-ended",
    `玩家 ${player} 结束了回合。`,
    player,
  );

  const next = otherPlayer(player);
  state.activePlayer = next;
  state.turn += 1;

  const nextPlayer = state.players[next];
  nextPlayer.maxMana = Math.min(MAX_MANA, nextPlayer.maxMana + 1);
  nextPlayer.mana = nextPlayer.maxMana;
  for (const unit of nextPlayer.board) {
    unit.hasAttacked = false;
  }

  appendEvent(
    state,
    "turn-started",
    `玩家 ${next} 的回合开始。`,
    next,
    { mana: nextPlayer.mana },
  );
  drawCard(state, next);

  return null;
}

function handleConcede(state: MatchState, player: PlayerId): CommandError | null {
  appendEvent(
    state,
    "conceded",
    `玩家 ${player} 选择投降。`,
    player,
  );
  finishMatch(state, otherPlayer(player), "concede");
  return null;
}

export function createMatch(options: CreateMatchOptions = {}): MatchState {
  const seed = normalizeSeed(options.seed ?? Date.now());
  const startingPlayer = options.startingPlayer ?? 0;
  const sourceDecks = options.decks ?? [
    options.playerDeck ?? DEFAULT_STARTER_DECK,
    options.opponentDeck ?? DEFAULT_OPPONENT_DECK,
  ];

  for (const [index, deck] of sourceDecks.entries()) {
    const validation = validateDeck(deck);
    if (!validation.valid) {
      const details = validation.errors.map((error) => error.message).join(" ");
      throw new Error(`玩家 ${index} 的牌组不合法：${details}`);
    }
  }

  const firstShuffle = shuffleWithSeed(sourceDecks[0], seed);
  const secondShuffle = shuffleWithSeed(sourceDecks[1], firstShuffle.state);
  const state: MatchState = {
    id: options.matchId ?? `match-${seed.toString(16)}`,
    seed,
    rngState: secondShuffle.state,
    version: 0,
    turn: 1,
    activePlayer: startingPlayer,
    phase: "main",
    players: [
      makePlayer(0, firstShuffle.values, startingPlayer === 0),
      makePlayer(1, secondShuffle.values, startingPlayer === 1),
    ],
    winner: null,
    result: null,
    events: [],
    nextEntityId: 1,
    processedCommandIds: [],
  };

  appendEvent(
    state,
    "match-started",
    `对局开始，玩家 ${startingPlayer} 先手。`,
    startingPlayer,
    { seed, startingPlayer },
  );

  for (let count = 0; count < STARTING_HAND_SIZE; count += 1) {
    drawCard(state, 0);
    drawCard(state, 1);
  }

  return state;
}

export function applyCommand(
  state: MatchState,
  command: BattleCommand,
): CommandResult {
  if (
    command.commandId &&
    state.processedCommandIds.includes(command.commandId)
  ) {
    return {
      state,
      accepted: true,
      duplicate: true,
    };
  }

  if (state.phase === "game-over") {
    return reject(state, {
      code: "game-over",
      message: "对局已经结束。",
    });
  }

  if (
    command.expectedVersion !== undefined &&
    command.expectedVersion !== state.version
  ) {
    return reject(state, {
      code: "version-conflict",
      message: `状态版本不一致：预期 ${command.expectedVersion}，当前为 ${state.version}。`,
    });
  }

  if (command.type !== "concede" && command.player !== state.activePlayer) {
    return reject(state, {
      code: "not-your-turn",
      message: "当前不是该玩家的回合。",
    });
  }

  const next = cloneMatch(state);
  let error: CommandError | null;
  switch (command.type) {
    case "play-card":
      error = handlePlayCard(next, command);
      break;
    case "attack":
      error = handleAttack(next, command);
      break;
    case "end-turn":
      error = handleEndTurn(next, command.player);
      break;
    case "concede":
      error = handleConcede(next, command.player);
      break;
  }

  if (error) {
    return reject(state, error);
  }

  next.version += 1;
  if (command.commandId) {
    next.processedCommandIds.push(command.commandId);
  }

  return {
    state: next,
    accepted: true,
  };
}

function chooseAiTarget(
  state: MatchState,
  player: PlayerId,
  rule: CardTargetRule,
): BattleTarget | undefined {
  const enemy = otherPlayer(player);
  switch (rule) {
    case "none":
      return undefined;
    case "enemy-character":
      return { kind: "hero", player: enemy };
    case "friendly-character":
      return { kind: "hero", player };
    case "any-character":
      return { kind: "hero", player: enemy };
    case "enemy-unit": {
      const unit = state.players[enemy].board[0];
      return unit ? { kind: "unit", entityId: unit.entityId } : undefined;
    }
    case "friendly-unit": {
      const unit = state.players[player].board[0];
      return unit ? { kind: "unit", entityId: unit.entityId } : undefined;
    }
  }
}

function isAiCardPlayable(
  state: MatchState,
  player: PlayerId,
  card: CardDefinition,
): boolean {
  if (card.cost > state.players[player].mana) {
    return false;
  }
  if (
    card.type === "unit" &&
    state.players[player].board.length >= MAX_BOARD_SIZE
  ) {
    return false;
  }

  const rule = card.target ?? "none";
  if (rule === "friendly-unit") {
    return state.players[player].board.length > 0;
  }
  if (rule === "enemy-unit") {
    return state.players[otherPlayer(player)].board.length > 0;
  }
  return true;
}

export function runAiTurn(
  state: MatchState,
  player: PlayerId = state.activePlayer,
): MatchState {
  if (state.phase === "game-over" || state.activePlayer !== player) {
    return state;
  }

  let next = state;
  for (let safety = 0; safety < 30; safety += 1) {
    const playable = next.players[player].hand
      .map((cardId, handOrder) => ({
        card: CARD_BY_ID[cardId],
        handOrder,
      }))
      .filter(
        (
          entry,
        ): entry is {
          card: CardDefinition;
          handOrder: number;
        } =>
          Boolean(entry.card) &&
          isAiCardPlayable(next, player, entry.card),
      )
      .sort(
        (left, right) =>
          right.card.cost - left.card.cost ||
          left.handOrder - right.handOrder,
      )[0];

    if (!playable) {
      break;
    }

    const target = chooseAiTarget(
      next,
      player,
      playable.card.target ?? "none",
    );
    const result = applyCommand(next, {
      type: "play-card",
      player,
      cardId: playable.card.id,
      target,
    });
    if (!result.accepted) {
      break;
    }
    next = result.state;
    if (next.phase === "game-over") {
      return next;
    }
  }

  for (let safety = 0; safety < MAX_BOARD_SIZE; safety += 1) {
    const attacker = next.players[player].board.find(
      (unit) =>
        !unit.hasAttacked &&
        (unit.summonedTurn !== next.turn ||
          unit.keywords.includes("charge")),
    );
    if (!attacker) {
      break;
    }

    const enemy = otherPlayer(player);
    const taunt = next.players[enemy].board.find((unit) =>
      unit.keywords.includes("taunt"),
    );
    const target: BattleTarget = taunt
      ? { kind: "unit", entityId: taunt.entityId }
      : { kind: "hero", player: enemy };
    const result = applyCommand(next, {
      type: "attack",
      player,
      attackerId: attacker.entityId,
      target,
    });
    if (!result.accepted) {
      break;
    }
    next = result.state;
    if (next.phase === "game-over") {
      return next;
    }
  }

  const endTurn = applyCommand(next, {
    type: "end-turn",
    player,
  });
  return endTurn.accepted ? endTurn.state : next;
}
