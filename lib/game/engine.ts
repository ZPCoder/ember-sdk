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
  ChooseOneState,
  MatchEndReason,
  MatchState,
  PlayerId,
  PlayerState,
  SecretEffect,
  SecretState,
  SecretTrigger,
  Trait,
  UnitState,
  WeaponState,
} from "./types.ts";

export const HERO_MAX_HEALTH = 30;
export const MAX_MANA = 10;
// Hearthstone ends the match before the second player's 90th turn begins.
export const MAX_TURN = 89;
// Keep the standard battlefield width familiar to Hearthstone players.
export const MAX_BOARD_SIZE = 7;
export const MAX_HAND_SIZE = 10;
export const MAX_SECRETS = 5;
export const STARTING_HAND_SIZE = 3;
export const HERO_POWER_COST = 2;

// Deathrattles can themselves deal damage, summon units, or trigger secrets.
// Keep the reducer re-entrancy guard outside MatchState so it never leaks into
// serialized PVP snapshots while still making one state resolve through a
// single, deterministic death queue.
const resolvingDeathStates = new WeakSet<MatchState>();
// Card text is a sequence. Keep mortally wounded units on the board until
// the outermost effect sequence finishes, so a later sub-effect of the same
// spell can still resolve before the death window begins.
const effectResolutionDepth = new WeakMap<MatchState, number>();
const pendingHeroOutcomeReasons = new WeakMap<MatchState, Exclude<MatchEndReason, "concede" | "draw">>();

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
    weapon: player.weapon ? { ...player.weapon } : null,
    heroHasAttacked: player.heroHasAttacked ?? false,
    secrets: (player.secrets ?? []).map((secret) => ({
      ...secret,
      effect: { ...secret.effect },
    })),
    overload: player.overload ?? 0,
    overloadLocked: player.overloadLocked ?? 0,
    cardsPlayedThisTurn: player.cardsPlayedThisTurn ?? 0,
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
    discover: state.discover
      ? {
          ...state.discover,
          choices: [...state.discover.choices],
        }
      : null,
    chooseOne: state.chooseOne
      ? {
          ...state.chooseOne,
          options: state.chooseOne.options.map((option) => ({
            ...option,
            effects: [...option.effects],
          })),
          target: state.chooseOne.target ? { ...state.chooseOne.target } : undefined,
        }
      : null,
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
    weapon: null,
    heroHasAttacked: false,
    secrets: [],
    overload: 0,
    overloadLocked: 0,
    cardsPlayedThisTurn: 0,
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
    // locked, matching the familiar Hearthstone cadence. The second player's
    // extra opening card is dealt before mulligan (see createMatch), so it
    // must not be drawn a second time here.
    drawCard(state, state.activePlayer);
    // The coin itself is represented as a command rather than a deck card, so
    // it cannot be burned or copied.
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

function handleChooseDiscover(
  state: MatchState,
  command: Extract<BattleCommand, { type: "choose-discover" }>,
): CommandError | null {
  if (state.phase !== "discover" || !state.discover) {
    return {
      code: "discover-closed",
      message: "当前没有可完成的发现选择。",
    };
  }
  if (state.discover.player !== command.player) {
    return {
      code: "not-your-turn",
      message: "只有发起发现的玩家可以做出选择。",
    };
  }
  if (!state.discover.choices.includes(command.cardId) || !CARD_BY_ID[command.cardId]) {
    return {
      code: "invalid-discover",
      message: "所选卡牌不在本次发现候选中。",
    };
  }

  const owner = state.players[command.player];
  const card = CARD_BY_ID[command.cardId];
  if (owner.hand.length >= MAX_HAND_SIZE) {
    appendEvent(
      state,
      "card-burned",
      `玩家 ${command.player} 的手牌已满，发现的 ${card.name} 被销毁。`,
      command.player,
      { cardId: card.id, discovered: true },
    );
  } else {
    owner.hand.push(card.id);
    appendEvent(
      state,
      "card-drawn",
      `玩家 ${command.player} 将 ${card.name} 加入手牌。`,
      command.player,
      { cardId: card.id, discovered: true },
    );
  }
  appendEvent(
    state,
    "discover-chosen",
    `玩家 ${command.player} 选择了 ${card.name}。`,
    command.player,
    { sourceCardId: state.discover.sourceCardId, cardId: card.id },
  );
  state.discover = null;
  state.phase = "main";
  resolveEffectSequence(state, () => {
    resolveSpellPlayTriggers(state, command.player);
  });
  return null;
}

