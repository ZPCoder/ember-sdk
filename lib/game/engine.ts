import {
  CARD_BY_ID,
  DEFAULT_OPPONENT_DECK,
  DEFAULT_STARTER_DECK,
} from "./catalog.ts";
import { validateDeck } from "./deck.ts";
import { factionForDeck, getHeroPower } from "./hero-powers.ts";
import { nextRandom, normalizeSeed, shuffleWithSeed } from "./rng.ts";
import { getTraitCount, getTraitTier } from "./traits.ts";
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
  Trait,
  UnitState,
} from "./types.ts";

export const HERO_MAX_HEALTH = 30;
export const MAX_MANA = 10;
// Keep the standard battlefield width familiar to Hearthstone players.
export const MAX_BOARD_SIZE = 7;
export const MAX_HAND_SIZE = 10;
export const STARTING_HAND_SIZE = 3;
export const HERO_POWER_COST = 2;

function otherPlayer(player: PlayerId): PlayerId {
  return player === 0 ? 1 : 0;
}

// A PVP client may keep its own deck in slot 0 while the other client keeps
// that same deck in slot 1.  Deriving the shuffle seed from the deck itself
// keeps each physical deck order identical on both clients, regardless of the
// local perspective used by the UI.
function deckFingerprint(deck: readonly string[]): number {
  let hash = 0x811c9dc5;
  for (const cardId of deck) {
    for (let index = 0; index < cardId.length; index += 1) {
      hash ^= cardId.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    hash ^= 0xff;
    hash = Math.imul(hash, 0x01000193);
  }
  return normalizeSeed(hash);
}

function hasGameEnded(state: MatchState): boolean {
  return state.phase === "game-over";
}

function clonePlayer(player: PlayerState): PlayerState {
  const faction = player.faction ?? factionForDeck(player.deck);
  return {
    ...player,
    faction,
    heroPower: player.heroPower ?? getHeroPower(faction),
    hero: { ...player.hero },
    deck: [...player.deck],
    hand: [...player.hand],
    board: player.board.map((unit) => ({
      ...unit,
      keywords: [...unit.keywords],
    })),
    coinAvailable: player.coinAvailable ?? false,
  };
}

export function cloneMatch(state: MatchState): MatchState {
  return {
    ...state,
    // Older persisted PVP snapshots predate the mulligan phase. Treat those
    // already-live matches as having completed their opening hand.
    mulliganDone: [...(state.mulliganDone ?? [true, true])] as [boolean, boolean],
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
  faction: PlayerState["faction"],
): PlayerState {
  return {
    id,
    faction,
    heroPower: getHeroPower(faction),
    hero: {
      health: HERO_MAX_HEALTH,
      maxHealth: HERO_MAX_HEALTH,
      armor: 0,
    },
    maxMana: 0,
    mana: 0,
    deck,
    hand: [],
    board: [],
    fatigue: 0,
    heroPowerUsed: false,
    coinAvailable: false,
  };
}

function handleMulligan(
  state: MatchState,
  player: PlayerId,
  cardIndexes: number[],
): CommandError | null {
  if (state.phase !== "mulligan") {
    return {
      code: "mulligan-closed",
      message: "起手换牌窗口已经关闭。",
    };
  }
  if (state.mulliganDone[player]) {
    return {
      code: "mulligan-closed",
      message: "你已经确认过起手牌。",
    };
  }
  if (!Array.isArray(cardIndexes) || cardIndexes.some((index) => !Number.isInteger(index))) {
    return {
      code: "invalid-mulligan",
      message: "起手换牌索引无效。",
    };
  }

  const indexes = [...cardIndexes].sort((left, right) => left - right);
  if (
    new Set(indexes).size !== indexes.length ||
    indexes.some((index) => index < 0 || index >= state.players[player].hand.length)
  ) {
    return {
      code: "invalid-mulligan",
      message: "只能选择当前手牌中的不同卡牌进行换牌。",
    };
  }

  const owner = state.players[player];
  const returned = indexes.map((index) => owner.hand[index]);
  for (let index = indexes.length - 1; index >= 0; index -= 1) {
    owner.hand.splice(indexes[index], 1);
  }
  for (let index = 0; index < returned.length; index += 1) {
    drawCard(state, player);
  }

  if (returned.length > 0) {
    const shuffled = shuffleWithSeed(
      [...owner.deck, ...returned],
      state.rngState,
    );
    owner.deck = shuffled.values;
    state.rngState = shuffled.state;
  }
  state.mulliganDone[player] = true;
  appendEvent(
    state,
    "mulligan-completed",
    `玩家 ${player} 已确认起手牌${returned.length > 0 ? `，更换 ${returned.length} 张牌` : ""}。`,
    player,
    { replaced: returned.length },
  );

  if (state.mulliganDone[0] && state.mulliganDone[1]) {
    state.phase = "main";
    state.players[state.activePlayer].maxMana = 1;
    state.players[state.activePlayer].mana = 1;
    const secondPlayer = otherPlayer(state.activePlayer);
    state.players[secondPlayer].coinAvailable = true;
    // The first player receives the first-turn draw when the opening hand is
    // locked, matching the familiar Hearthstone cadence.
    drawCard(state, state.activePlayer);
    // The second player receives the extra opening card that accompanies the
    // coin. The coin itself is represented as a command rather than a deck
    // card, so it cannot be burned or copied.
    drawCard(state, secondPlayer);
    appendEvent(
      state,
      "turn-started",
      `起手换牌完成，玩家 ${state.activePlayer} 的第一回合开始。`,
      state.activePlayer,
      { mana: state.players[state.activePlayer].mana },
    );
  }

  return null;
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

function unitHasTrait(unit: UnitState, trait: Trait): boolean {
  return Boolean(CARD_BY_ID[unit.cardId]?.traits?.includes(trait));
}

function canUnitAttack(unit: UnitState): boolean {
  const limit = unit.keywords.includes("windfury") ? 2 : 1;
  const attacksMade = unit.attacksMade ?? (unit.hasAttacked ? 1 : 0);
  return (
    !(unit.summoningSick ?? false) &&
    (unit.frozenTurns ?? 0) <= 0 &&
    attacksMade < limit
  );
}

function activeTraitTier(
  state: MatchState,
  player: PlayerId,
  trait: Trait,
): 0 | 1 | 2 {
  const cards = state.players[player].board
    .map((unit) => CARD_BY_ID[unit.cardId])
    .filter((card): card is CardDefinition => Boolean(card));
  return getTraitTier(getTraitCount(cards, trait));
}

function findUpgradeTarget(
  owner: PlayerState,
  card: CardDefinition,
): UnitState | undefined {
  return owner.board.find(
    (unit) => unit.cardId === card.id && unit.stars === 1,
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
      return (
        target.kind === "unit" &&
        owner === otherPlayer(player) &&
        !(findUnit(state, target.entityId)?.stealthActive ?? false)
      );
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
  const rush = card.keywords?.includes("rush") ?? false;
  const charge = card.keywords?.includes("charge") ?? false;

  return {
    entityId,
    cardId: card.id,
    name: card.name,
    owner: player,
    attack: card.attack ?? 0,
    health: card.health ?? 1,
    maxHealth: card.health ?? 1,
    keywords: [...(card.keywords ?? [])],
    stars: 1,
    furyStacks: 0,
    hasAttacked: false,
    summonedTurn: state.turn,
    attacksMade: 0,
    summoningSick: !charge && !rush,
    rushOnly: rush,
    stealthActive: card.keywords?.includes("stealth") ?? false,
    frozenTurns: 0,
    rebornUsed: false,
  };
}

function removeDeadUnits(state: MatchState): void {
  for (const player of [0, 1] as const) {
    const dead = state.players[player].board.filter((unit) => unit.health <= 0);
    state.players[player].board = state.players[player].board.filter(
      (unit) => unit.health > 0,
    );
    for (const unit of dead) {
      appendEvent(
        state,
        "unit-died",
        `${unit.name} 被击败。`,
        unit.owner,
        { entityId: unit.entityId, cardId: unit.cardId },
      );
      const card = CARD_BY_ID[unit.cardId];
      if (card?.onDeath && card.onDeath.length > 0) {
        resolveEffects(state, player, card.onDeath, undefined);
      }
      if (
        card?.keywords?.includes("reborn") &&
        !unit.rebornUsed &&
        state.players[player].board.length < MAX_BOARD_SIZE
      ) {
        const reborn = createUnit(state, player, card);
        reborn.health = 1;
        reborn.maxHealth = 1;
        reborn.rebornUsed = true;
        state.players[player].board.push(reborn);
        appendEvent(
          state,
          "unit-summoned",
          `${unit.name} 复生。`,
          player,
          { cardId: card.id, entityId: reborn.entityId, reborn: true },
        );
      }
    }
  }
}

function dealDamage(
  state: MatchState,
  target: BattleTarget,
  amount: number,
  sourcePlayer: PlayerId,
  endReason: "hero-defeated" | "fatigue" = "hero-defeated",
  options: { combat?: boolean; sourceUnit?: UnitState } = {},
): number {
  if (amount <= 0 || state.phase === "game-over") {
    return 0;
  }

  if (target.kind === "hero") {
    const hero = state.players[target.player].hero;
    const absorbed = Math.min(hero.armor, amount);
    hero.armor -= absorbed;
    const actualDamage = Math.min(amount - absorbed, hero.health);
    hero.health = Math.max(0, hero.health - actualDamage);
    appendEvent(
      state,
      "damage",
      `玩家 ${target.player} 的英雄受到 ${actualDamage} 点伤害。`,
      sourcePlayer,
      { amount: actualDamage, target, health: hero.health },
    );
    checkHeroOutcome(state, endReason);
    return actualDamage;
  }

  const unit = findUnit(state, target.entityId);
  if (!unit) {
    return 0;
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
    return 0;
  }

  const reduction =
    options.combat && unitHasTrait(unit, "bulwark")
      ? activeTraitTier(state, unit.owner, "bulwark")
      : 0;
  const resolvedAmount = Math.max(1, amount - reduction);
  const actualDamage = Math.min(resolvedAmount, Math.max(0, unit.health));
  unit.health -= actualDamage;
  if (
    options.sourceUnit?.keywords.includes("poisonous") &&
    actualDamage > 0 &&
    unit.health > 0
  ) {
    unit.health = 0;
    appendEvent(
      state,
      "damage",
      `${unit.name} 受到剧毒。`,
      options.sourceUnit.owner,
      { amount: actualDamage, entityId: unit.entityId, poisonous: true },
    );
  }
  appendEvent(
    state,
    "damage",
    `${unit.name} 受到 ${actualDamage} 点伤害。`,
    sourcePlayer,
    {
      amount: actualDamage,
      requestedAmount: amount,
      reduction,
      entityId: unit.entityId,
      health: unit.health,
    },
  );
  return actualDamage;
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
  const bonusLabel =
    health === 0
      ? `+${attack} 攻击`
      : attack === 0
        ? `+${health} 生命`
        : `+${attack}/+${health}`;
  appendEvent(
    state,
    "unit-buffed",
    `${unit.name} 获得 ${bonusLabel}。`,
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
  numericBonus = 0,
): void {
  if (state.phase === "game-over") {
    return;
  }

  switch (effect.kind) {
    case "damage":
      if (target) {
        dealDamage(state, target, effect.amount + numericBonus, player);
      }
      break;
    case "heal":
      if (target) {
        healTarget(state, target, effect.amount + numericBonus, player);
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
        buffTarget(
          state,
          target,
          effect.attack + numericBonus,
          effect.health + numericBonus,
          player,
        );
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
      dealDamage(state, randomTarget, effect.amount + numericBonus, player);
      break;
    }
    case "freeze":
      if (target?.kind === "unit") {
        const unit = findUnit(state, target.entityId);
        if (unit) {
          unit.frozenTurns = Math.max(unit.frozenTurns, effect.amount ?? 1);
          appendEvent(
            state,
            "unit-buffed",
            `${unit.name} 被冻结。`,
            player,
            { entityId: unit.entityId, frozenTurns: unit.frozenTurns },
          );
        }
      }
      break;
    case "random-enemy-freeze": {
      const enemy = otherPlayer(player);
      const targets = state.players[enemy].board.filter(
        (unit) => !unit.stealthActive,
      );
      if (targets.length > 0) {
        const random = nextRandom(state.rngState);
        state.rngState = random.state;
        const unit = targets[Math.floor(random.value * targets.length)] ?? targets[0];
        unit.frozenTurns = Math.max(unit.frozenTurns, effect.amount ?? 1);
        appendEvent(
          state,
          "unit-buffed",
          `${unit.name} 被冻结。`,
          player,
          { entityId: unit.entityId, frozenTurns: unit.frozenTurns },
        );
      }
      break;
    }
    case "armor": {
      const hero = state.players[player].hero;
      hero.armor += effect.amount;
      appendEvent(
        state,
        "unit-buffed",
        `玩家 ${player} 获得 ${effect.amount} 点护甲。`,
        player,
        { armor: hero.armor },
      );
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
  numericBonus = 0,
): void {
  for (const effect of effects) {
    resolveEffect(state, player, effect, target, numericBonus);
    if (state.phase === "game-over") {
      break;
    }
  }
}

function upgradeUnit(
  state: MatchState,
  player: PlayerId,
  unit: UnitState,
  card: CardDefinition,
): void {
  const baseAttackBonus = Math.ceil((card.attack ?? 0) / 2);
  const baseHealthBonus = Math.ceil((card.health ?? 1) / 2);
  const craftBonus = card.traits?.includes("craft")
    ? activeTraitTier(state, player, "craft")
    : 0;
  const attackBonus = baseAttackBonus + craftBonus;
  const healthBonus = baseHealthBonus + craftBonus;

  unit.attack += attackBonus;
  unit.maxHealth += healthBonus;
  unit.health += healthBonus;
  unit.stars = 2;
  unit.keywords = Array.from(
    new Set([...unit.keywords, ...(card.keywords ?? [])]),
  );

  appendEvent(
    state,
    "unit-buffed",
    `${unit.name} 与同名档案共鸣，升至二星并获得 +${attackBonus}/+${healthBonus}。`,
    player,
    {
      entityId: unit.entityId,
      cardId: unit.cardId,
      upgrade: true,
      stars: unit.stars,
      attack: unit.attack,
      health: unit.health,
      maxHealth: unit.maxHealth,
    },
  );
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

  const upgradeTarget =
    card.type === "unit" ? findUpgradeTarget(owner, card) : undefined;
  if (
    card.type === "unit" &&
    owner.board.length >= MAX_BOARD_SIZE &&
    !upgradeTarget
  ) {
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
    if (upgradeTarget) {
      upgradeUnit(state, command.player, upgradeTarget, card);
    } else {
      const unit = createUnit(state, command.player, card);
      owner.board.push(unit);
      appendEvent(
        state,
        "unit-summoned",
        `${card.name} 进入战场。`,
        command.player,
        { cardId: card.id, entityId: unit.entityId },
      );
    }
    resolveEffects(state, command.player, card.onPlay ?? [], command.target);
  } else {
    resolveEffects(
      state,
      command.player,
      card.effect ?? [],
      command.target,
      activeTraitTier(state, command.player, "arcane"),
    );
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
  const legacySummoningSick =
    attacker.summoningSick === undefined &&
    attacker.summonedTurn === state.turn &&
    !attacker.keywords.includes("charge") &&
    !attacker.keywords.includes("rush");
  if (legacySummoningSick) {
    return {
      code: "attacker-summoning-sick",
      message: "该单位刚刚登场，除非具有冲锋，否则不能攻击。",
    };
  }
  if (attacker.summoningSick) {
    return {
      code: "attacker-summoning-sick",
      message: "该单位刚刚登场，除非具有冲锋，否则不能攻击。",
    };
  }
  if (!canUnitAttack(attacker)) {
    return {
      code: "attacker-exhausted",
      message: "该单位本回合已经攻击过。",
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

  if (
    command.target.kind === "unit" &&
    (findUnit(state, command.target.entityId)?.stealthActive ?? false)
  ) {
    return {
      code: "invalid-target",
      message: "潜行单位不能被直接选为目标。",
    };
  }
  if (command.target.kind === "hero" && attacker.rushOnly) {
    return {
      code: "invalid-target",
      message: "突袭单位本回合只能攻击敌方单位。",
    };
  }

  const enemyTaunts = state.players[enemy].board.filter(
    (unit) => unit.keywords.includes("taunt") && !unit.stealthActive,
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

  attacker.attacksMade =
    (attacker.attacksMade ?? (attacker.hasAttacked ? 1 : 0)) + 1;
  attacker.hasAttacked = true;
  attacker.stealthActive = false;
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

  const swiftBonus = unitHasTrait(attacker, "swift")
    ? activeTraitTier(state, command.player, "swift")
    : 0;
  const huntTier = unitHasTrait(attacker, "hunt")
    ? activeTraitTier(state, command.player, "hunt")
    : 0;
  const attackerDamage = attacker.attack + swiftBonus;
  const defenderDamage = defendingUnit?.attack ?? 0;
  const attackDamageDealt = dealDamage(
    state,
    command.target,
    attackerDamage,
    command.player,
    "hero-defeated",
    { combat: true, sourceUnit: attacker },
  );
  let retaliationDamage = 0;
  if (defendingUnit && state.phase !== "game-over") {
    retaliationDamage = dealDamage(
      state,
      { kind: "unit", entityId: attacker.entityId },
      defenderDamage,
      enemy,
      "hero-defeated",
      { combat: true, sourceUnit: defendingUnit },
    );
  }

  if (
    state.phase !== "game-over" &&
    attackDamageDealt > 0 &&
    attacker.keywords.includes("lifesteal")
  ) {
    healTarget(
      state,
      { kind: "hero", player: attacker.owner },
      1,
      attacker.owner,
    );
  }

  const triggerFury = (unit: UnitState, damageReceived: number) => {
    if (
      damageReceived <= 0 ||
      unit.health <= 0 ||
      !unit.keywords.includes("fury") ||
      unit.furyStacks >= 2
    ) {
      return;
    }
    unit.furyStacks += 1;
    buffTarget(
      state,
      { kind: "unit", entityId: unit.entityId },
      1,
      0,
      unit.owner,
    );
  };
  triggerFury(attacker, retaliationDamage);
  if (defendingUnit) {
    triggerFury(defendingUnit, attackDamageDealt);
  }

  if (
    defendingUnit &&
    huntTier > 0 &&
    defendingUnit.health <= 0 &&
    attacker.health > 0
  ) {
    healTarget(
      state,
      { kind: "unit", entityId: attacker.entityId },
      huntTier,
      attacker.owner,
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
  nextPlayer.heroPowerUsed = false;
  for (const unit of nextPlayer.board) {
    unit.attacksMade = 0;
    if (unit.frozenTurns > 0) {
      unit.frozenTurns -= 1;
      unit.hasAttacked = true;
      unit.summoningSick = true;
    } else {
      unit.hasAttacked = false;
      unit.summoningSick = false;
      unit.rushOnly = false;
    }
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

function handleHeroPower(
  state: MatchState,
  player: PlayerId,
): CommandError | null {
  const owner = state.players[player];
  const heroPower = owner.heroPower ?? getHeroPower(owner.faction ?? factionForDeck(owner.deck));
  if (owner.heroPowerUsed) {
    return {
      code: "hero-power-used",
      message: "核心技能每回合只能使用一次。",
    };
  }
  if (owner.mana < heroPower.cost) {
    return {
      code: "not-enough-mana",
      message: `需要 ${heroPower.cost} 点法力，当前只有 ${owner.mana} 点。`,
    };
  }

  owner.mana -= heroPower.cost;
  owner.heroPowerUsed = true;
  appendEvent(
    state,
    "hero-power",
    `玩家 ${player} 使用${heroPower.name}。`,
    player,
    {
      cost: heroPower.cost,
      heroPowerId: heroPower.id,
      heroPowerName: heroPower.name,
      heroPowerEffect: heroPower.effect,
    },
  );
  switch (heroPower.effect.kind) {
    case "damage-enemy-hero":
      dealDamage(
        state,
        { kind: "hero", player: otherPlayer(player) },
        heroPower.effect.amount,
        player,
      );
      break;
    case "heal-friendly-hero":
      healTarget(
        state,
        { kind: "hero", player },
        heroPower.effect.amount,
        player,
      );
      break;
    case "draw":
      for (let count = 0; count < heroPower.effect.count; count += 1) {
        drawCard(state, player);
        if (hasGameEnded(state)) break;
      }
      break;
    case "summon":
      resolveEffect(state, player, {
        kind: "summon",
        cardId: heroPower.effect.cardId,
        count: heroPower.effect.count,
      }, undefined);
      break;
    case "armor":
      resolveEffect(state, player, {
        kind: "armor",
        amount: heroPower.effect.amount,
      }, undefined);
      break;
  }
  return null;
}

function handleUseCoin(
  state: MatchState,
  player: PlayerId,
): CommandError | null {
  const owner = state.players[player];
  if (!owner.coinAvailable) {
    return {
      code: "coin-unavailable",
      message: "幸运币已经使用过，或当前玩家没有幸运币。",
    };
  }

  owner.coinAvailable = false;
  owner.mana += 1;
  appendEvent(
    state,
    "hero-power",
    `玩家 ${player} 使用幸运币，获得 1 点临时法力。`,
    player,
    { cost: 0, bonusMana: 1, coin: true },
  );
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

  const firstFingerprint = deckFingerprint(sourceDecks[0]);
  const secondFingerprint = deckFingerprint(sourceDecks[1]);
  const firstFaction = factionForDeck(sourceDecks[0]);
  const secondFaction = factionForDeck(sourceDecks[1]);
  const firstShuffle = shuffleWithSeed(
    sourceDecks[0],
    normalizeSeed(seed ^ firstFingerprint),
  );
  const secondShuffle = shuffleWithSeed(
    sourceDecks[1],
    normalizeSeed(seed ^ secondFingerprint),
  );
  const state: MatchState = {
    id: options.matchId ?? `match-${seed.toString(16)}`,
    seed,
    rngState: normalizeSeed(
      seed ^ firstFingerprint ^ secondFingerprint ^ 0x9e3779b9,
    ),
    version: 0,
    turn: 1,
    activePlayer: startingPlayer,
    phase: "mulligan",
    mulliganDone: [false, false],
    players: [
      makePlayer(0, firstShuffle.values, firstFaction),
      makePlayer(1, secondShuffle.values, secondFaction),
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

  if (
    command.type !== "mulligan" &&
    command.type !== "concede" &&
    state.phase !== "main"
  ) {
    return reject(state, {
      code: "mulligan-closed",
      message: "请先完成起手换牌，再开始行动。",
    });
  }

  if (
    command.type !== "mulligan" &&
    command.type !== "concede" &&
    command.player !== state.activePlayer
  ) {
    return reject(state, {
      code: "not-your-turn",
      message: "当前不是该玩家的回合。",
    });
  }

  const next = cloneMatch(state);
  let error: CommandError | null;
  switch (command.type) {
    case "mulligan":
      error = handleMulligan(next, command.player, command.cardIndexes);
      break;
    case "play-card":
      error = handlePlayCard(next, command);
      break;
    case "attack":
      error = handleAttack(next, command);
      break;
    case "hero-power":
      error = handleHeroPower(next, command.player);
      break;
    case "use-coin":
      error = handleUseCoin(next, command.player);
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
    state.players[player].board.length >= MAX_BOARD_SIZE &&
    !findUpgradeTarget(state.players[player], card)
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
  if (state.phase === "game-over") {
    return state;
  }

  if (state.phase === "mulligan") {
    const result = applyCommand(state, {
      type: "mulligan",
      player,
      cardIndexes: [],
    });
    return result.accepted ? result.state : state;
  }

  if (state.activePlayer !== player) return state;

  let next = state;
  if (
    next.players[player].coinAvailable &&
    next.players[player].hand.some((cardId) => {
      const card = CARD_BY_ID[cardId];
      return Boolean(card && card.cost === next.players[player].mana + 1);
    })
  ) {
    const coinResult = applyCommand(next, { type: "use-coin", player });
    if (coinResult.accepted) next = coinResult.state;
  }
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
        canUnitAttack(unit),
    );
    if (!attacker) {
      break;
    }

    const enemy = otherPlayer(player);
    const taunt = next.players[enemy].board.find(
      (unit) => unit.keywords.includes("taunt") && !unit.stealthActive,
    );
    const visibleUnit = next.players[enemy].board.find(
      (unit) => !unit.stealthActive,
    );
    if (attacker.rushOnly && !taunt && !visibleUnit) break;
    const target: BattleTarget = taunt
      ? { kind: "unit", entityId: taunt.entityId }
      : attacker.rushOnly || visibleUnit
        ? { kind: "unit", entityId: visibleUnit!.entityId }
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

  if (
    next.phase !== "game-over" &&
    !next.players[player].heroPowerUsed &&
    next.players[player].mana >= (next.players[player].heroPower?.cost ?? HERO_POWER_COST)
  ) {
    const powerResult = applyCommand(next, {
      type: "hero-power",
      player,
    });
    if (powerResult.accepted) {
      next = powerResult.state;
      if (next.phase === "game-over") return next;
    }
  }

  const endTurn = applyCommand(next, {
    type: "end-turn",
    player,
  });
  return endTurn.accepted ? endTurn.state : next;
}