function handleChooseOne(
  state: MatchState,
  command: Extract<BattleCommand, { type: "choose-one" }>,
): CommandError | null {
  if (state.phase !== "choose-one" || !state.chooseOne) {
    return {
      code: "choose-one-closed",
      message: "当前没有可完成的抉择。",
    };
  }
  if (state.chooseOne.player !== command.player) {
    return {
      code: "not-your-turn",
      message: "只有发起抉择的玩家可以做出选择。",
    };
  }
  if (
    !Number.isInteger(command.optionIndex) ||
    command.optionIndex < 0 ||
    command.optionIndex >= state.chooseOne.options.length
  ) {
    return {
      code: "invalid-choose-one",
      message: "所选抉择不在当前候选项中。",
    };
  }

  const pending = state.chooseOne;
  const option = pending.options[command.optionIndex];
  if (!option) {
    return {
      code: "invalid-choose-one",
      message: "所选抉择不存在。",
    };
  }
  // Choose One is a two-step spell in Hearthstone: the card is not cast
  // until the player commits to an option. Counterspell and Overload therefore
  // resolve here, immediately before the selected branch, rather than when
  // the choice panel first opens.
  const sourceCard = CARD_BY_ID[pending.sourceCardId];
  return resolveEffectSequence(state, () => {
    appendEvent(
      state,
      "choose-one-chosen",
      `玩家 ${command.player} 选择了「${option.label}」。`,
      command.player,
      {
        sourceCardId: pending.sourceCardId,
        optionIndex: command.optionIndex,
        optionLabel: option.label,
        target: pending.target,
      },
    );
    state.chooseOne = null;
    state.phase = "main";
    const countered = triggerSecrets(
      state,
      "opponent-plays-spell",
      command.player,
      { cardId: pending.sourceCardId },
    );
    if (countered) return null;
    if (sourceCard?.overload) {
      const owner = state.players[command.player];
      owner.overload += sourceCard.overload;
      appendEvent(
        state,
        "mana-overloaded",
        `玩家 ${command.player} 的下一回合将锁定 ${sourceCard.overload} 点法力。`,
        command.player,
        { cardId: sourceCard.id, amount: sourceCard.overload },
      );
    }
    resolveEffects(
      state,
      command.player,
      option.effects,
      pending.target,
      activeTraitTier(state, command.player, "arcane"),
      spellDamageBonus(state, command.player),
    );
    resolveSpellPlayTriggers(state, command.player);
    return null;
  });
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
    unit.attack > 0 &&
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

function spellDamageBonus(state: MatchState, player: PlayerId): number {
  return state.players[player].board.reduce((total, unit) => {
    const printedBonus = unit.spellDamage ?? CARD_BY_ID[unit.cardId]?.spellDamage ?? 0;
    return total + Math.max(0, printedBonus);
  }, 0);
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

  // A minion at 0 health is in the death window and is no longer a legal
  // character target.  It may still be present in the board array until the
  // current effect sequence reaches its cleanup step, so checking only the
  // entity id here would allow commands to target a dead minion.
  if (target.kind === "unit") {
    const targetUnit = findUnit(state, target.entityId);
    if (!targetUnit || targetUnit.health <= 0) {
      return false;
    }
  }

  switch (rule) {
    case "enemy-character":
      return (
        owner === otherPlayer(player) &&
        !(target.kind === "unit" && (findUnit(state, target.entityId)?.stealthActive ?? false))
      );
    case "friendly-character":
      return owner === player;
    case "any-character":
      return !(
        target.kind === "unit" &&
        owner === otherPlayer(player) &&
        (findUnit(state, target.entityId)?.stealthActive ?? false)
      );
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

function hasValidTarget(
  state: MatchState,
  player: PlayerId,
  rule: CardTargetRule,
): boolean {
  switch (rule) {
    case "none":
      return false;
    case "enemy-character":
      return true;
    case "friendly-character":
      return true;
    case "any-character":
      return true;
    case "enemy-unit":
      return state.players[otherPlayer(player)].board.some(
        (unit) => unit.health > 0 && !unit.stealthActive,
      );
    case "friendly-unit":
      return state.players[player].board.some((unit) => unit.health > 0);
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

function requestHeroOutcome(
  state: MatchState,
  reason: Exclude<MatchEndReason, "concede" | "draw">,
): void {
  if ((effectResolutionDepth.get(state) ?? 0) > 0 || resolvingDeathStates.has(state)) {
    // A hero can reach zero during a spell or trigger sequence, but the
    // sequence must finish before the game checks lethal. Keep the first
    // cause so fatigue victories remain distinguishable from combat damage.
    if (!pendingHeroOutcomeReasons.has(state)) {
      pendingHeroOutcomeReasons.set(state, reason);
    }
    return;
  }
  checkHeroOutcome(state, reason);
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
    requestHeroOutcome(state, "fatigue");
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
  const playOrder = state.nextEntityId;
  state.nextEntityId += 1;
  const rush = card.keywords?.includes("rush") ?? false;
  const charge = card.keywords?.includes("charge") ?? false;

  return {
    entityId,
    cardId: card.id,
    name: card.name,
    owner: player,
    playOrder,
    attack: card.attack ?? 0,
    health: card.health ?? 1,
    maxHealth: card.health ?? 1,
    baseAttack: card.attack ?? 0,
    baseHealth: card.health ?? 1,
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
    silenced: false,
    spellDamage: card.spellDamage ?? 0,
    temporaryAttackBonus: 0,
    temporaryHealthBonus: 0,
  };
}

function createWeapon(card: CardDefinition): WeaponState {
  return {
    cardId: card.id,
    name: card.name,
    attack: card.attack ?? 0,
    durability: Math.max(1, card.durability ?? 1),
    maxDurability: Math.max(1, card.durability ?? 1),
  };
}

function enqueueDeadUnits(
  state: MatchState,
  queue: Array<{ unit: UnitState; player: PlayerId }>,
): void {
  // Remove every currently dead body before resolving any deathrattle. This
  // mirrors Hearthstone's death-resolution window: all simultaneous deaths
  // are locked into the queue, while deaths caused by a later deathrattle are
  // appended after the already queued entries.
  const deadEntries: Array<{
    unit: UnitState;
    player: PlayerId;
    boardIndex: number;
  }> = [];
  for (const player of [0, 1] as const) {
    const board = state.players[player].board;
    board.forEach((unit, boardIndex) => {
      if (unit.health <= 0) deadEntries.push({ unit, player, boardIndex });
    });
    state.players[player].board = board.filter((unit) => unit.health > 0);
  }

  // Hearthstone queues a simultaneous death window by battlefield entry order,
  // not by which side owns the minion.  Older snapshots do not have
  // playOrder, so their board order remains a deterministic compatibility
  // fallback; all newly created units receive the monotonic sequence above.
  deadEntries.sort((left, right) => {
    const leftOrder = left.unit.playOrder;
    const rightOrder = right.unit.playOrder;
    if (leftOrder !== undefined && rightOrder !== undefined && leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    if (left.player !== right.player) return left.player - right.player;
    return left.boardIndex - right.boardIndex;
  });
  for (const entry of deadEntries) {
    queue.push({ unit: entry.unit, player: entry.player });
  }
}

function removeDeadUnits(state: MatchState): void {
  if (resolvingDeathStates.has(state)) return;

  const queue: Array<{ unit: UnitState; player: PlayerId }> = [];
  resolvingDeathStates.add(state);
  try {
    enqueueDeadUnits(state, queue);
    for (let index = 0; index < queue.length; index += 1) {
      const { unit, player } = queue[index];
      appendEvent(
        state,
        "unit-died",
        `${unit.name} 被击败。`,
        unit.owner,
        { entityId: unit.entityId, cardId: unit.cardId, targetPlayer: unit.owner },
      );
      const card = CARD_BY_ID[unit.cardId];
      if (!unit.silenced && card?.onDeath && card.onDeath.length > 0) {
        resolveEffects(state, player, card.onDeath, undefined);
      }
      if (
        !unit.silenced &&
        card?.keywords?.includes("reborn") &&
        !unit.rebornUsed &&
        state.players[player].board.length < MAX_BOARD_SIZE
      ) {
        const reborn = createUnit(state, player, card);
        reborn.health = 1;
        // Reborn returns the minion with one current health, while retaining
        // its printed maximum so later healing and UI health bars remain
        // meaningful.
        reborn.maxHealth = card.health ?? 1;
        reborn.rebornUsed = true;
        state.players[player].board.push(reborn);
        appendEvent(
          state,
          "unit-summoned",
          `${unit.name} 复生。`,
          player,
          { cardId: card.id, entityId: reborn.entityId, reborn: true },
        );
        // Reborn is a fresh summon in Hearthstone's event model.  Let
        // opponent-summon secrets see it just like a token or a hero-power
        // summon, rather than treating it as a purely visual resurrection.
        triggerSecrets(state, "opponent-summons-unit", player);
      }

      // A deathrattle or summon secret may have created more dead units. They
      // are appended after all bodies already present in the queue, so chained
      // effects cannot leapfrog an earlier simultaneous death.
      enqueueDeadUnits(state, queue);
    }
  } finally {
    resolvingDeathStates.delete(state);
    if ((effectResolutionDepth.get(state) ?? 0) === 0) {
      const reason = pendingHeroOutcomeReasons.get(state);
      if (reason) {
        pendingHeroOutcomeReasons.delete(state);
        checkHeroOutcome(state, reason);
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
      {
        amount: actualDamage,
        requestedAmount: amount,
        armorAbsorbed: absorbed,
        target,
        health: hero.health,
        armor: hero.armor,
      },
    );
    if (options.sourceUnit?.keywords.includes("lifesteal") && actualDamage > 0) {
      healTarget(
        state,
        { kind: "hero", player: options.sourceUnit.owner },
        actualDamage,
        options.sourceUnit.owner,
      );
    }
    // A spell's entire text is one Hearthstone sequence.  Keep a hero at
    // zero health until that outer effect sequence finishes so later AoE or
    // secondary effects still resolve before the win/loss check.
    if ((effectResolutionDepth.get(state) ?? 0) === 0) {
      requestHeroOutcome(state, endReason);
    }
    return actualDamage;
  }

  const unit = findUnit(state, target.entityId);
  if (!unit) {
    return 0;
  }

  const shieldIndex = unit.keywords.indexOf("shield");
  if (shieldIndex >= 0) {
    unit.keywords.splice(shieldIndex, 1);
    // A zero-damage hit that consumes Divine Shield is still a Damage Event;
    // it reveals a Stealthed minion even though no Health was lost.
    unit.stealthActive = false;
    appendEvent(
      state,
      "shield-broken",
      `${unit.name} 的护盾抵消了伤害。`,
      unit.owner,
      { amount, entityId: unit.entityId, targetPlayer: unit.owner },
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
      { amount: actualDamage, entityId: unit.entityId, targetPlayer: unit.owner, poisonous: true },
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
      targetPlayer: unit.owner,
      health: unit.health,
    },
  );
  if (options.sourceUnit?.keywords.includes("lifesteal") && actualDamage > 0) {
    healTarget(
      state,
      { kind: "hero", player: options.sourceUnit.owner },
      actualDamage,
      options.sourceUnit.owner,
    );
  }
  if (
    actualDamage > 0 &&
    unit.health > 0 &&
    unit.keywords.includes("fury") &&
    (unit.furyStacks ?? 0) < 2
  ) {
    unit.furyStacks = (unit.furyStacks ?? 0) + 1;
    buffTarget(state, { kind: "unit", entityId: unit.entityId }, 1, 0, unit.owner);
  }
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
    if (healed <= 0) return;
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
  if (healed <= 0) return;
  unit.health += healed;
  appendEvent(
    state,
    "healing",
    `${unit.name} 恢复 ${healed} 点生命。`,
    sourcePlayer,
    { amount: healed, entityId: unit.entityId, targetPlayer: unit.owner, health: unit.health },
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
      targetPlayer: unit.owner,
      attack: unit.attack,
      health: unit.health,
      maxHealth: unit.maxHealth,
    },
  );
}

function buffAllFriendly(
  state: MatchState,
  player: PlayerId,
  attack: number,
  health: number,
  sourcePlayer: PlayerId,
): void {
  const targets = state.players[player].board.map((unit) => unit.entityId);
  for (const entityId of targets) {
    buffTarget(
      state,
      { kind: "unit", entityId },
      attack,
      health,
      sourcePlayer,
    );
  }
}

function temporaryBuffTarget(
  state: MatchState,
  target: BattleTarget,
  attack: number,
  health: number,
  sourcePlayer: PlayerId,
): void {
  if (target.kind !== "unit") return;
  const unit = findUnit(state, target.entityId);
  if (!unit) return;

  unit.attack += attack;
  unit.maxHealth += health;
  unit.health += health;
  unit.temporaryAttackBonus = (unit.temporaryAttackBonus ?? 0) + attack;
  unit.temporaryHealthBonus = (unit.temporaryHealthBonus ?? 0) + health;
  const bonusLabel =
    health === 0
      ? `+${attack} 攻击`
      : attack === 0
        ? `+${health} 生命`
        : `+${attack}/+${health}`;
  appendEvent(
    state,
    "unit-buffed",
    `${unit.name} 暂时获得 ${bonusLabel}，持续到回合结束。`,
    sourcePlayer,
    {
      entityId: unit.entityId,
      attack: unit.attack,
      health: unit.health,
      maxHealth: unit.maxHealth,
      temporary: true,
      duration: "end-of-turn",
      targetPlayer: unit.owner,
    },
  );
}

function clearTemporaryBuffs(state: MatchState, player: PlayerId): void {
  const affected = state.players[player].board.filter(
    (unit) => (unit.temporaryAttackBonus ?? 0) !== 0 || (unit.temporaryHealthBonus ?? 0) !== 0,
  );
  for (const unit of affected) {
    const attack = unit.temporaryAttackBonus ?? 0;
    const health = unit.temporaryHealthBonus ?? 0;
    unit.attack -= attack;
    unit.maxHealth = Math.max(1, unit.maxHealth - health);
    unit.health = Math.min(unit.health, unit.maxHealth);
    unit.temporaryAttackBonus = 0;
    unit.temporaryHealthBonus = 0;
    appendEvent(
      state,
      "temporary-expired",
      `${unit.name} 的回合性增益已结束。`,
      player,
      { entityId: unit.entityId, attack, health },
    );
  }
  removeDeadUnits(state);
}

function resolveUnitTurnEffects(
  state: MatchState,
  player: PlayerId,
  timing: "start" | "end",
): void {
  const entityIds = state.players[player].board.map((unit) => unit.entityId);
  for (const entityId of entityIds) {
    const unit = findUnit(state, entityId);
    if (!unit || unit.owner !== player || unit.silenced) continue;
    const card = CARD_BY_ID[unit.cardId];
    const effects = timing === "start" ? card?.onTurnStart : card?.onTurnEnd;
    if (!effects || effects.length === 0) continue;
    appendEvent(
      state,
      "turn-triggered",
      `${unit.name} 触发${timing === "start" ? "回合开始" : "回合结束"}效果。`,
      player,
      { entityId: unit.entityId, cardId: unit.cardId, timing },
    );
    resolveEffects(
      state,
      player,
      effects,
      { kind: "unit", entityId: unit.entityId },
      activeTraitTier(state, player, "arcane"),
      spellDamageBonus(state, player),
    );
    if (state.phase === "game-over") break;
  }
}

/**
 * Resolve Hearthstone-style "after you play a spell" effects.  The snapshot
 * of entity ids prevents a trigger from accidentally iterating over a unit
 * summoned by an earlier trigger in the same chain.
 */
function resolveSpellPlayTriggers(state: MatchState, player: PlayerId): void {
  if (state.phase === "game-over") return;
  const entityIds = state.players[player].board.map((unit) => unit.entityId);
  for (const entityId of entityIds) {
    const unit = findUnit(state, entityId);
    if (!unit || unit.owner !== player || unit.silenced) continue;
    const effects = CARD_BY_ID[unit.cardId]?.onSpellPlayed;
    if (!effects || effects.length === 0) continue;
    appendEvent(
      state,
      "card-triggered",
      `${unit.name} 触发战术施放效果。`,
      player,
      { entityId: unit.entityId, cardId: unit.cardId, timing: "spell-played" },
    );
    resolveEffects(
      state,
      player,
      effects,
      { kind: "unit", entityId: unit.entityId },
      activeTraitTier(state, player, "arcane"),
      spellDamageBonus(state, player),
    );
    if (state.phase === "game-over") break;
  }
}

function armSecret(
  state: MatchState,
  player: PlayerId,
  card: CardDefinition,
  effect: Extract<CardEffect, { kind: "secret" }>,
): CommandError | null {
  const owner = state.players[player];
  if (owner.secrets.length >= MAX_SECRETS) {
    return {
      code: "secret-limit",
      message: `最多只能同时控制 ${MAX_SECRETS} 个奥秘。`,
    };
  }
  if (owner.secrets.some((secret) => secret.secretId === effect.secretId)) {
    return {
      code: "secret-duplicate",
      message: `奥秘「${card.name}」已经在场上生效。`,
    };
  }

  const secret: SecretState = {
    cardId: card.id,
    secretId: effect.secretId,
    name: card.name,
    description: card.description,
    trigger: effect.trigger,
    effect: { ...effect.effect },
  };
  owner.secrets.push(secret);
  appendEvent(
    state,
    "secret-armed",
    `玩家 ${player} 设置了奥秘「${card.name}」。`,
    player,
    {
      cardId: card.id,
      secretId: effect.secretId,
      trigger: effect.trigger,
    },
  );
  return null;
}

function resolveSecretQueue(
  state: MatchState,
  trigger: SecretTrigger,
  triggeringPlayer: PlayerId,
  context: { attackerId?: string; attackerPlayer?: PlayerId; cardId?: string } = {},
): boolean {
  const owner = otherPlayer(triggeringPlayer);
  const pending = state.players[owner].secrets.filter(
    (secret) => secret.trigger === trigger,
  );
  if (pending.length === 0) return false;

  let countered = false;

  for (const secret of pending) {
    // A Counterspell ends the spell-casting event immediately. Secrets that
    // were queued after it keep their cards because the original spell no
    // longer exists to satisfy their trigger.
    if (countered) break;
    // Secrets with a concrete target are only consumed when that target is
    // still available at their turn in the trigger queue. For example, two
    // attack-damage secrets can be armed at once: if the first one kills the
    // attacker, the second one remains hidden instead of being wasted.
    if (
      secret.effect.kind === "damage-attacker" &&
      !context.attackerId &&
      context.attackerPlayer === undefined
    ) {
      continue;
    }
    if (
      secret.effect.kind === "damage-attacker" &&
      context.attackerId &&
      (findUnit(state, context.attackerId)?.health ?? 0) <= 0
    ) {
      continue;
    }
    const index = state.players[owner].secrets.findIndex(
      (entry) => entry.secretId === secret.secretId,
    );
    if (index < 0 || state.phase === "game-over") continue;
    state.players[owner].secrets.splice(index, 1);
    appendEvent(
      state,
      "secret-triggered",
      `玩家 ${owner} 的奥秘「${secret.name}」被触发。`,
      owner,
      {
        cardId: secret.cardId,
        secretId: secret.secretId,
        trigger,
        secretEffect: secret.effect,
        triggeringPlayer,
        attackerId: context.attackerId,
        attackerPlayer: context.attackerPlayer,
        spellCardId: context.cardId,
      },
    );

    const effect: SecretEffect = secret.effect;
    switch (effect.kind) {
      case "damage-attacker":
        if (context.attackerId) {
          dealDamage(
            state,
            { kind: "unit", entityId: context.attackerId },
            effect.amount + spellDamageBonus(state, owner),
            owner,
          );
        } else if (context.attackerPlayer !== undefined) {
          dealDamage(
            state,
            { kind: "hero", player: context.attackerPlayer },
            effect.amount + spellDamageBonus(state, owner),
            owner,
          );
        }
        break;
      case "damage-enemy-hero":
        dealDamage(
          state,
          { kind: "hero", player: triggeringPlayer },
          effect.amount + spellDamageBonus(state, owner),
          owner,
        );
        break;
      case "draw":
        for (let count = 0; count < effect.count; count += 1) {
          drawCard(state, owner);
          if (state.phase === "game-over") break;
        }
        break;
      case "heal-friendly-hero":
        healTarget(
          state,
          { kind: "hero", player: owner },
          effect.amount,
          owner,
        );
        break;
      case "armor":
        state.players[owner].hero.armor += effect.amount;
        appendEvent(
          state,
          "unit-buffed",
          `玩家 ${owner} 获得 ${effect.amount} 点护甲。`,
          owner,
          { armor: state.players[owner].hero.armor },
        );
        break;
      case "counterspell":
        countered = true;
        appendEvent(
          state,
          "spell-countered",
          `玩家 ${triggeringPlayer} 的法术被奥秘「${secret.name}」反制。`,
          owner,
          {
            cardId: context.cardId,
            secretId: secret.secretId,
            triggeringPlayer,
          },
        );
        break;
    }
  }

  return countered;
}

function triggerSecrets(
  state: MatchState,
  trigger: SecretTrigger,
  triggeringPlayer: PlayerId,
  context: { attackerId?: string; attackerPlayer?: PlayerId; cardId?: string } = {},
): boolean {
  // A top-level attack, spell, or summon creates one Hearthstone Sequence.
  // Keep all secrets raised by its event inside that sequence so a lethal
  // first secret cannot stop the remaining queued secrets from resolving.
  // Nested secret triggers inherit the surrounding effect depth and leave
  // death creation to the outermost phase.
  return resolveEffectSequence(state, () =>
    resolveSecretQueue(state, trigger, triggeringPlayer, context));
}

function resolveEffect(
  state: MatchState,
  player: PlayerId,
  effect: CardEffect,
  target: BattleTarget | undefined,
  numericBonus = 0,
  spellDamage = 0,
): void {
  if (state.phase === "game-over") {
    return;
  }

  switch (effect.kind) {
    case "damage":
      if (target) {
        dealDamage(state, target, effect.amount + numericBonus + spellDamage, player);
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
    case "buff-all-friendly":
      buffAllFriendly(
        state,
        player,
        effect.attack + numericBonus,
        effect.health + numericBonus,
        player,
      );
      break;
    case "temporary-buff":
      if (target) {
        temporaryBuffTarget(
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
        // Every summon source (spell, battlecry/deathrattle, or hero power)
        // must enter the same secret trigger pipeline as a card played from
        // hand.  This keeps summon secrets consistent across effect chains.
        triggerSecrets(state, "opponent-summons-unit", player);
      }
      break;
    }
    case "random-enemy-damage": {
      const enemy = otherPlayer(player);
      const targets: BattleTarget[] = [
        { kind: "hero", player: enemy },
        ...state.players[enemy].board.filter((unit) => unit.health > 0).map(
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
      dealDamage(state, randomTarget, effect.amount + numericBonus + spellDamage, player);
      break;
    }
    case "damage-all-enemies": {
      const enemy = otherPlayer(player);
      const enemyTargets: BattleTarget[] = [
        { kind: "hero", player: enemy },
        // Area-of-effect damage still includes mortally wounded minions that
        // have not reached the death-creation window yet. This matters when
        // a spell has two consecutive AoE effects in one text sequence.
        ...state.players[enemy].board.map(
          (unit): BattleTarget => ({ kind: "unit", entityId: unit.entityId }),
        ),
      ];
      for (const enemyTarget of enemyTargets) {
        dealDamage(
          state,
          enemyTarget,
          effect.amount + numericBonus + spellDamage,
          player,
        );
        if (state.phase === "game-over") break;
      }
      break;
    }
    case "silence": {
      if (target?.kind !== "unit") break;
      const unit = findUnit(state, target.entityId);
      if (!unit || unit.health <= 0) break;
      const card = CARD_BY_ID[unit.cardId];
      const baseAttack = unit.baseAttack ?? card?.attack ?? unit.attack;
      const baseHealth = unit.baseHealth ?? card?.health ?? unit.maxHealth;
      unit.attack = baseAttack;
      unit.maxHealth = baseHealth;
      unit.health = Math.min(unit.health, unit.maxHealth);
      unit.keywords = [];
      unit.spellDamage = 0;
      unit.furyStacks = 0;
      unit.stealthActive = false;
      unit.frozenTurns = 0;
      unit.rushOnly = false;
      unit.rebornUsed = true;
      unit.silenced = true;
      unit.temporaryAttackBonus = 0;
      unit.temporaryHealthBonus = 0;
      appendEvent(
        state,
        "unit-silenced",
        `${unit.name} 被沉默，卡牌文本与临时增益已移除。`,
        player,
        {
          entityId: unit.entityId,
          cardId: unit.cardId,
          attack: unit.attack,
          health: unit.health,
          maxHealth: unit.maxHealth,
        },
      );
      break;
    }
    case "transform": {
      if (target?.kind !== "unit") break;
      const unit = findUnit(state, target.entityId);
      const transformedCard = CARD_BY_ID[effect.cardId];
      if (!unit || unit.health <= 0 || !transformedCard || transformedCard.type !== "unit") break;
      const owner = state.players[unit.owner];
      const index = owner.board.findIndex((entry) => entry.entityId === unit.entityId);
      if (index < 0) break;
      const replacement = createUnit(state, unit.owner, transformedCard);
      // Transform is a fresh card: remove buffs, keywords and deathrattle
      // state, while retaining the board slot identity and entry order for
      // the current view. It should not jump ahead of older deathrattles.
      replacement.entityId = unit.entityId;
      replacement.playOrder = unit.playOrder;
      owner.board[index] = replacement;
      appendEvent(
        state,
        "unit-transformed",
        `${unit.name} 变形为 ${transformedCard.name}。`,
        player,
        {
          entityId: replacement.entityId,
          fromCardId: unit.cardId,
          cardId: transformedCard.id,
        },
      );
      // A non-spell transformation creates a fresh summon event.  Secrets
      // that watch an opponent summon must therefore see the replacement,
      // just as they see a token created by a spell or deathrattle.
      triggerSecrets(state, "opponent-summons-unit", unit.owner);
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
        // Random effects are not player targeting: they can hit Stealth
        // minions, while mortally wounded minions are excluded from the pool.
        (unit) => unit.health > 0,
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
    case "secret":
      // Secrets are armed when the card is played and resolve from triggers.
      break;
    case "discover":
      // Discover pauses the match and is resolved by choose-discover.
      break;
    case "choose-one":
      // Choose One pauses the match and is resolved by choose-one.
      break;
  }

}

function resolveEffectSequence<T>(state: MatchState, callback: () => T): T {
  const depth = effectResolutionDepth.get(state) ?? 0;
  effectResolutionDepth.set(state, depth + 1);
  try {
    return callback();
  } finally {
    if (depth === 0) {
      effectResolutionDepth.delete(state);
      removeDeadUnits(state);
      const reason = pendingHeroOutcomeReasons.get(state) ?? "hero-defeated";
      pendingHeroOutcomeReasons.delete(state);
      requestHeroOutcome(state, reason);
    } else {
      effectResolutionDepth.set(state, depth);
    }
  }
}

function resolveEffects(
  state: MatchState,
  player: PlayerId,
  effects: readonly CardEffect[],
  target: BattleTarget | undefined,
  numericBonus = 0,
  spellDamage = 0,
): void {
  resolveEffectSequence(state, () => {
    for (const effect of effects) {
      resolveEffect(state, player, effect, target, numericBonus, spellDamage);
      if (state.phase === "game-over") {
        break;
      }
    }
  });
}

/**
 * Resolve one played spell as a single Hearthstone Sequence.  Counterspell,
 * Overload, the spell text, Combo, and "after you play a spell" triggers all
 * belong to this sequence; a lethal first effect must not end the game before
 * the remaining phases have had a chance to resolve.
 */
function resolvePlayedSpell(
  state: MatchState,
  command: Extract<BattleCommand, { type: "play-card" }>,
  card: CardDefinition,
  comboActive: boolean,
  secretEffect: Extract<CardEffect, { kind: "secret" }> | undefined,
  discoverEffect: Extract<CardEffect, { kind: "discover" }> | undefined,
  chooseOneEffect: Extract<CardEffect, { kind: "choose-one" }> | undefined,
): CommandError | null {
  return resolveEffectSequence(state, () => {
    // Choose One is intentionally delayed until its branch is selected.
    if (!chooseOneEffect) {
      const countered = triggerSecrets(
        state,
        "opponent-plays-spell",
        command.player,
        { cardId: card.id },
      );
      if (countered) return null;
    }

    if ((card.overload ?? 0) > 0 && !chooseOneEffect) {
      const owner = state.players[command.player];
      owner.overload += card.overload ?? 0;
      appendEvent(
        state,
        "mana-overloaded",
        `玩家 ${command.player} 的下一回合将锁定 ${card.overload} 点法力。`,
        command.player,
        { cardId: card.id, amount: card.overload },
      );
    }

    if (secretEffect) {
      const secretError = armSecret(state, command.player, card, secretEffect);
      if (secretError) return secretError;
    }

    if (chooseOneEffect) {
      if (chooseOneEffect.options.length < 2) {
        return {
          code: "invalid-choose-one",
          message: "抉择卡牌至少需要两个候选项。",
        };
      }
      const options: ChooseOneState["options"] = chooseOneEffect.options.map((option) => ({
        label: option.label,
        effects: [...option.effects],
      }));
      state.phase = "choose-one";
      state.chooseOne = {
        player: command.player,
        sourceCardId: card.id,
        options,
        target: command.target ? { ...command.target } : undefined,
      };
      appendEvent(
        state,
        "choose-one-started",
        `玩家 ${command.player} 需要在 ${options.length} 个抉择中选择一项。`,
        command.player,
        {
          sourceCardId: card.id,
          options: options.map((option) => option.label),
          target: command.target,
        },
      );
    } else if (discoverEffect) {
      const pool = Array.from(new Set(discoverEffect.choices)).filter(
        (cardId) => Boolean(CARD_BY_ID[cardId]),
      );
      if (pool.length === 0) {
        return {
          code: "invalid-discover",
          message: "发现牌池为空，无法完成选择。",
        };
      }
      const choices = pool.length <= 3
        ? pool
        : (() => {
            const shuffled = shuffleWithSeed(pool, state.rngState);
            state.rngState = shuffled.state;
            return shuffled.values.slice(0, 3);
          })();
      state.phase = "discover";
      state.discover = {
        player: command.player,
        sourceCardId: card.id,
        choices,
      };
      appendEvent(
        state,
        "discover-started",
        `玩家 ${command.player} 发现了 ${choices.length} 张候选卡牌。`,
        command.player,
        { sourceCardId: card.id, choices },
      );
    } else if (!secretEffect) {
      const numericBonus = activeTraitTier(state, command.player, "arcane");
      const spellDamage = spellDamageBonus(state, command.player);
      resolveEffects(
        state,
        command.player,
        card.effect ?? [],
        command.target,
        numericBonus,
        spellDamage,
      );
      if (comboActive && card.combo && card.combo.length > 0) {
        appendEvent(
          state,
          "combo-triggered",
          `${card.name} 触发连击。`,
          command.player,
          { cardId: card.id },
        );
        resolveEffects(
          state,
          command.player,
          card.combo,
          command.target,
          activeTraitTier(state, command.player, "arcane"),
          spellDamageBonus(state, command.player),
        );
      }
      resolveSpellPlayTriggers(state, command.player);
    } else {
      // A secret is a spell too: it can trigger "after you play a spell"
      // effects after the secret has been armed.
      resolveSpellPlayTriggers(state, command.player);
    }
    return null;
  });
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
  const currentBaseAttack = unit.baseAttack ?? unit.attack;
  const currentBaseHealth = unit.baseHealth ?? unit.maxHealth;

  unit.attack += attackBonus;
  unit.maxHealth += healthBonus;
  unit.health += healthBonus;
  unit.baseAttack = currentBaseAttack + attackBonus;
  unit.baseHealth = currentBaseHealth + healthBonus;
  unit.stars = 2;
  unit.spellDamage = card.spellDamage ?? unit.spellDamage ?? 0;
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

function handleTradeCard(
  state: MatchState,
  command: Extract<BattleCommand, { type: "trade-card" }>,
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
  if (!card?.tradeable) {
    return {
      code: "not-tradeable",
      message: "这张卡牌不可交易。",
    };
  }
  if (owner.mana < 1) {
    return {
      code: "not-enough-mana",
      message: "交易需要 1 点法力。",
    };
  }

  owner.hand.splice(handIndex, 1);
  owner.mana -= 1;
  const shuffled = shuffleWithSeed(
    [...owner.deck, card.id],
    state.rngState,
  );
  owner.deck = shuffled.values;
  state.rngState = shuffled.state;
  appendEvent(
    state,
    "card-traded",
    `玩家 ${command.player} 将 ${card.name} 洗回牌库并抽取替代牌。`,
    command.player,
    { cardId: card.id, cost: 1 },
  );
  drawCard(state, command.player);
  return null;
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
  if (
    card.type !== "unit" &&
    targetRule !== "none" &&
    !hasValidTarget(state, command.player, targetRule)
  ) {
    return {
      code: "invalid-target",
      message: "当前没有符合卡牌要求的合法目标。",
    };
  }
  const targetIsRequired =
    targetRule !== "none" &&
    (card.type !== "unit" || hasValidTarget(state, command.player, targetRule));
  if (targetIsRequired && !command.target) {
    return {
      code: "target-required",
      message: "这张卡牌需要选择一个目标。",
    };
  }
  if (
    command.target &&
    !isTargetValid(state, command.player, targetRule, command.target)
  ) {
    return {
      code: "invalid-target",
      message: "所选目标不符合卡牌要求。",
    };
  }

  const comboActive = owner.cardsPlayedThisTurn > 0;

  const secretEffect = card.effect?.find(
    (effect): effect is Extract<CardEffect, { kind: "secret" }> => effect.kind === "secret",
  );
  const discoverEffect = card.effect?.find(
    (effect): effect is Extract<CardEffect, { kind: "discover" }> => effect.kind === "discover",
  );
  const chooseOneEffect = card.effect?.find(
    (effect): effect is Extract<CardEffect, { kind: "choose-one" }> => effect.kind === "choose-one",
  );
  if (secretEffect && owner.secrets.length >= MAX_SECRETS) {
    return {
      code: "secret-limit",
      message: `最多只能同时控制 ${MAX_SECRETS} 个奥秘。`,
    };
  }
  if (
    secretEffect &&
    owner.secrets.some((secret) => secret.secretId === secretEffect.secretId)
  ) {
    return {
      code: "secret-duplicate",
      message: `奥秘「${card.name}」已经在场上生效。`,
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
  owner.cardsPlayedThisTurn += 1;

  if (card.type === "spell") {
    return resolvePlayedSpell(
      state,
      command,
      card,
      comboActive,
      secretEffect,
      discoverEffect,
      chooseOneEffect,
    );
  }

  // Overload is card text, not a spell-only cost modifier.  Keep this path
  // for any future unit or weapon that carries the keyword; Counterspell can
  // only prevent the spell branch above.
  if ((card.overload ?? 0) > 0) {
    owner.overload += card.overload ?? 0;
    appendEvent(
      state,
      "mana-overloaded",
      `玩家 ${command.player} 的下一回合将锁定 ${card.overload} 点法力。`,
      command.player,
      { cardId: card.id, amount: card.overload },
    );
  }

  if (card.type === "unit") {
    return resolveEffectSequence(state, () => {
      let summonedUnit: UnitState | undefined;
      if (upgradeTarget) {
        upgradeUnit(state, command.player, upgradeTarget, card);
      } else {
        const unit = createUnit(state, command.player, card);
        owner.board.push(unit);
        summonedUnit = unit;
        appendEvent(
          state,
          "unit-summoned",
          `${card.name} 进入战场。`,
          command.player,
          { cardId: card.id, entityId: unit.entityId },
        );
      }
      // The minion's Battlecry/Combo and its after-summon secrets are one
      // Hearthstone Sequence. A lethal Battlecry therefore cannot skip the
      // remaining phases, while a minion that died during its Battlecry is no
      // longer a valid subject for Mirror Entity-style effects.
      resolveEffects(state, command.player, card.onPlay ?? [], command.target);
      if (comboActive && card.combo && card.combo.length > 0) {
        appendEvent(
          state,
          "combo-triggered",
          `${card.name} 触发连击。`,
          command.player,
          { cardId: card.id },
        );
        resolveEffects(
          state,
          command.player,
          card.combo,
          command.target,
          activeTraitTier(state, command.player, "arcane"),
        );
      }
      if (
        summonedUnit &&
        summonedUnit.health > 0 &&
        findUnit(state, summonedUnit.entityId)
      ) {
        triggerSecrets(state, "opponent-summons-unit", command.player);
      }
      return null;
    });
  } else if (card.type === "weapon") {
    const previousWeapon = owner.weapon;
    if (previousWeapon) {
      // Equipping a new weapon first destroys the old weapon, then equips the
      // replacement. Keep the event order aligned with Hearthstone's play
      // sequence so replay and future weapon triggers observe the same state.
      appendEvent(
        state,
        "weapon-broke",
        `${previousWeapon.name} 被新武器替换。`,
        command.player,
        {
          cardId: previousWeapon.cardId,
          reason: "replaced",
          replacementCardId: card.id,
        },
      );
    }
    owner.weapon = createWeapon(card);
    appendEvent(
      state,
      "weapon-equipped",
      `玩家 ${command.player} 装备了 ${card.name}。`,
      command.player,
      {
        cardId: card.id,
        attack: owner.weapon.attack,
        durability: owner.weapon.durability,
        replacedCardId: previousWeapon?.cardId,
      },
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
    (unit) => unit.health > 0 && unit.keywords.includes("taunt") && !unit.stealthActive,
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
  if (defendingUnit && defendingUnit.health <= 0) {
    return {
      code: "invalid-target",
      message: "目标单位已阵亡。",
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
      attackerName: attacker.name,
      target: command.target,
      targetName: defendingUnit?.name ?? `玩家 ${enemy} 的核心`,
    },
  );

  if (command.target.kind === "hero") {
    triggerSecrets(state, "opponent-attacks-hero", command.player, {
      attackerId: attacker.entityId,
    });
    if (attacker.health <= 0 || !findUnit(state, attacker.entityId)) {
      removeDeadUnits(state);
      return null;
    }
  }

  const swiftBonus = unitHasTrait(attacker, "swift")
    ? activeTraitTier(state, command.player, "swift")
    : 0;
  const huntTier = unitHasTrait(attacker, "hunt")
    ? activeTraitTier(state, command.player, "hunt")
    : 0;
  const attackerDamage = attacker.attack + swiftBonus;
  const defenderDamage = defendingUnit?.attack ?? 0;
  dealDamage(
    state,
    command.target,
    attackerDamage,
    command.player,
    "hero-defeated",
    { combat: true, sourceUnit: attacker },
  );
  // Combat damage is simultaneous.  Capture the defender's attack before
  // applying either hit, then let the defender strike back even when the
  // first hit reduced it to zero health.  The death queue runs only after
  // both sides have dealt their combat damage.
  if (defendingUnit && state.phase !== "game-over") {
    dealDamage(
      state,
      { kind: "unit", entityId: attacker.entityId },
      defenderDamage,
      enemy,
      "hero-defeated",
      { combat: true, sourceUnit: defendingUnit },
    );
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

function handleHeroAttack(
  state: MatchState,
  command: Extract<BattleCommand, { type: "hero-attack" }>,
): CommandError | null {
  const owner = state.players[command.player];
  const weapon = owner.weapon;
  if (!weapon || weapon.durability <= 0) {
    return {
      code: "weapon-unavailable",
      message: "当前没有可用武器。",
    };
  }
  if (owner.heroHasAttacked) {
    return {
      code: "hero-exhausted",
      message: "英雄本回合已经攻击过。",
    };
  }

  const targetOwner = getTargetOwner(state, command.target);
  const enemy = otherPlayer(command.player);
  if (targetOwner !== enemy) {
    return {
      code: "invalid-target",
      message: "英雄只能攻击敌方角色。",
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

  const enemyTaunts = state.players[enemy].board.filter(
    (unit) => unit.health > 0 && unit.keywords.includes("taunt") && !unit.stealthActive,
  );
  if (enemyTaunts.length > 0) {
    if (command.target.kind !== "unit") {
      return {
        code: "taunt-blocking",
        message: "必须优先攻击具有嘲讽的敌方单位。",
      };
    }
    if (!enemyTaunts.some((unit) => unit.entityId === command.target.entityId)) {
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
  if (defendingUnit && defendingUnit.health <= 0) {
    return {
      code: "invalid-target",
      message: "目标单位已阵亡。",
    };
  }

  owner.heroHasAttacked = true;
  appendEvent(
    state,
    "attack",
    `玩家 ${command.player} 使用 ${weapon.name} 发起英雄攻击。`,
    command.player,
    {
      attackerId: `hero-${command.player}`,
      attackerKind: "hero",
      attackerName: "远征指挥官",
      weaponId: weapon.cardId,
      target: command.target,
      targetName: defendingUnit?.name ?? `玩家 ${enemy} 的核心`,
    },
  );

  // A hero attacking the enemy hero is also an attack event for the
  // defender's secrets.  The attacker is the hero itself, so damage-attacker
  // secrets must resolve against the hero rather than looking for a minion
  // entity id.  If the secret defeats the hero, the attack never reaches the
  // combat-damage point and the weapon does not lose durability.
  if (command.target.kind === "hero") {
    triggerSecrets(state, "opponent-attacks-hero", command.player, {
      attackerPlayer: command.player,
    });
    if (state.phase === "game-over" || owner.hero.health <= 0) {
      removeDeadUnits(state);
      return null;
    }
  }

  dealDamage(
    state,
    command.target,
    weapon.attack,
    command.player,
    "hero-defeated",
    { combat: true },
  );
  // A minion still deals its combat damage when the hero's weapon hit kills
  // it; both combatants have already committed their damage at this point.
  if (defendingUnit && state.phase !== "game-over") {
    dealDamage(
      state,
      { kind: "hero", player: command.player },
      defendingUnit.attack,
      enemy,
      "hero-defeated",
      { combat: true, sourceUnit: defendingUnit },
    );
  }

  weapon.durability -= 1;
  if (weapon.durability <= 0) {
    const brokenCardId = weapon.cardId;
    owner.weapon = null;
    appendEvent(
      state,
      "weapon-broke",
      `${weapon.name} 耐久耗尽。`,
      command.player,
      { cardId: brokenCardId },
    );
  }
  removeDeadUnits(state);
  return null;
}

function handleEndTurn(
  state: MatchState,
  player: PlayerId,
  reason: "manual" | "timeout" = "manual",
): CommandError | null {
  resolveUnitTurnEffects(state, player, "end");
  if (state.phase === "game-over") return null;
  clearTemporaryBuffs(state, player);

  appendEvent(
    state,
    reason === "timeout" ? "turn-timed-out" : "turn-ended",
    reason === "timeout"
      ? `玩家 ${player} 行动超时，回合自动结束。`
      : `玩家 ${player} 结束了回合。`,
    player,
    reason === "timeout" ? { timeout: true } : undefined,
  );

  const next = otherPlayer(player);
  state.activePlayer = next;
  state.turn += 1;

  // Prevent infinite fatigue loops in exceptionally long control games. The
  // 90th turn never opens an action window; both heroes explode and the match
  // is recorded as a draw.
  if (state.turn > MAX_TURN) {
    finishMatch(state, null, "draw");
    return null;
  }

  const nextPlayer = state.players[next];
  const lockedMana = nextPlayer.overload;
  nextPlayer.maxMana = Math.min(MAX_MANA, nextPlayer.maxMana + 1);
  nextPlayer.overloadLocked = lockedMana;
  nextPlayer.mana = Math.max(0, nextPlayer.maxMana - lockedMana);
  nextPlayer.overload = 0;
  nextPlayer.cardsPlayedThisTurn = 0;
  nextPlayer.heroPowerUsed = false;
  nextPlayer.heroHasAttacked = false;
  for (const unit of state.players[player].board) {
    if (unit.frozenTurns > 0) {
      unit.frozenTurns -= 1;
    }
  }
  for (const unit of nextPlayer.board) {
    unit.attacksMade = 0;
    if (unit.frozenTurns > 0) {
      // Freeze consumes the next attack, so a minion frozen during the
      // opponent's turn remains unable to attack throughout this turn.  The
      // counter is consumed when its controller ends the turn, not when the
      // turn begins.
      unit.hasAttacked = true;
      unit.summoningSick = false;
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
    { mana: nextPlayer.mana, maxMana: nextPlayer.maxMana, lockedMana },
  );
  // Start-of-turn triggers resolve before the natural draw. This matches the
  // Hearthstone phase order and matters when a trigger fills the hand, causes
  // fatigue, or changes the board before the draw is attempted.
  resolveUnitTurnEffects(state, next, "start");
  if (state.phase === "game-over") return null;
  drawCard(state, next);

  return null;
}

function handleHeroPower(
  state: MatchState,
  command: Extract<BattleCommand, { type: "hero-power" }>,
): CommandError | null {
  const player = command.player;
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

  const targetRule = heroPower.target ?? "none";
  if (targetRule !== "none" && !command.target) {
    return {
      code: "target-required",
      message: "该核心技能需要选择一个目标。",
    };
  }
  if (!isTargetValid(state, player, targetRule, command.target)) {
    return {
      code: "invalid-target",
      message: "所选目标不符合核心技能要求。",
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
      target: command.target,
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
    case "damage-enemy-unit":
      if (command.target?.kind === "unit") {
        dealDamage(state, command.target, heroPower.effect.amount, player);
      }
      break;
    case "heal-friendly-hero":
      healTarget(
        state,
        { kind: "hero", player },
        heroPower.effect.amount,
        player,
      );
      break;
    case "heal-friendly-character":
      if (command.target) {
        healTarget(state, command.target, heroPower.effect.amount, player);
      }
      break;
    case "heal-friendly-unit":
      if (command.target?.kind === "unit") {
        healTarget(state, command.target, heroPower.effect.amount, player);
      }
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
  removeDeadUnits(state);
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

  // The Coin is a real 0-cost spell in Hearthstone, not a free resource
  // button. It is consumed before the spell window, can be countered by an
  // opposing Counterspell, and can wake up "after you play a spell" effects.
  // Keep the existing hero-power event shape for backwards-compatible client
  // feedback; `coin: true` makes the effect mapper render the Coin treatment.
  return resolveEffectSequence(state, () => {
    owner.coinAvailable = false;
    const absorbsOverloadDebt = owner.overloadLocked > owner.maxMana;
    appendEvent(
      state,
      "hero-power",
      `玩家 ${player} 使用幸运币。`,
      player,
      {
        cost: 0,
        bonusMana: absorbsOverloadDebt ? 0 : 1,
        overloadAbsorbed: absorbsOverloadDebt ? 1 : 0,
        coin: true,
        spell: true,
        cardId: "the-coin",
      },
    );

    const countered = triggerSecrets(
      state,
      "opponent-plays-spell",
      player,
      { cardId: "the-coin" },
    );
    if (countered) return null;

    if (absorbsOverloadDebt) {
      // Temporary mana is spent before permanent crystals. When pending
      // Overload exceeds the player's maximum, the Coin first pays down the
      // excess debt and does not create usable mana yet.
      owner.overloadLocked -= 1;
    } else {
      owner.mana += 1;
    }
    resolveSpellPlayTriggers(state, player);
    return null;
  });
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
    discover: null,
    chooseOne: null,
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

  // The second player sees four cards during mulligan (plus the Coin). Deal
  // that extra opening card before either player confirms their hand so the
  // mulligan window presents the same choices as Hearthstone.
  drawCard(state, otherPlayer(startingPlayer));

  return state;
}

/**
 * Pick an AI mulligan that follows the same early-curve priorities players
 * expect from a Hearthstone-style opening: keep a couple of cheap plays,
 * avoid duplicate expensive cards, and replace the rest before turn one.
 */
export function chooseAiMulliganIndexes(
  state: MatchState,
  player: PlayerId,
): number[] {
  const hand = state.players[player].hand;
  const entries = hand.map((cardId, index) => ({
    card: CARD_BY_ID[cardId],
    index,
  }));
  const keep = new Set<number>();
  const keptCardIds = new Set<string>();
  const sorted = entries
    .filter((entry): entry is { card: CardDefinition; index: number } => Boolean(entry.card))
    .sort((left, right) => left.card.cost - right.card.cost || left.index - right.index);

  for (const entry of sorted) {
    if (keep.size >= 2 || entry.card.cost > 2 || keptCardIds.has(entry.card.id)) {
      continue;
    }
    keep.add(entry.index);
    keptCardIds.add(entry.card.id);
  }

  // A poor draw should still retain its cheapest playable card rather than
  // throwing the entire hand back and risking another dead opening.
  if (keep.size === 0 && sorted[0]) {
    keep.add(sorted[0].index);
  }

  return entries
    .filter((entry) => !keep.has(entry.index))
    .map((entry) => entry.index);
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
    state.phase === "discover" &&
    command.type !== "choose-discover" &&
    command.type !== "concede"
  ) {
    return reject(state, {
      code: "discover-closed",
      message: "请先完成发现选择，再继续行动。",
    });
  }

  if (
    state.phase === "choose-one" &&
    command.type !== "choose-one" &&
    command.type !== "concede"
  ) {
    return reject(state, {
      code: "choose-one-closed",
      message: "请先完成抉择，再继续行动。",
    });
  }

  if (command.type === "choose-discover" && state.phase !== "discover") {
    return reject(state, {
      code: "discover-closed",
      message: "当前没有可完成的发现选择。",
    });
  }

  if (command.type === "choose-one" && state.phase !== "choose-one") {
    return reject(state, {
      code: "choose-one-closed",
      message: "当前没有可完成的抉择。",
    });
  }

  if (
    command.type !== "mulligan" &&
    command.type !== "concede" &&
    command.type !== "choose-discover" &&
    command.type !== "choose-one" &&
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
    command.type !== "choose-discover" &&
    command.type !== "choose-one" &&
    command.player !== state.activePlayer
  ) {
    return reject(state, {
      code: "not-your-turn",
      message: "当前不是该玩家的回合。",
    });
  }

  if (
    command.type === "choose-discover" &&
    command.player !== state.discover?.player
  ) {
    return reject(state, {
      code: "not-your-turn",
      message: "只有发起发现的玩家可以做出选择。",
    });
  }

  if (
    command.type === "choose-one" &&
    command.player !== state.chooseOne?.player
  ) {
    return reject(state, {
      code: "not-your-turn",
      message: "只有发起抉择的玩家可以做出选择。",
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
    case "trade-card":
      error = handleTradeCard(next, command);
      break;
    case "attack":
      error = handleAttack(next, command);
      break;
    case "hero-attack":
      error = handleHeroAttack(next, command);
      break;
    case "choose-discover":
      error = handleChooseDiscover(next, command);
      break;
    case "choose-one":
      error = handleChooseOne(next, command);
      break;
    case "hero-power":
      error = handleHeroPower(next, command);
      break;
    case "use-coin":
      error = handleUseCoin(next, command.player);
      break;
    case "end-turn":
      error = handleEndTurn(next, command.player, command.reason ?? "manual");
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
  card?: CardDefinition,
): BattleTarget | undefined {
  const enemy = otherPlayer(player);
  const cardEffects = [
    ...(card?.effect ?? []),
    ...(card?.onPlay ?? []),
    ...(card?.combo ?? []),
  ];
  const hasEffect = (kind: CardEffect["kind"]): boolean =>
    cardEffects.some((effect) => effect.kind === kind);
  // Targeted burn should close out a game before the AI spends it on a
  // minion.  This mirrors the basic Hearthstone heuristic of checking lethal
  // first, while still letting ordinary battlecries use the cheaper fallback
  // below.  Spell damage and the Arcane trait are included because they are
  // already applied by the reducer when the spell resolves.
  const directDamage = card?.type === "spell"
    ? cardEffects.reduce(
        (total, effect) => total + (effect.kind === "damage" ? effect.amount : 0),
        0,
      ) + activeTraitTier(state, player, "arcane") + spellDamageBonus(state, player)
    : 0;
  const friendlyUnits = state.players[player].board;
  const enemyUnits = state.players[enemy].board.filter((unit) => !unit.stealthActive);
  const mostDamagedFriendly = [...friendlyUnits]
    .filter((unit) => unit.health < unit.maxHealth)
    .sort((left, right) =>
      right.maxHealth - right.health - (left.maxHealth - left.health) ||
      right.attack - left.attack,
    )[0];
  const bestEnemyUnit = [...enemyUnits].sort((left, right) =>
    right.attack - left.attack || left.health - right.health,
  )[0];

  switch (rule) {
    case "none":
      return undefined;
    case "enemy-character":
      if (directDamage > 0 && state.players[enemy].hero.health <= directDamage) {
        return { kind: "hero", player: enemy };
      }
      // Prefer removing a threatening minion when the spell can finish it;
      // otherwise preserve the familiar direct-to-hero behaviour.
      if (
        hasEffect("damage") &&
        bestEnemyUnit &&
        bestEnemyUnit.health <= Math.max(2, directDamage)
      ) {
        return { kind: "unit", entityId: bestEnemyUnit.entityId };
      }
      return { kind: "hero", player: enemy };
    case "friendly-character":
      return mostDamagedFriendly
        ? { kind: "unit", entityId: mostDamagedFriendly.entityId }
        : { kind: "hero", player };
    case "any-character":
      if (directDamage > 0 && state.players[enemy].hero.health <= directDamage) {
        return { kind: "hero", player: enemy };
      }
      if (hasEffect("heal") && mostDamagedFriendly) {
        return { kind: "unit", entityId: mostDamagedFriendly.entityId };
      }
      if (hasEffect("damage") && bestEnemyUnit) {
        return { kind: "unit", entityId: bestEnemyUnit.entityId };
      }
      return { kind: "hero", player: enemy };
    case "enemy-unit": {
      return bestEnemyUnit ? { kind: "unit", entityId: bestEnemyUnit.entityId } : undefined;
    }
    case "friendly-unit": {
      const unit = mostDamagedFriendly ?? [...friendlyUnits].sort(
        (left, right) => right.attack - left.attack || right.health - left.health,
      )[0];
      return unit ? { kind: "unit", entityId: unit.entityId } : undefined;
    }
  }
}

function chooseAiAttackTarget(
  state: MatchState,
  player: PlayerId,
  attacker: UnitState,
): BattleTarget | undefined {
  const enemy = otherPlayer(player);
  const enemyUnits = state.players[enemy].board.filter((unit) => !unit.stealthActive);
  const taunts = enemyUnits.filter((unit) => unit.keywords.includes("taunt"));
  const attackDamage = attacker.attack + (
    unitHasTrait(attacker, "swift")
      ? activeTraitTier(state, player, "swift")
      : 0
  );
  const canKill = (unit: UnitState): boolean =>
    attacker.keywords.includes("poisonous") || attackDamage >= unit.health;
  const chooseUnit = (units: UnitState[]): BattleTarget | undefined => {
    const target = [...units].sort((left, right) =>
      Number(canKill(right)) - Number(canKill(left)) ||
      right.attack - left.attack ||
      left.health - right.health,
    )[0];
    return target ? { kind: "unit", entityId: target.entityId } : undefined;
  };

  if (taunts.length > 0) {
    return chooseUnit(taunts);
  }

  // Rush is constrained to minions, while an ordinary attacker should take
  // lethal immediately and otherwise avoid throwing itself into an
  // unprofitable trade when it can pressure the enemy hero.
  if (attacker.rushOnly) {
    return chooseUnit(enemyUnits);
  }
  if (attackDamage >= state.players[enemy].hero.health) {
    return { kind: "hero", player: enemy };
  }
  const killable = enemyUnits.filter(canKill);
  return killable.length > 0
    ? chooseUnit(killable)
    : { kind: "hero", player: enemy };
}

function chooseAiAttacker(
  state: MatchState,
  player: PlayerId,
): UnitState | undefined {
  const enemyHeroHealth = state.players[otherPlayer(player)].hero.health;
  const attackers = state.players[player].board.filter(canUnitAttack);
  return [...attackers].sort((left, right) => {
    const leftDamage = left.attack + (
      unitHasTrait(left, "swift")
        ? activeTraitTier(state, player, "swift")
        : 0
    );
    const rightDamage = right.attack + (
      unitHasTrait(right, "swift")
        ? activeTraitTier(state, player, "swift")
        : 0
    );
    // Resolve a lethal attacker first, then use the highest-pressure body.
    return Number(rightDamage >= enemyHeroHealth) - Number(leftDamage >= enemyHeroHealth) ||
      rightDamage - leftDamage ||
      Number(right.keywords.includes("windfury")) - Number(left.keywords.includes("windfury"));
  })[0];
}

function chooseAiHeroAttackTarget(
  state: MatchState,
  player: PlayerId,
  attack: number,
): BattleTarget {
  const enemy = otherPlayer(player);
  const enemyUnits = state.players[enemy].board.filter((unit) => !unit.stealthActive);
  const taunts = enemyUnits.filter((unit) => unit.keywords.includes("taunt"));
  if (taunts.length > 0) {
    const target = [...taunts].sort(
      (left, right) => Number(attack >= right.health) - Number(attack >= left.health) || right.attack - left.attack,
    )[0];
    return { kind: "unit", entityId: target.entityId };
  }
  if (attack >= state.players[enemy].hero.health) {
    return { kind: "hero", player: enemy };
  }
  const killable = enemyUnits
    .filter((unit) => attack >= unit.health)
    .sort((left, right) => right.attack - left.attack || left.health - right.health)[0];
  return killable
    ? { kind: "unit", entityId: killable.entityId }
    : { kind: "hero", player: enemy };
}

function shouldAiUseHeroPower(state: MatchState, player: PlayerId): boolean {
  const owner = state.players[player];
  const effect = owner.heroPower?.effect;
  if (!effect) return false;
  switch (effect.kind) {
    case "heal-friendly-hero":
      return owner.hero.health < owner.hero.maxHealth;
    case "heal-friendly-character":
      return owner.hero.health < owner.hero.maxHealth || owner.board.some((unit) => unit.health < unit.maxHealth);
    case "heal-friendly-unit":
      return owner.board.some((unit) => unit.health < unit.maxHealth);
    case "draw":
      return owner.hand.length < MAX_HAND_SIZE && owner.deck.length > 0;
    case "summon":
      return owner.board.length < MAX_BOARD_SIZE;
    case "armor":
      return owner.hero.health <= Math.ceil(owner.hero.maxHealth * 0.75) || owner.hero.armor < 2;
    case "damage-enemy-hero":
      return true;
    case "damage-enemy-unit":
      return state.players[otherPlayer(player)].board.some((unit) => !unit.stealthActive);
  }
}

function chooseAiHeroPowerTarget(
  state: MatchState,
  player: PlayerId,
): BattleTarget | undefined {
  const heroPower = state.players[player].heroPower;
  const targetRule = heroPower?.target ?? "none";
  if (targetRule === "none") return undefined;
  const enemy = otherPlayer(player);
  if (targetRule === "enemy-unit") {
    const target = state.players[enemy].board
      .filter((unit) => !unit.stealthActive)
      .sort((left, right) =>
        Number((heroPower?.effect.kind === "damage-enemy-unit" && right.health <= heroPower.effect.amount)) -
        Number((heroPower?.effect.kind === "damage-enemy-unit" && left.health <= heroPower.effect.amount)) ||
        right.attack - left.attack ||
        left.health - right.health,
      )[0];
    return target ? { kind: "unit", entityId: target.entityId } : undefined;
  }
  if (targetRule === "friendly-unit") {
    const target = state.players[player].board
      .filter((unit) => unit.health < unit.maxHealth)
      .sort((left, right) =>
        (right.maxHealth - right.health) - (left.maxHealth - left.health) ||
        right.attack - left.attack,
      )[0];
    return target ? { kind: "unit", entityId: target.entityId } : undefined;
  }
  if (targetRule === "friendly-character") {
    const target = state.players[player].board
      .filter((unit) => unit.health < unit.maxHealth)
      .sort((left, right) =>
        (right.maxHealth - right.health) - (left.maxHealth - left.health) ||
        right.attack - left.attack,
      )[0];
    if (target) return { kind: "unit", entityId: target.entityId };
    return state.players[player].hero.health < state.players[player].hero.maxHealth
      ? { kind: "hero", player }
      : undefined;
  }
  return chooseAiTarget(state, player, targetRule);
}

function aiHasTarget(
  state: MatchState,
  player: PlayerId,
  rule: CardTargetRule,
): boolean {
  switch (rule) {
    case "none":
    case "enemy-character":
    case "friendly-character":
    case "any-character":
      return true;
    case "friendly-unit":
      return state.players[player].board.length > 0;
    case "enemy-unit":
      // Stealthed enemy units cannot be selected by ordinary targeted cards.
      return state.players[otherPlayer(player)].board.some((unit) => !unit.stealthActive);
  }
}

/**
 * Give the AI a small amount of Hearthstone-style board awareness. Mana is
 * still the primary constraint, but a card that develops a board, answers a
 * threat, or generates cards should beat an otherwise arbitrary same-cost
 * choice. The function is deterministic so replays remain reproducible.
 */
function scoreAiCard(
  state: MatchState,
  player: PlayerId,
  card: CardDefinition,
): number {
  const owner = state.players[player];
  const enemy = state.players[otherPlayer(player)];
  const effects = [
    ...(card.effect ?? []),
    ...(card.onPlay ?? []),
    ...(card.combo ?? []),
  ];
  let score = card.cost * 1.4;

  if (card.type === "unit") {
    score += 18 + (card.attack ?? 0) * 2 + (card.health ?? 0);
    if (owner.board.length === 0) score += 7;
    if (owner.board.length >= MAX_BOARD_SIZE - 1) score -= 4;
    if (findUpgradeTarget(owner, card)) score += 14;
  } else if (card.type === "weapon") {
    score += 10 + (card.attack ?? 0) * 2 + (card.durability ?? 0) * 1.5;
    score += owner.weapon ? -3 : 5;
  } else {
    score += 8;
  }

  for (const keyword of card.keywords ?? []) {
    score += {
      taunt: enemy.board.length > 0 ? 5 : 2,
      rush: enemy.board.length > 0 ? 4 : 1,
      charge: 4,
      shield: 3,
      lifesteal: owner.hero.health < owner.hero.maxHealth ? 4 : 1,
      windfury: 4,
      poisonous: enemy.board.length > 0 ? 5 : 1,
      reborn: 3,
      stealth: 3,
      battlecry: 2,
      deathrattle: 2,
      discover: 5,
      secret: 4,
      tradeable: owner.hand.length >= 8 ? 2 : 0,
      overload: -1,
      combo: owner.cardsPlayedThisTurn > 0 ? 3 : 0,
      "spell-damage": 3,
      silence: enemy.board.length > 0 ? 5 : 0,
      transform: enemy.board.length > 0 ? 6 : 0,
      "choose-one": 4,
      temporary: 2,
      "start-of-turn": 2,
      "end-of-turn": 2,
      "spell-trigger": 3,
      freeze: enemy.board.length > 0 ? 4 : 0,
    }[keyword] ?? 0;
  }

  for (const effect of effects) {
    switch (effect.kind) {
      case "damage":
        score += effect.amount * 2;
        if (enemy.hero.health <= effect.amount) score += 30;
        if (enemy.board.some((unit) => unit.health <= effect.amount && !unit.stealthActive)) score += 8;
        break;
      case "random-enemy-damage":
        score += effect.amount * 1.4;
        break;
      case "damage-all-enemies":
        score += effect.amount * (enemy.board.filter((unit) => !unit.stealthActive).length + 1) * 1.5;
        break;
      case "heal":
      case "armor":
        score += owner.hero.health < owner.hero.maxHealth ? effect.amount * 1.5 : -2;
        break;
      case "draw":
        score += owner.hand.length < 7 ? 7 * effect.count : -5 * effect.count;
        break;
      case "discover":
        score += 8;
        break;
      case "choose-one":
        score += 7;
        break;
      case "buff":
      case "buff-all-friendly":
      case "temporary-buff":
        score += owner.board.length > 0
          ? Math.max(2, effect.attack + effect.health) * 2
          : -8;
        break;
      case "summon":
        score += effect.count * 6;
        break;
      case "silence":
      case "transform":
        score += enemy.board.some((unit) => !unit.stealthActive) ? 8 : -8;
        break;
      case "freeze":
      case "random-enemy-freeze":
        score += enemy.board.length > 0 ? 5 : 0;
        break;
      case "secret":
        score += 4;
        break;
    }
  }

  // Spending the last available crystal is a mild tie-breaker, not a hard
  // rule: a useful 1-cost play can still beat an awkward expensive card.
  if (card.cost === owner.mana) score += 3;
  return score;
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
  if (card.type === "unit" && rule !== "none" && !hasValidTarget(state, player, rule)) {
    // A targeted Battlecry does not prevent a minion from being played when
    // no legal target exists; the Battlecry simply has no effect.
    return true;
  }
  return aiHasTarget(state, player, rule);
}

export function runAiTurn(
  state: MatchState,
  player: PlayerId = state.activePlayer,
  onStep?: (state: MatchState, command: BattleCommand) => void,
): MatchState {
  if (state.phase === "game-over") {
    return state;
  }

  if (state.phase === "mulligan") {
    const result = applyCommand(state, {
      type: "mulligan",
      player,
      cardIndexes: chooseAiMulliganIndexes(state, player),
    });
    return result.accepted ? result.state : state;
  }

  if (state.phase === "discover" && state.discover?.player === player) {
    const choice = state.discover.choices[0];
    if (!choice) return state;
    const result = applyCommand(state, {
      type: "choose-discover",
      player,
      cardId: choice,
    });
    return result.accepted ? result.state : state;
  }

  if (state.phase === "choose-one" && state.chooseOne?.player === player) {
    const result = applyCommand(state, {
      type: "choose-one",
      player,
      optionIndex: 0,
    });
    return result.accepted ? result.state : state;
  }

  if (state.activePlayer !== player) return state;

  const applyAiCommand = (current: MatchState, command: BattleCommand) => {
    const result = applyCommand(current, command);
    if (result.accepted) {
      onStep?.(result.state, command);
    }
    return result;
  };

  let next = state;
  if (
    next.players[player].coinAvailable &&
    next.players[player].hand.some((cardId) => {
      const card = CARD_BY_ID[cardId];
      return Boolean(
        card &&
        card.cost === next.players[player].mana + 1 &&
        isAiCardPlayable(next, player, card),
      );
    })
  ) {
    const coinResult = applyAiCommand(next, { type: "use-coin", player });
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
          scoreAiCard(next, player, right.card) - scoreAiCard(next, player, left.card) ||
          right.card.cost - left.card.cost ||
          left.handOrder - right.handOrder,
      )[0];

    if (!playable) {
      const tradeable = next.players[player].hand
        .map((cardId, handOrder) => ({ card: CARD_BY_ID[cardId], handOrder }))
        .filter(
          (entry): entry is { card: CardDefinition; handOrder: number } =>
            Boolean(entry.card?.tradeable),
        )
        .sort(
          (left, right) =>
            right.card.cost - left.card.cost || left.handOrder - right.handOrder,
        )[0];
      if (!tradeable || next.players[player].mana < 1) {
        break;
      }
      const tradeResult = applyAiCommand(next, {
        type: "trade-card",
        player,
        cardId: tradeable.card.id,
      });
      if (!tradeResult.accepted) {
        break;
      }
      next = tradeResult.state;
      continue;
    }

    const target = chooseAiTarget(
      next,
      player,
      playable.card.target ?? "none",
      playable.card,
    );
    const result = applyAiCommand(next, {
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
    // Discover is a blocking choice in the reducer. The AI resolves it
    // immediately, then keeps planning the same turn instead of leaving the
    // match stuck in the discover phase.
    if (next.phase === "discover" && next.discover?.player === player) {
      const choice = next.discover.choices[0];
      if (!choice) return next;
      const discoverResult = applyAiCommand(next, {
        type: "choose-discover",
        player,
        cardId: choice,
      });
      if (!discoverResult.accepted) return next;
      next = discoverResult.state;
    }
    if (next.phase === "choose-one" && next.chooseOne?.player === player) {
      const chooseOneResult = applyAiCommand(next, {
        type: "choose-one",
        player,
        optionIndex: 0,
      });
      if (!chooseOneResult.accepted) return next;
      next = chooseOneResult.state;
    }
  }

  for (let safety = 0; safety < MAX_BOARD_SIZE; safety += 1) {
    const attacker = chooseAiAttacker(next, player);
    if (!attacker) {
      break;
    }

    const target = chooseAiAttackTarget(next, player, attacker);
    if (!target) break;
    const result = applyAiCommand(next, {
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
    next.players[player].weapon &&
    !next.players[player].heroHasAttacked
  ) {
    const target = chooseAiHeroAttackTarget(
      next,
      player,
      next.players[player].weapon?.attack ?? 0,
    );
    const heroAttack = applyAiCommand(next, {
      type: "hero-attack",
      player,
      target,
    });
    if (heroAttack.accepted) {
      next = heroAttack.state;
      if (next.phase === "game-over") return next;
    }
  }

  if (
    next.phase !== "game-over" &&
    !next.players[player].heroPowerUsed &&
    next.players[player].mana >= (next.players[player].heroPower?.cost ?? HERO_POWER_COST) &&
    shouldAiUseHeroPower(next, player)
  ) {
    const heroPowerTarget = chooseAiHeroPowerTarget(next, player);
    if ((next.players[player].heroPower?.target ?? "none") !== "none" && !heroPowerTarget) {
      return applyAiCommand(next, { type: "end-turn", player }).state;
    }
    const powerResult = applyAiCommand(next, {
      type: "hero-power",
      player,
      ...(heroPowerTarget ? { target: heroPowerTarget } : {}),
    });
    if (powerResult.accepted) {
      next = powerResult.state;
      if (next.phase === "game-over") return next;
    }
  }

  const endTurn = applyAiCommand(next, {
    type: "end-turn",
    player,
  });
  return endTurn.accepted ? endTurn.state : next;
}
