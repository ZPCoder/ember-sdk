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
  HeroPowerDefinition,
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
// Reaching zero Health does not destroy a hero until the next Death Creation
// Step. Once that step observes the hero at zero, however, later phases in the
// same resolution (notably Deathrattles) cannot heal the hero back to safety.
// Keep this reducer-only marker outside MatchState so PVP snapshots remain
// stable while the complete queued resolution can still finish before result
// presentation.
const mortallyWoundedHeroes = new WeakMap<MatchState, Set<PlayerId>>();

function otherPlayer(player: PlayerId): PlayerId {
  return player === 0 ? 1 : 0;
}

/**
 * The Coin is represented by a dedicated command so clients do not need a
 * synthetic catalog entry, but it is still a real card for hand-cap rules.
 */
function occupiedHandSlots(player: PlayerState): number {
  return player.hand.length + (player.coinAvailable ? 1 : 0);
}

function normalizedHandCostReductions(player: PlayerState): number[] {
  const stored = Array.isArray(player.handCostReductions) ? player.handCostReductions : [];
  return player.hand.map((_, index) => {
    const reduction = stored[index];
    return typeof reduction === "number" && Number.isFinite(reduction) && reduction > 0
      ? Math.floor(reduction)
      : 0;
  });
}

function mutableHandCostReductions(player: PlayerState): number[] {
  const reductions = normalizedHandCostReductions(player);
  player.handCostReductions = reductions;
  return reductions;
}

function normalizedHandFragments(player: PlayerState): NonNullable<PlayerState["handFragments"]> {
  const stored = Array.isArray(player.handFragments) ? player.handFragments : [];
  return player.hand.map((_, index) => {
    const fragment = stored[index];
    return fragment
      && typeof fragment.groupId === "string"
      && fragment.groupId.length > 0
      && (fragment.piece === "left" || fragment.piece === "right")
      ? { groupId: fragment.groupId, piece: fragment.piece }
      : null;
  });
}

function normalizedHeraldCount(player: PlayerState): number {
  return typeof player.heraldCount === "number" && Number.isFinite(player.heraldCount)
    ? Math.max(0, Math.floor(player.heraldCount))
    : 0;
}

function heraldMultiplier(player: PlayerState): number {
  return Math.min(4, 2 ** Math.floor(normalizedHeraldCount(player) / 2));
}

function mutableHandFragments(player: PlayerState): NonNullable<PlayerState["handFragments"]> {
  const fragments = normalizedHandFragments(player);
  player.handFragments = fragments;
  return fragments;
}

function effectiveHandCardCost(
  player: PlayerState,
  card: Pick<CardDefinition, "cost">,
  handIndex: number,
): number {
  return Math.max(0, card.cost - normalizedHandCostReductions(player)[handIndex]);
}

function resolveHandIndex(
  player: PlayerState,
  cardId: string,
  handIndex: number | undefined,
): number {
  if (
    handIndex !== undefined
    && Number.isSafeInteger(handIndex)
    && handIndex >= 0
    && handIndex < player.hand.length
    && player.hand[handIndex] === cardId
  ) {
    return handIndex;
  }
  return player.hand.indexOf(cardId);
}

function cardForHandSlot(
  player: PlayerState,
  handIndex: number,
  card: CardDefinition,
): CardDefinition {
  const fragment = normalizedHandFragments(player)[handIndex];
  if (!fragment || !card.shatter) return card;
  return {
    ...card,
    effect: [...card.shatter[fragment.piece]],
    target: card.shatter[`${fragment.piece}Target`] ?? card.target,
  };
}

function reassembleAdjacentFragments(
  state: MatchState,
  player: PlayerId,
): void {
  const owner = state.players[player];
  const reductions = mutableHandCostReductions(owner);
  const fragments = mutableHandFragments(owner);
  for (let index = 0; index < owner.hand.length - 1; index += 1) {
    const left = fragments[index];
    const right = fragments[index + 1];
    if (
      !left
      || !right
      || left.groupId !== right.groupId
      || left.piece !== "left"
      || right.piece !== "right"
      || owner.hand[index] !== owner.hand[index + 1]
    ) {
      continue;
    }
    const cardId = owner.hand[index];
    const card = CARD_BY_ID[cardId];
    const retainedReduction = Math.max(reductions[index] ?? 0, reductions[index + 1] ?? 0);
    owner.hand.splice(index + 1, 1);
    reductions.splice(index + 1, 1);
    fragments.splice(index + 1, 1);
    reductions[index] = retainedReduction;
    fragments[index] = null;
    appendEvent(
      state,
      "card-reassembled",
      `${card?.name ?? "破碎卡牌"} 的两片重新相接，恢复为完整卡牌。`,
      player,
      { cardId, groupId: left.groupId, handIndex: index },
    );
    // The newly restored full card intentionally remains between any outer
    // fragment pair. Those pieces only touch after this card is itself played.
    break;
  }
}

// A PVP client may keep its own deck in slot 0 while the other client keeps
// that same deck in slot 1. Deriving the shuffle seed from the canonical deck
// contents keeps each distinct physical deck stable across local views. When
// both players bring the same list, slot salts below prevent mirrored draws.
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
    handCostReductions: normalizedHandCostReductions(player),
    handFragments: normalizedHandFragments(player),
    heraldCount: normalizedHeraldCount(player),
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
    handCostReductions: [],
    handFragments: [],
    heraldCount: 0,
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

  const requestedIndexes = [...cardIndexes].sort((left, right) => left - right);
  if (
    new Set(requestedIndexes).size !== requestedIndexes.length ||
    requestedIndexes.some((index) => index < 0 || index >= state.players[player].hand.length)
  ) {
    return {
      code: "invalid-mulligan",
      message: "只能选择当前手牌中的不同卡牌进行换牌。",
    };
  }

  const owner = state.players[player];
  const reductions = mutableHandCostReductions(owner);
  const fragments = mutableHandFragments(owner);
  const selectedGroups = new Set(
    requestedIndexes
      .map((index) => fragments[index]?.groupId)
      .filter((groupId): groupId is string => Boolean(groupId)),
  );
  const indexes = owner.hand
    .map((_, index) => index)
    .filter((index) => requestedIndexes.includes(index)
      || Boolean(fragments[index]?.groupId && selectedGroups.has(fragments[index]!.groupId)));
  const returned: string[] = [];
  const returnedGroups = new Set<string>();
  for (const index of indexes) {
    const fragment = fragments[index];
    if (fragment) {
      if (!returnedGroups.has(fragment.groupId)) {
        returnedGroups.add(fragment.groupId);
        returned.push(owner.hand[index]);
      }
    } else {
      returned.push(owner.hand[index]);
    }
  }
  for (let index = indexes.length - 1; index >= 0; index -= 1) {
    owner.hand.splice(indexes[index], 1);
    reductions.splice(indexes[index], 1);
    fragments.splice(indexes[index], 1);
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

  const card = CARD_BY_ID[command.cardId];
  addCardToHand(state, command.player, card.id, { discovered: true });
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
  const limit = unitAttackLimit(unit);
  const attacksMade = unit.attacksMade ?? (unit.hasAttacked ? 1 : 0);
  return (
    unit.attack > 0 &&
    !(unit.summoningSick ?? false) &&
    (unit.frozenTurns ?? 0) <= 0 &&
    attacksMade < limit
  );
}

function unitAttackLimit(unit: UnitState): number {
  return unit.keywords.includes("windfury") ? 2 : 1;
}

function heroEffectiveHealth(state: MatchState, player: PlayerId): number {
  const hero = state.players[player].hero;
  return hero.health + hero.armor;
}

/**
 * Freeze lasts until the end of the turn in which the frozen character loses
 * its next attack. A character frozen after it has spent every available
 * attack (or while unable to attack) therefore carries Freeze into its next
 * turn; Windfury still loses and consumes any unspent second attack.
 */
function settleFreezeAtEndOfTurn(unit: UnitState): void {
  if (unit.frozenTurns <= 0) {
    unit.freezeBlocked = false;
    return;
  }

  const missedCurrentTurnAttack =
    !unit.summoningSick &&
    unit.attack > 0 &&
    (unit.attacksMade ?? (unit.hasAttacked ? 1 : 0)) < unitAttackLimit(unit);
  if (unit.freezeBlocked || missedCurrentTurnAttack) {
    unit.frozenTurns = Math.max(0, unit.frozenTurns - 1);
    unit.freezeBlocked = false;
  }
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
  target: BattleTarget | undefined,
): PlayerId | undefined {
  if (!target || typeof target !== "object") return undefined;
  if (target.kind === "hero" && (target.player === 0 || target.player === 1)) {
    return target.player;
  }
  if (target.kind === "unit" && typeof target.entityId === "string") {
    return findUnit(state, target.entityId)?.owner;
  }
  return undefined;
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

function isCardTargetValid(
  state: MatchState,
  player: PlayerId,
  card: CardDefinition,
  target: BattleTarget | undefined,
): boolean {
  return isTargetValid(state, player, card.target ?? "none", target);
}

function hasValidCardTarget(
  state: MatchState,
  player: PlayerId,
  card: CardDefinition,
): boolean {
  const rule = card.target ?? "none";
  return hasValidTarget(state, player, rule);
}

/** A spell whose only resolved text summons minions cannot be played onto a
 * full board. Mixed-effect spells remain legal and skip only their summons. */
function isPureSummonSpell(card: CardDefinition, comboActive: boolean): boolean {
  if (card.type !== "spell") return false;
  const effects = [
    ...(card.effect ?? []),
    ...(comboActive ? (card.combo ?? []) : []),
  ];
  return effects.length > 0 && effects.every((effect) => effect.kind === "summon");
}

/**
 * Healing effects may target an undamaged character. They simply create no
 * Healing Event when no Health can be restored.
 */
function isHeroPowerTargetValid(
  state: MatchState,
  player: PlayerId,
  heroPower: HeroPowerDefinition,
  target: BattleTarget | undefined,
): boolean {
  const targetRule = heroPower.target ?? "none";
  return isTargetValid(state, player, targetRule, target);
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

function markMortallyWoundedHeroes(state: MatchState): void {
  let marked = mortallyWoundedHeroes.get(state);
  for (const player of [0, 1] as const) {
    if (state.players[player].hero.health > 0 || marked?.has(player)) continue;
    if (!marked) {
      marked = new Set<PlayerId>();
      mortallyWoundedHeroes.set(state, marked);
    }
    marked.add(player);
  }
}

function isHeroMortallyWounded(state: MatchState, player: PlayerId): boolean {
  return mortallyWoundedHeroes.get(state)?.has(player) ?? false;
}

function checkHeroOutcome(
  state: MatchState,
  reason: Exclude<MatchEndReason, "concede" | "draw">,
): void {
  // Calls outside an effect/death queue are themselves the Death Creation
  // Step. Calls after a queue preserve heroes marked at any earlier step.
  markMortallyWoundedHeroes(state);
  const dead0 = isHeroMortallyWounded(state, 0);
  const dead1 = isHeroMortallyWounded(state, 1);
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

function addCardToHand(
  state: MatchState,
  player: PlayerId,
  cardId: string,
  options: { discovered?: boolean } = {},
): void {
  const owner = state.players[player];
  const card = CARD_BY_ID[cardId];
  const availableSlots = Math.max(0, MAX_HAND_SIZE - occupiedHandSlots(owner));
  if (availableSlots === 0) {
    appendEvent(
      state,
      "card-burned",
      `玩家 ${player} 的手牌已满，${options.discovered ? `发现的 ${card?.name ?? "卡牌"}` : "一张牌"}被销毁。`,
      player,
      { cardId, discovered: options.discovered === true },
    );
    return;
  }

  if (card?.shatter) {
    const reductions = mutableHandCostReductions(owner);
    const fragments = mutableHandFragments(owner);
    const groupId = `s${state.nextEntityId}`;
    state.nextEntityId += 1;
    owner.hand.unshift(cardId);
    reductions.unshift(0);
    fragments.unshift({ groupId, piece: "left" });
    let fragmentCount = 1;
    if (availableSlots >= 2) {
      owner.hand.push(cardId);
      reductions.push(0);
      fragments.push({ groupId, piece: "right" });
      fragmentCount = 2;
    }
    appendEvent(
      state,
      "card-drawn",
      `玩家 ${player} ${options.discovered ? "将" : "抽到"}了 ${card.name}。`,
      player,
      { cardId, discovered: options.discovered === true, shatter: true, fragmentCount },
    );
    appendEvent(
      state,
      "card-shattered",
      `${card.name} 裂成 ${fragmentCount} 片并移向手牌两端。`,
      player,
      { cardId, groupId, fragmentCount },
    );
    if (fragmentCount < 2) {
      appendEvent(
        state,
        "card-burned",
        `玩家 ${player} 的手牌空间不足，${card.name} 的右片被销毁。`,
        player,
        { cardId, groupId, fragment: "right", shatter: true },
      );
    }
    return;
  }

  owner.hand.push(cardId);
  mutableHandCostReductions(owner);
  mutableHandFragments(owner);
  appendEvent(
    state,
    "card-drawn",
    `玩家 ${player} ${options.discovered ? `将 ${card?.name ?? "一张牌"} 加入手牌` : "抽了一张牌"}。`,
    player,
    { cardId, discovered: options.discovered === true },
  );
}

function drawCard(state: MatchState, player: PlayerId): void {
  if (state.phase === "game-over") {
    return;
  }

  const owner = state.players[player];
  const cardId = owner.deck.shift();

  if (!cardId) {
    owner.fatigue += 1;
    const fatigueDamage = owner.fatigue;
    const armorAbsorbed = Math.min(owner.hero.armor, fatigueDamage);
    const healthDamage = Math.min(
      owner.hero.health,
      fatigueDamage - armorAbsorbed,
    );
    owner.hero.armor -= armorAbsorbed;
    owner.hero.health = Math.max(0, owner.hero.health - healthDamage);
    appendEvent(
      state,
      "fatigue",
      `玩家 ${player} 受到 ${fatigueDamage} 点疲劳伤害。`,
      player,
      {
        amount: fatigueDamage,
        healthDamage,
        armorAbsorbed,
        health: owner.hero.health,
        armor: owner.hero.armor,
      },
    );
    requestHeroOutcome(state, "fatigue");
    return;
  }

  addCardToHand(state, player, cardId);
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
  const multiplier = card.colossal ? heraldMultiplier(state.players[player]) : 1;
  const attack = (card.attack ?? 0) * multiplier;
  const health = (card.health ?? 1) * multiplier;

  return {
    entityId,
    cardId: card.id,
    name: card.name,
    owner: player,
    playOrder,
    attack,
    health,
    maxHealth: health,
    baseAttack: attack,
    baseHealth: health,
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
    freezeBlocked: false,
    rebornUsed: false,
    silenced: false,
    spellDamage: card.spellDamage ?? 0,
    temporaryAttackBonus: 0,
    temporaryHealthBonus: 0,
  };
}

function scaleCardEffect(effect: CardEffect, multiplier: number): CardEffect {
  if (multiplier === 1) return effect;
  switch (effect.kind) {
    case "damage":
    case "heal":
    case "damage-friendly-hero":
    case "random-enemy-damage":
    case "damage-all-enemies":
    case "armor":
      return { ...effect, amount: effect.amount * multiplier };
    case "draw":
    case "draw-opponent":
      return { ...effect, count: effect.count * multiplier };
    case "buff":
    case "buff-all-friendly":
    case "temporary-buff":
      return {
        ...effect,
        attack: effect.attack * multiplier,
        health: effect.health * multiplier,
      };
    case "summon":
      return { ...effect, count: effect.count * multiplier };
    case "random-enemy-freeze":
      return { ...effect, amount: (effect.amount ?? 1) * multiplier };
    default:
      return effect;
  }
}

function createColossalPartUnit(
  state: MatchState,
  player: PlayerId,
  part: NonNullable<CardDefinition["colossal"]>["parts"][number],
  multiplier: number,
  soldier: boolean,
): UnitState {
  const entityId = `u${state.nextEntityId}`;
  const playOrder = state.nextEntityId;
  state.nextEntityId += 1;
  const keywords = [...(part.keywords ?? [])];
  const charge = keywords.includes("charge");
  const rush = keywords.includes("rush");
  const attack = part.attack * multiplier;
  const health = part.health * multiplier;
  return {
    entityId,
    cardId: soldier ? `${part.id}-soldier` : part.id,
    name: soldier ? `${part.name}士兵` : part.name,
    owner: player,
    playOrder,
    attack,
    health,
    maxHealth: health,
    baseAttack: attack,
    baseHealth: health,
    keywords,
    stars: 1,
    furyStacks: 0,
    hasAttacked: false,
    summonedTurn: state.turn,
    attacksMade: 0,
    summoningSick: !charge && !rush,
    rushOnly: rush,
    stealthActive: keywords.includes("stealth"),
    frozenTurns: 0,
    freezeBlocked: false,
    rebornUsed: false,
    silenced: false,
    spellDamage: 0,
    temporaryAttackBonus: 0,
    temporaryHealthBonus: 0,
  };
}

function summonColossalPart(
  state: MatchState,
  player: PlayerId,
  part: NonNullable<CardDefinition["colossal"]>["parts"][number],
  multiplier: number,
  soldier: boolean,
): UnitState | undefined {
  if (state.players[player].board.length >= MAX_BOARD_SIZE) return undefined;
  const unit = createColossalPartUnit(state, player, part, multiplier, soldier);
  state.players[player].board.push(unit);
  appendEvent(
    state,
    "unit-summoned",
    `${unit.name} 被召唤。`,
    player,
    {
      cardId: unit.cardId,
      entityId: unit.entityId,
      colossalPart: !soldier,
      heraldSoldier: soldier,
      multiplier,
    },
  );
  triggerSecrets(state, "opponent-summons-unit", player);
  resolveEffects(
    state,
    player,
    (part.effect ?? []).map((effect) => scaleCardEffect(effect, multiplier)),
  );
  return unit;
}

function summonColossalParts(
  state: MatchState,
  player: PlayerId,
  card: CardDefinition,
): void {
  if (!card.colossal) return;
  const multiplier = heraldMultiplier(state.players[player]);
  let summoned = 0;
  for (const part of card.colossal.parts) {
    if (summonColossalPart(state, player, part, multiplier, false)) summoned += 1;
  }
  appendEvent(
    state,
    "colossal-assembled",
    `${card.name} 以 ×${multiplier} 强度组装，召唤 ${summoned} 个附肢。`,
    player,
    { cardId: card.id, multiplier, partCount: summoned },
  );
}

function resolveHeraldPlay(
  state: MatchState,
  player: PlayerId,
  card: CardDefinition,
): void {
  if (!card.herald) return;
  const owner = state.players[player];
  owner.heraldCount = normalizedHeraldCount(owner) + 1;
  const multiplier = heraldMultiplier(owner);
  const colossal = CARD_BY_ID[card.herald.colossalCardId];
  const part = colossal?.colossal?.parts[0];
  const soldier = part
    ? summonColossalPart(state, player, part, multiplier, true)
    : undefined;
  appendEvent(
    state,
    "herald-triggered",
    `${card.name} 宣告巨型来临；先驱进度 ${owner.heraldCount}，强度 ×${multiplier}。`,
    player,
    {
      cardId: card.id,
      colossalCardId: card.herald.colossalCardId,
      heraldCount: owner.heraldCount,
      multiplier,
      soldierEntityId: soldier?.entityId,
    },
  );
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
  // Entering the death window is the Death Creation Step for the just-finished
  // phase. Mark heroes before any Deathrattle can try to heal them. Nested
  // calls still perform this marking so a hero killed by one Deathrattle is
  // irreversibly dead before a later Deathrattle resolves.
  markMortallyWoundedHeroes(state);
  if (resolvingDeathStates.has(state)) return;

  const queue: Array<{ unit: UnitState; player: PlayerId }> = [];
  const rebornQueue: Array<{ unit: UnitState; player: PlayerId; card: CardDefinition }> = [];
  resolvingDeathStates.add(state);
  try {
    enqueueDeadUnits(state, queue);
    let deathIndex = 0;
    let rebornIndex = 0;
    while (deathIndex < queue.length || rebornIndex < rebornQueue.length) {
      // Every queued Deathrattle resolves before any Reborn from the same
      // death window. This prevents a later Deathrattle from interacting with
      // a body that should not have returned yet.
      while (deathIndex < queue.length) {
        const { unit, player } = queue[deathIndex];
        deathIndex += 1;
        appendEvent(
          state,
          "unit-died",
          `${unit.name} 被击败。`,
          unit.owner,
          { entityId: unit.entityId, cardId: unit.cardId, targetPlayer: unit.owner },
        );
        const card = CARD_BY_ID[unit.cardId];
        if (!unit.silenced && card?.onDeath && card.onDeath.length > 0) {
          resolveEffects(state, player, card.onDeath, undefined, 0, 0, unit);
        }
        if (
          !unit.silenced &&
          card?.keywords?.includes("reborn") &&
          !unit.rebornUsed
        ) {
          rebornQueue.push({ unit, player, card });
        }

        // Deathrattles can create a later death wave. Add it behind all
        // bodies already locked into this window, before any Reborn resolves.
        enqueueDeadUnits(state, queue);
      }

      const pendingReborn = rebornQueue[rebornIndex];
      if (!pendingReborn) break;
      rebornIndex += 1;
      const { unit, player, card } = pendingReborn;
      if (state.players[player].board.length >= MAX_BOARD_SIZE) continue;

      const reborn = createUnit(state, player, card);
      reborn.health = 1;
      // Reborn returns the minion with one current health, while retaining
      // its printed maximum so later healing and UI health bars remain
      // meaningful.
      reborn.maxHealth = card.health ?? 1;
      reborn.rebornUsed = true;
      // Reborn is a one-shot enchantment. Keep the internal marker for
      // compatibility while removing the active keyword from UI/rules checks.
      reborn.keywords = reborn.keywords.filter((keyword) => keyword !== "reborn");
      state.players[player].board.push(reborn);
      appendEvent(
        state,
        "unit-summoned",
        `${unit.name} 复生。`,
        player,
        { cardId: card.id, entityId: reborn.entityId, reborn: true },
      );
      // Reborn is a fresh summon in Hearthstone's event model.
      triggerSecrets(state, "opponent-summons-unit", player);
      summonColossalParts(state, player, card);
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
    const damageDealt = absorbed + actualDamage;
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
    if (options.sourceUnit?.keywords.includes("lifesteal") && damageDealt > 0) {
      healTarget(
        state,
        { kind: "hero", player: options.sourceUnit.owner },
        damageDealt,
        options.sourceUnit.owner,
      );
    }
    // A spell's entire text is one Hearthstone sequence.  Keep a hero at
    // zero health until that outer effect sequence finishes so later AoE or
    // secondary effects still resolve before the win/loss check.
    if ((effectResolutionDepth.get(state) ?? 0) === 0) {
      requestHeroOutcome(state, endReason);
    }
    return damageDealt;
  }

  const unit = findUnit(state, target.entityId);
  if (!unit) {
    return 0;
  }

  const shieldIndex = unit.keywords.indexOf("shield");
  if (shieldIndex >= 0) {
    unit.keywords.splice(shieldIndex, 1);
    // Receiving damage does not reveal Stealth. Only declaring an attack (or
    // an explicit reveal/silence effect) removes it, even when Shield breaks.
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
  const poisonousLethal = Boolean(
    options.sourceUnit?.keywords.includes("poisonous") &&
    actualDamage > 0 &&
    unit.health > 0
  );
  if (poisonousLethal) {
    unit.health = 0;
  }
  appendEvent(
    state,
    "damage",
    poisonousLethal
      ? `${unit.name} 受到 ${actualDamage} 点伤害并被剧毒击败。`
      : `${unit.name} 受到 ${actualDamage} 点伤害。`,
    sourcePlayer,
    {
      amount: actualDamage,
      requestedAmount: amount,
      reduction,
      entityId: unit.entityId,
      targetPlayer: unit.owner,
      health: unit.health,
      poisonous: poisonousLethal,
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
    options.combat === true &&
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
    // A hero may recover from zero inside the phase that dealt the damage,
    // before a Death Creation Step occurs. Once marked during that step,
    // healing effects in later queued phases still resolve but cannot rescue
    // the hero.
    if (isHeroMortallyWounded(state, target.player)) return;
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
      // Turn-triggered minion text is not a spell. Neither Spell Damage nor
      // the project's spell-only Arcane trait may amplify it.
      0,
      0,
      unit,
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
      // This is the listening minion's triggered text, not part of the spell
      // that woke it, so spell-only numeric modifiers do not apply twice.
      0,
      0,
      unit,
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
  sourceUnit?: UnitState,
): void {
  if (state.phase === "game-over") {
    return;
  }

  switch (effect.kind) {
    case "damage":
      if (target) {
        dealDamage(
          state,
          target,
          effect.amount + numericBonus + spellDamage,
          player,
          "hero-defeated",
          { sourceUnit },
        );
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
    case "draw-opponent": {
      const opponent = otherPlayer(player);
      for (let count = 0; count < effect.count; count += 1) {
        drawCard(state, opponent);
        if (hasGameEnded(state)) {
          break;
        }
      }
      break;
    }
    case "damage-friendly-hero": {
      const controller = sourceUnit?.owner ?? player;
      dealDamage(
        state,
        { kind: "hero", player: controller },
        effect.amount,
        controller,
      );
      break;
    }
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
        summonColossalParts(state, player, summonedCard);
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
      dealDamage(
        state,
        randomTarget,
        effect.amount + numericBonus + spellDamage,
        player,
        "hero-defeated",
        { sourceUnit },
      );
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
          "hero-defeated",
          { sourceUnit },
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
      unit.freezeBlocked = false;
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
      // state while retaining the board slot identity for the current view.
      // Its freshly allocated playOrder is intentional: transformed entities
      // become newest for later trigger/death ordering.
      replacement.entityId = unit.entityId;
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
      // Transform replaces an entity in place. It is neither a death nor a
      // summon, so it must not wake Deathrattles or summon-triggered Secrets.
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
  sourceUnit?: UnitState,
): void {
  resolveEffectSequence(state, () => {
    for (const effect of effects) {
      resolveEffect(state, player, effect, target, numericBonus, spellDamage, sourceUnit);
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
  const handIndex = resolveHandIndex(owner, command.cardId, command.handIndex);
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
  if (owner.deck.length === 0) {
    return {
      code: "not-tradeable",
      message: "牌库为空时不能交易卡牌。",
    };
  }
  if (owner.mana < 1) {
    return {
      code: "not-enough-mana",
      message: "交易需要 1 点法力。",
    };
  }

  const reductions = mutableHandCostReductions(owner);
  const fragments = mutableHandFragments(owner);
  owner.hand.splice(handIndex, 1);
  reductions.splice(handIndex, 1);
  fragments.splice(handIndex, 1);
  owner.mana -= 1;
  appendEvent(
    state,
    "card-traded",
    `玩家 ${command.player} 将 ${card.name} 洗回牌库并抽取替代牌。`,
    command.player,
    { cardId: card.id, cost: 1 },
  );

  // Draw from the original deck first, so the physical card being traded can
  // never be the replacement draw. Then insert it without disturbing the
  // relative order of the cards that remain in the deck.
  drawCard(state, command.player);
  const insertionRandom = nextRandom(state.rngState);
  state.rngState = insertionRandom.state;
  const insertionIndex = Math.floor(
    insertionRandom.value * (owner.deck.length + 1),
  );
  owner.deck.splice(insertionIndex, 0, card.id);
  return null;
}

function handlePrepareCard(
  state: MatchState,
  command: Extract<BattleCommand, { type: "prepare-card" }>,
): CommandError | null {
  const owner = state.players[command.player];
  const handIndex = resolveHandIndex(owner, command.cardId, command.handIndex);
  if (handIndex < 0) {
    return {
      code: "card-not-in-hand",
      message: "该卡牌不在玩家手牌中。",
    };
  }

  const card = CARD_BY_ID[command.cardId];
  if (!card?.preparable) {
    return {
      code: "not-preparable",
      message: "这张卡牌不能预备。",
    };
  }
  const reductions = mutableHandCostReductions(owner);
  if ((reductions[handIndex] ?? 0) > 0) {
    return {
      code: "already-prepared",
      message: "这张卡牌已经完成过预备。",
    };
  }
  if (owner.mana < 1) {
    return {
      code: "not-enough-mana",
      message: "预备至少需要 1 点剩余法力。",
    };
  }

  const manaSpent = owner.mana;
  const reduction = manaSpent + 1;
  owner.mana = 0;
  reductions[handIndex] = reduction;
  appendEvent(
    state,
    "card-prepared",
    `玩家 ${command.player} 花费 ${manaSpent} 点法力预备了一张牌。`,
    command.player,
    {
      cardId: card.id,
      manaSpent,
      reduction,
      effectiveCost: Math.max(0, card.cost - reduction),
    },
  );
  return null;
}

function handlePlayCard(
  state: MatchState,
  command: Extract<BattleCommand, { type: "play-card" }>,
): CommandError | null {
  const owner = state.players[command.player];
  const handIndex = resolveHandIndex(owner, command.cardId, command.handIndex);
  if (handIndex < 0) {
    return {
      code: "card-not-in-hand",
      message: "该卡牌不在玩家手牌中。",
    };
  }

  const catalogCard = CARD_BY_ID[command.cardId];
  if (!catalogCard) {
    return {
      code: "card-not-in-hand",
      message: "该卡牌不存在于当前内容版本。",
    };
  }
  const handFragment = normalizedHandFragments(owner)[handIndex];
  const card = cardForHandSlot(owner, handIndex, catalogCard);

  const effectiveCost = effectiveHandCardCost(owner, card, handIndex);
  if (owner.mana < effectiveCost) {
    return {
      code: "not-enough-mana",
      message: `需要 ${effectiveCost} 点法力，当前只有 ${owner.mana} 点。`,
    };
  }

  const comboActive = owner.cardsPlayedThisTurn > 0;

  const placement = command.placement ?? "friendly";
  if (
    placement !== "friendly"
    && (placement !== "enemy" || card.type !== "unit" || !card.disguised)
  ) {
    return {
      code: "invalid-placement",
      message: "只有伪装单位可以部署到对手战场。",
    };
  }
  const unitOwner = placement === "enemy"
    ? otherPlayer(command.player)
    : command.player;
  const unitController = state.players[unitOwner];

  const upgradeTarget =
    card.type === "unit" ? findUpgradeTarget(unitController, card) : undefined;
  if (
    card.type === "unit" &&
    unitController.board.length >= MAX_BOARD_SIZE &&
    !upgradeTarget
  ) {
    return {
      code: "board-full",
      message: `场上最多只能有 ${MAX_BOARD_SIZE} 个单位。`,
    };
  }
  if (
    owner.board.length >= MAX_BOARD_SIZE &&
    isPureSummonSpell(card, comboActive)
  ) {
    return {
      code: "board-full",
      message: `战场已满，无法使用只会召唤单位的战术。`,
    };
  }

  const targetRule = card.target ?? "none";
  if (
    card.type !== "unit" &&
    targetRule !== "none" &&
    !hasValidCardTarget(state, command.player, card)
  ) {
    return {
      code: "invalid-target",
      message: "当前没有符合卡牌要求的合法目标。",
    };
  }
  // A targeted Battlecry follows the same target window as a targeted spell:
  // when at least one legal target exists, the player must commit to one.
  // The only exception is an empty target pool, where Hearthstone still lets
  // the minion enter play and simply skips its Battlecry.
  const targetIsRequired =
    targetRule !== "none" && hasValidCardTarget(state, command.player, card);
  if (targetIsRequired && !command.target) {
    return {
      code: "target-required",
      message: "这张卡牌需要选择一个目标。",
    };
  }
  if (
    command.target &&
    !isCardTargetValid(state, command.player, card, command.target)
  ) {
    return {
      code: "invalid-target",
      message: "所选目标不符合卡牌要求。",
    };
  }

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

  const reductions = mutableHandCostReductions(owner);
  const fragments = mutableHandFragments(owner);
  owner.hand.splice(handIndex, 1);
  reductions.splice(handIndex, 1);
  fragments.splice(handIndex, 1);
  owner.mana -= effectiveCost;
  appendEvent(
    state,
    "card-played",
    `玩家 ${command.player} 使用了 ${card.name}。`,
    command.player,
    {
      cardId: card.id,
      cost: effectiveCost,
      printedCost: card.cost,
      placement,
      fragment: handFragment?.piece,
      fragmentGroupId: handFragment?.groupId,
      target: command.target,
    },
  );
  reassembleAdjacentFragments(state, command.player);
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
        upgradeUnit(state, unitOwner, upgradeTarget, card);
      } else {
        const unit = createUnit(state, unitOwner, card);
        unitController.board.push(unit);
        summonedUnit = unit;
        appendEvent(
          state,
          "unit-summoned",
          `${card.name} 进入玩家 ${unitOwner} 的战场。`,
          unitOwner,
          {
            cardId: card.id,
            entityId: unit.entityId,
            playedBy: command.player,
            placement,
          },
        );
        summonColossalParts(state, unitOwner, card);
      }
      // The minion's Battlecry/Combo and its after-summon secrets are one
      // Hearthstone Sequence. A lethal Battlecry therefore cannot skip the
      // remaining phases, while a minion that died during its Battlecry is no
      // longer a valid subject for Mirror Entity-style effects.
      const sourceUnit = summonedUnit ?? upgradeTarget;
      resolveEffects(state, command.player, card.onPlay ?? [], command.target, 0, 0, sourceUnit);
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
          0,
          sourceUnit,
        );
      }
      if (
        summonedUnit &&
        summonedUnit.health > 0 &&
        findUnit(state, summonedUnit.entityId)
      ) {
        triggerSecrets(state, "opponent-summons-unit", command.player);
      }
      resolveHeraldPlay(state, command.player, card);
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

  return resolveEffectSequence(state, () => {
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
      if (owner.hero.health <= 0) {
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
    if (defendingUnit) {
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
    return null;
  });
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
    settleFreezeAtEndOfTurn(unit);
  }
  for (const unit of nextPlayer.board) {
    unit.attacksMade = 0;
    if (unit.frozenTurns > 0) {
      // Freeze consumes the next attack, so a minion frozen during the
      // opponent's turn remains unable to attack throughout this turn.  The
      // counter is consumed when its controller ends the turn, not when the
      // turn begins.
      unit.attacksMade = unitAttackLimit(unit);
      unit.hasAttacked = true;
      unit.summoningSick = false;
      unit.freezeBlocked = true;
    } else {
      unit.hasAttacked = false;
      unit.summoningSick = false;
      unit.rushOnly = false;
      unit.freezeBlocked = false;
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
  if (targetRule !== "none" && !hasValidTarget(state, player, targetRule)) {
    return {
      code: "invalid-target",
      message: "当前没有符合核心技能要求的合法目标。",
    };
  }
  if (targetRule !== "none" && !command.target) {
    return {
      code: "target-required",
      message: "该核心技能需要选择一个目标。",
    };
  }
  if (!isHeroPowerTargetValid(state, player, heroPower, command.target)) {
    return {
      code: "invalid-target",
      message: "所选目标不符合核心技能要求。",
    };
  }
  if (
    heroPower.effect.kind === "summon" &&
    owner.board.length >= MAX_BOARD_SIZE
  ) {
    return {
      code: "board-full",
      message: `战场已满，无法使用召唤型核心技能。`,
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
    // The Coin is a played spell, so it must advance Combo and any other
    // "after you play a card" counters before the next card is evaluated.
    owner.cardsPlayedThisTurn += 1;
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

  // Deck-list order is not gameplay information. Canonicalizing before the
  // deterministic shuffle prevents a client from influencing draws by merely
  // reordering the same multiset of cards in its submitted list.
  const firstDeck = [...sourceDecks[0]].sort();
  const secondDeck = [...sourceDecks[1]].sort();
  const firstFingerprint = deckFingerprint(firstDeck);
  const secondFingerprint = deckFingerprint(secondDeck);
  const firstFaction = factionForDeck(firstDeck);
  const secondFaction = factionForDeck(secondDeck);
  const mirrorMatch = firstFingerprint === secondFingerprint;
  const firstShuffle = shuffleWithSeed(
    firstDeck,
    normalizeSeed(seed ^ firstFingerprint ^ (mirrorMatch ? 0x243f6a88 : 0)),
  );
  const secondShuffle = shuffleWithSeed(
    secondDeck,
    normalizeSeed(seed ^ secondFingerprint ^ (mirrorMatch ? 0x85a308d3 : 0)),
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
  const commandDeduplicationKey = command.commandId
    ? `${command.player}:${command.commandId}`
    : undefined;
  if (
    commandDeduplicationKey &&
    state.processedCommandIds.includes(commandDeduplicationKey)
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
    case "prepare-card":
      error = handlePrepareCard(next, command);
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
  if (commandDeduplicationKey) {
    next.processedCommandIds.push(commandDeduplicationKey);
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
    ...(state.players[player].cardsPlayedThisTurn > 0 ? (card?.combo ?? []) : []),
  ];
  const hasEffect = (kind: CardEffect["kind"]): boolean =>
    cardEffects.some((effect) => effect.kind === kind);
  // Targeted burn should close out a game before the AI spends it on a
  // minion.  This mirrors the basic Hearthstone heuristic of checking lethal
  // first, while still letting ordinary battlecries use the cheaper fallback
  // below.  Spell damage and the Arcane trait are included because they are
  // already applied by the reducer when the spell resolves.
  const directDamage = cardEffects.reduce(
    (total, effect) => total + (effect.kind === "damage" ? effect.amount : 0),
    0,
  ) + (card?.type === "spell"
    ? activeTraitTier(state, player, "arcane") + spellDamageBonus(state, player)
    : 0);
  const attackAndWeaponDamage = aiUnblockedFaceDamage(state, player, {
    includeHeroPower: true,
    reservedMana: card?.cost ?? 0,
  });
  const combinationLethal = directDamage > 0 &&
    attackAndWeaponDamage + directDamage >= heroEffectiveHealth(state, enemy);
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
  const bestKillableEnemyUnit = [...enemyUnits]
    .filter((unit) =>
      !unit.keywords.includes("shield") &&
      directDamage > 0 &&
      unit.health <= directDamage,
    )
    .sort((left, right) =>
      right.attack - left.attack || left.health - right.health,
    )[0];
  const hasHealEffect = cardEffects.some((effect) => effect.kind === "heal");

  switch (rule) {
    case "none":
      return undefined;
    case "enemy-character":
      if (combinationLethal ||
        (directDamage > 0 && heroEffectiveHealth(state, enemy) <= directDamage)) {
        return { kind: "hero", player: enemy };
      }
      // Prefer removing a threatening minion when the spell can finish it;
      // otherwise preserve the familiar direct-to-hero behaviour.
      if (
        hasEffect("damage") &&
        bestKillableEnemyUnit
      ) {
        return { kind: "unit", entityId: bestKillableEnemyUnit.entityId };
      }
      return { kind: "hero", player: enemy };
    case "friendly-character":
      if (mostDamagedFriendly) return { kind: "unit", entityId: mostDamagedFriendly.entityId };
      if (hasHealEffect) {
        return state.players[player].hero.health < state.players[player].hero.maxHealth
          ? { kind: "hero", player }
          : { kind: "hero", player };
      }
      return { kind: "hero", player };
    case "any-character":
      if (combinationLethal ||
        (directDamage > 0 && heroEffectiveHealth(state, enemy) <= directDamage)) {
        return { kind: "hero", player: enemy };
      }
      if (hasEffect("heal") && mostDamagedFriendly) {
        return { kind: "unit", entityId: mostDamagedFriendly.entityId };
      }
      if (hasHealEffect) {
        return state.players[player].hero.health < state.players[player].hero.maxHealth
          ? { kind: "hero", player }
          : { kind: "hero", player };
      }
      if (hasEffect("damage") && bestKillableEnemyUnit) {
        return { kind: "unit", entityId: bestKillableEnemyUnit.entityId };
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

function aiUnitAttackDamage(
  state: MatchState,
  player: PlayerId,
  unit: UnitState,
): number {
  return unit.attack + (
    unitHasTrait(unit, "swift")
      ? activeTraitTier(state, player, "swift")
      : 0
  );
}

function aiDirectHeroPowerDamage(
  state: MatchState,
  player: PlayerId,
  reservedMana = 0,
): number {
  const owner = state.players[player];
  const power = owner.heroPower;
  return !owner.heroPowerUsed &&
    owner.mana - reservedMana >= power.cost &&
    power.effect.kind === "damage-enemy-hero"
      ? power.effect.amount
      : 0;
}

function aiUnblockedFaceDamage(
  state: MatchState,
  player: PlayerId,
  options: { includeHeroPower?: boolean; reservedMana?: number } = {},
): number {
  const owner = state.players[player];
  const enemy = state.players[otherPlayer(player)];
  const hasVisibleTaunt = enemy.board.some(
    (unit) => unit.health > 0 && unit.keywords.includes("taunt") && !unit.stealthActive,
  );
  if (hasVisibleTaunt) {
    return options.includeHeroPower
      ? aiDirectHeroPowerDamage(state, player, options.reservedMana)
      : 0;
  }

  const unitDamage = owner.board.reduce((total, unit) => {
    if (!canUnitAttack(unit) || unit.rushOnly) return total;
    const attacksRemaining = Math.max(
      0,
      unitAttackLimit(unit) - (unit.attacksMade ?? (unit.hasAttacked ? 1 : 0)),
    );
    return total + aiUnitAttackDamage(state, player, unit) * attacksRemaining;
  }, 0);
  const weaponDamage = owner.weapon && !owner.heroHasAttacked
    ? owner.weapon.attack
    : 0;
  const heroPowerDamage = options.includeHeroPower
    ? aiDirectHeroPowerDamage(state, player, options.reservedMana)
    : 0;
  return unitDamage + weaponDamage + heroPowerDamage;
}

function aiHasUnblockedLethal(state: MatchState, player: PlayerId): boolean {
  return aiUnblockedFaceDamage(state, player, { includeHeroPower: true }) >=
    heroEffectiveHealth(state, otherPlayer(player));
}

function shouldAiUseDirectHeroPowerForLethal(
  state: MatchState,
  player: PlayerId,
): boolean {
  const powerDamage = aiDirectHeroPowerDamage(state, player);
  if (powerDamage <= 0) return false;
  const enemyHealth = heroEffectiveHealth(state, otherPlayer(player));
  const otherFaceDamage = aiUnblockedFaceDamage(state, player);
  return otherFaceDamage < enemyHealth &&
    otherFaceDamage + powerDamage >= enemyHealth;
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
    !unit.keywords.includes("shield") &&
    (attacker.keywords.includes("poisonous") || attackDamage >= unit.health);
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
  if (aiHasUnblockedLethal(state, player)) {
    return { kind: "hero", player: enemy };
  }
  if (attackDamage >= heroEffectiveHealth(state, enemy)) {
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
  const attackers = state.players[player].board.filter(canUnitAttack);
  const enemy = otherPlayer(player);
  const visibleEnemies = state.players[enemy].board.filter(
    (unit) => unit.health > 0 && !unit.stealthActive,
  );
  const taunts = visibleEnemies.filter((unit) => unit.keywords.includes("taunt"));
  const requiredTargets = taunts.length > 0 ? taunts : visibleEnemies;

  if (aiHasUnblockedLethal(state, player)) {
    // Lead with the smallest body during a lethal push. This preserves the
    // largest attacker when an attack secret removes or damages the opener.
    return [...attackers].sort((left, right) =>
      aiUnitAttackDamage(state, player, left) - aiUnitAttackDamage(state, player, right) ||
      left.health - right.health,
    )[0];
  }

  const efficientTraders = attackers.filter((attacker) => {
    const damage = aiUnitAttackDamage(state, player, attacker);
    return requiredTargets.some(
      (target) =>
        !target.keywords.includes("shield") &&
        (attacker.keywords.includes("poisonous") || damage >= target.health),
    );
  });
  if (efficientTraders.length > 0) {
    // Use the least attack needed for a profitable removal instead of
    // throwing the largest threat into the smallest enemy body.
    return [...efficientTraders].sort((left, right) =>
      aiUnitAttackDamage(state, player, left) - aiUnitAttackDamage(state, player, right) ||
      left.health - right.health,
    )[0];
  }

  return [...attackers].sort((left, right) => {
    const leftDamage = aiUnitAttackDamage(state, player, left);
    const rightDamage = aiUnitAttackDamage(state, player, right);
    return rightDamage - leftDamage ||
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
  if (attack >= heroEffectiveHealth(state, enemy)) {
    return { kind: "hero", player: enemy };
  }
  const killable = enemyUnits
    .filter((unit) => !unit.keywords.includes("shield") && attack >= unit.health)
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
      return occupiedHandSlots(owner) < MAX_HAND_SIZE && owner.deck.length > 0;
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

  if (card.herald) {
    score += 8;
    if (owner.hand.includes(card.herald.colossalCardId)) score += 18;
  }
  if (card.colossal) {
    const multiplier = heraldMultiplier(owner);
    const openSlots = Math.max(0, MAX_BOARD_SIZE - owner.board.length - 1);
    const usableParts = card.colossal.parts.slice(0, openSlots);
    score += ((card.attack ?? 0) * 2 + (card.health ?? 0)) * (multiplier - 1);
    score += usableParts.reduce(
      (total, part) => total + (part.attack * 2 + part.health) * multiplier,
      0,
    );
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
      tradeable: occupiedHandSlots(owner) >= 8 ? 2 : 0,
      prepare: 3,
      bribe: -2,
      disguised: 2,
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
        score += occupiedHandSlots(owner) < 7 ? 7 * effect.count : -5 * effect.count;
        break;
      case "draw-opponent":
        score += enemy.deck.length === 0
          ? 3 * effect.count
          : occupiedHandSlots(enemy) < MAX_HAND_SIZE
            ? -6 * effect.count
            : 0;
        break;
      case "damage-friendly-hero":
        score -= effect.amount * 2;
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

/**
 * Rank a Discover candidate using the same board-aware card score as normal
 * AI plays.  Discover should feel like a real decision, not a random first
 * item: lethal burn, a playable curve card, and a stabilising answer all
 * rise above an awkward expensive card.  Ties intentionally preserve the
 * catalog order so replays remain deterministic.
 */
function scoreAiDiscoverChoice(
  state: MatchState,
  player: PlayerId,
  cardId: string,
): number {
  const card = CARD_BY_ID[cardId];
  if (!card) return Number.NEGATIVE_INFINITY;

  const owner = state.players[player];
  const enemy = state.players[otherPlayer(player)];
  let score = scoreAiCard(state, player, card);
  if (card.cost <= owner.mana) score += 8;
  if (card.cost === owner.mana) score += 4;
  if (card.type === "unit" && owner.board.length >= MAX_BOARD_SIZE) score -= 8;
  if (card.type === "spell" && card.target === "enemy-character") {
    const directDamage = (card.effect ?? []).reduce(
      (total, effect) => total + (effect.kind === "damage" ? effect.amount : 0),
      0,
    ) + activeTraitTier(state, player, "arcane") + spellDamageBonus(state, player);
    if (enemy.hero.health <= directDamage) score += 40;
  }
  if (card.type === "spell" && card.target?.startsWith("friendly")) {
    const wounded = owner.hero.health < owner.hero.maxHealth || owner.board.some(
      (unit) => unit.health < unit.maxHealth,
    );
    if (wounded) score += 12;
  }
  // A card that cannot be played this turn is still useful, but it should
  // lose a close decision to a card that advances the current turn.
  if (card.cost > owner.mana) score -= Math.min(12, card.cost - owner.mana);
  return score;
}

function chooseAiDiscoverChoice(
  state: MatchState,
  player: PlayerId,
  choices: readonly string[],
): string | undefined {
  let best: string | undefined;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const cardId of choices) {
    const score = scoreAiDiscoverChoice(state, player, cardId);
    if (score > bestScore) {
      best = cardId;
      bestScore = score;
    }
  }
  return best;
}

function scoreAiChooseOneOption(
  state: MatchState,
  player: PlayerId,
  effects: readonly CardEffect[],
  target: BattleTarget | undefined,
): number {
  const owner = state.players[player];
  const enemy = state.players[otherPlayer(player)];
  const targetUnit = target?.kind === "unit" ? findUnit(state, target.entityId) : undefined;
  let score = 0;
  for (const effect of effects) {
    switch (effect.kind) {
      case "damage":
        score += effect.amount * (enemy.board.length > 0 ? 2 : 1);
        if (enemy.hero.health <= effect.amount) score += 40;
        if (targetUnit && targetUnit.owner !== player && targetUnit.health <= effect.amount) score += 18;
        break;
      case "heal":
        score += Math.max(0, owner.hero.maxHealth - owner.hero.health) > 0 ? effect.amount * 2 : 0;
        if (targetUnit && targetUnit.owner === player) {
          score += Math.max(0, targetUnit.maxHealth - targetUnit.health) * 2;
        }
        break;
      case "buff":
      case "buff-all-friendly":
      case "temporary-buff":
        score += owner.board.length > 0
          ? Math.max(1, effect.attack * 1.5 + effect.health * 2) * (effect.kind === "buff-all-friendly" ? owner.board.length : 1)
          : -10;
        if (targetUnit && targetUnit.owner === player) {
          score += Math.max(0, targetUnit.maxHealth - targetUnit.health);
        }
        break;
      case "summon":
        score += Math.min(effect.count, MAX_BOARD_SIZE - owner.board.length) * 8;
        break;
      case "draw":
        score += occupiedHandSlots(owner) < MAX_HAND_SIZE ? effect.count * 7 : -effect.count * 6;
        break;
      case "draw-opponent":
        score += enemy.deck.length === 0
          ? effect.count * 3
          : occupiedHandSlots(enemy) < MAX_HAND_SIZE
            ? -effect.count * 6
            : 0;
        break;
      case "damage-friendly-hero":
        score -= effect.amount * 2;
        break;
      case "armor":
        score += owner.hero.health < owner.hero.maxHealth ? effect.amount * 2 : effect.amount;
        break;
      case "random-enemy-damage":
        score += effect.amount * (enemy.board.length + 1);
        break;
      case "damage-all-enemies":
        score += effect.amount * (enemy.board.length + 1) * 2;
        break;
      case "discover":
        score += 9;
        break;
      case "choose-one":
        score += 6;
        break;
      case "freeze":
      case "random-enemy-freeze":
        score += enemy.board.length > 0 ? 8 : 0;
        break;
      case "silence":
      case "transform":
        score += enemy.board.length > 0 ? 10 : -5;
        break;
      case "secret":
        score += 4;
        break;
    }
  }
  return score;
}

function chooseAiChooseOneOption(
  state: MatchState,
  player: PlayerId,
  options: readonly ChooseOneState["options"][number][],
  target: BattleTarget | undefined,
): number {
  let bestIndex = 0;
  let bestScore = Number.NEGATIVE_INFINITY;
  options.forEach((option, index) => {
    const score = scoreAiChooseOneOption(state, player, option.effects, target);
    if (score > bestScore) {
      bestIndex = index;
      bestScore = score;
    }
  });
  return bestIndex;
}

function chooseAiCardPlacement(
  state: MatchState,
  player: PlayerId,
  card: CardDefinition,
): "friendly" | "enemy" {
  if (card.type !== "unit" || !card.disguised) return "friendly";
  const owner = state.players[player];
  const opponent = state.players[otherPlayer(player)];
  const canPlaceFriendly = owner.board.length < MAX_BOARD_SIZE
    || Boolean(findUpgradeTarget(owner, card));
  const canPlaceEnemy = opponent.board.length < MAX_BOARD_SIZE
    || Boolean(findUpgradeTarget(opponent, card));
  if (!canPlaceFriendly && canPlaceEnemy) return "enemy";
  if (!canPlaceEnemy) return "friendly";
  // A low-health opponent or their final free slot makes the delayed
  // controller-damage drawback worth handing over the otherwise useful body.
  if (opponent.hero.health <= 2 || opponent.board.length >= MAX_BOARD_SIZE - 1) {
    return "enemy";
  }
  return "friendly";
}

function isAiCardPlayable(
  state: MatchState,
  player: PlayerId,
  card: CardDefinition,
  handIndex?: number,
): boolean {
  const playableCard = handIndex === undefined
    ? card
    : cardForHandSlot(state.players[player], handIndex, card);
  const cost = handIndex === undefined
    ? playableCard.cost
    : effectiveHandCardCost(state.players[player], playableCard, handIndex);
  if (cost > state.players[player].mana) {
    return false;
  }
  const placement = chooseAiCardPlacement(state, player, playableCard);
  const unitOwner = placement === "enemy" ? otherPlayer(player) : player;
  if (
    playableCard.type === "unit" &&
    state.players[unitOwner].board.length >= MAX_BOARD_SIZE &&
    !findUpgradeTarget(state.players[unitOwner], playableCard)
  ) {
    return false;
  }

  const rule = playableCard.target ?? "none";
  if (playableCard.type === "unit" && rule !== "none" && !hasValidCardTarget(state, player, playableCard)) {
    // A targeted Battlecry does not prevent a minion from being played when
    // no legal target exists; the Battlecry simply has no effect.
    return true;
  }
  return rule === "none" || hasValidCardTarget(state, player, playableCard);
}

interface AiPlayableCard {
  card: CardDefinition;
  handOrder: number;
  effectiveCost: number;
  placement: "friendly" | "enemy";
}

function aiShatterReassemblyBonus(owner: PlayerState, handIndex: number): number {
  const fragments = normalizedHandFragments(owner);
  const fragment = fragments[handIndex];
  if (fragment) return 0;
  const groupPositions = new Map<string, number[]>();
  fragments.forEach((entry, index) => {
    if (!entry) return;
    const positions = groupPositions.get(entry.groupId) ?? [];
    positions.push(index);
    groupPositions.set(entry.groupId, positions);
  });
  for (const positions of groupPositions.values()) {
    if (positions.length !== 2) continue;
    const [left, right] = positions.sort((a, b) => a - b);
    if (left < handIndex && handIndex < right) return 10;
  }
  return 0;
}

/**
 * Select the next card from the strongest affordable package, rather than
 * greedily taking the single highest-scoring card. With a ten-card hand the
 * complete subset search is capped at 1,024 combinations, so the AI can use
 * a 2+2 curve over an isolated 3-cost play without making turns feel slow.
 */
function chooseAiPlayableCard(
  state: MatchState,
  player: PlayerId,
): AiPlayableCard | undefined {
  const owner = state.players[player];
  const candidates = owner.hand
    .map((cardId, handOrder) => {
      const catalogCard = CARD_BY_ID[cardId];
      const card = catalogCard
        ? cardForHandSlot(owner, handOrder, catalogCard)
        : undefined;
      return {
        card,
        handOrder,
        effectiveCost: card ? effectiveHandCardCost(owner, card, handOrder) : 0,
        placement: card
          ? chooseAiCardPlacement(state, player, card)
          : "friendly" as const,
      };
    })
    .filter((entry): entry is AiPlayableCard =>
      Boolean(entry.card) && isAiCardPlayable(state, player, entry.card, entry.handOrder),
    );
  if (candidates.length === 0) return undefined;

  let bestMask = 0;
  let bestScore = Number.NEGATIVE_INFINITY;
  let bestManaSpent = -1;
  const combinationCount = 1 << candidates.length;
  for (let mask = 1; mask < combinationCount; mask += 1) {
    let manaSpent = 0;
    let score = 0;
    let selectedCount = 0;
    let extraFriendlyBoardSlots = 0;
    let extraEnemyBoardSlots = 0;
    for (let index = 0; index < candidates.length; index += 1) {
      if ((mask & (1 << index)) === 0) continue;
      const candidate = candidates[index];
      if (!candidate) continue;
      manaSpent += candidate.effectiveCost;
      if (manaSpent > owner.mana) break;
      selectedCount += 1;
      score += scoreAiCard(state, player, candidate.card)
        + aiShatterReassemblyBonus(owner, candidate.handOrder);
      if (
        candidate.card.type === "unit" &&
        !findUpgradeTarget(
          candidate.placement === "enemy"
            ? state.players[otherPlayer(player)]
            : owner,
          candidate.card,
        )
      ) {
        if (candidate.placement === "enemy") extraEnemyBoardSlots += 1;
        else extraFriendlyBoardSlots += 1;
      }
    }
    if (
      manaSpent > owner.mana ||
      owner.board.length + extraFriendlyBoardSlots > MAX_BOARD_SIZE ||
      state.players[otherPlayer(player)].board.length + extraEnemyBoardSlots > MAX_BOARD_SIZE
    ) {
      continue;
    }

    // Reward a clean curve and a multi-card turn without overwhelming card
    // quality. The underlying score still decides between equally full plans.
    score += manaSpent * 2 + selectedCount * 0.25;
    if (
      score > bestScore ||
      (score === bestScore && manaSpent > bestManaSpent)
    ) {
      bestMask = mask;
      bestScore = score;
      bestManaSpent = manaSpent;
    }
  }

  const selected = candidates.filter((_, index) => (bestMask & (1 << index)) !== 0);
  return selected.sort((left, right) => {
    if (left.card.herald?.colossalCardId === right.card.id) return -1;
    if (right.card.herald?.colossalCardId === left.card.id) return 1;
    return scoreAiCard(state, player, right.card) - scoreAiCard(state, player, left.card) ||
      right.effectiveCost - left.effectiveCost ||
      left.handOrder - right.handOrder;
  })[0];
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
    const command: BattleCommand = {
      type: "mulligan",
      player,
      cardIndexes: chooseAiMulliganIndexes(state, player),
    };
    const result = applyCommand(state, command);
    if (result.accepted) onStep?.(result.state, command);
    return result.accepted ? result.state : state;
  }

  if (state.phase === "discover" && state.discover?.player === player) {
    const choice = chooseAiDiscoverChoice(state, player, state.discover.choices);
    if (!choice) return state;
    const command: BattleCommand = {
      type: "choose-discover",
      player,
      cardId: choice,
    };
    const result = applyCommand(state, command);
    if (result.accepted) onStep?.(result.state, command);
    return result.accepted ? result.state : state;
  }

  if (state.phase === "choose-one" && state.chooseOne?.player === player) {
    const optionIndex = chooseAiChooseOneOption(
      state,
      player,
      state.chooseOne.options,
      state.chooseOne.target,
    );
    const command: BattleCommand = {
      type: "choose-one",
      player,
      optionIndex,
    };
    const result = applyCommand(state, command);
    if (result.accepted) onStep?.(result.state, command);
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
    next.players[player].hand.some((cardId, handIndex) => {
      const card = CARD_BY_ID[cardId];
      return Boolean(
        card &&
        effectiveHandCardCost(next.players[player], card, handIndex) === next.players[player].mana + 1 &&
        // Test all non-mana constraints against a one-crystal preview. Calling
        // isAiCardPlayable on the pre-Coin state made this branch impossible.
        isAiCardPlayable({
          ...next,
          players: [
            next.players[0],
            next.players[1],
          ].map((entry, index) => index === player
            ? { ...entry, mana: entry.mana + 1 }
            : entry) as [PlayerState, PlayerState],
        }, player, card, handIndex),
      );
    })
  ) {
    const coinResult = applyAiCommand(next, { type: "use-coin", player });
    if (coinResult.accepted) next = coinResult.state;
  }


  if (shouldAiUseDirectHeroPowerForLethal(next, player)) {
    const powerResult = applyAiCommand(next, {
      type: "hero-power",
      player,
    });
    if (powerResult.accepted) {
      next = powerResult.state;
      if (next.phase === "game-over") return next;
    }
  }
  for (let safety = 0; safety < 30; safety += 1) {
    // A newly played direct-damage card can turn the remaining board and
    // Hero Power into lethal. Spend that reserved Power before considering
    // another card, otherwise a harmless follow-up can consume its mana.
    if (shouldAiUseDirectHeroPowerForLethal(next, player)) {
      const powerResult = applyAiCommand(next, {
        type: "hero-power",
        player,
      });
      if (powerResult.accepted) {
        next = powerResult.state;
        if (next.phase === "game-over") return next;
        continue;
      }
    }
    const playable = chooseAiPlayableCard(next, player);

    if (!playable) {
      const reductions = normalizedHandCostReductions(next.players[player]);
      const preparable = next.players[player].hand
        .map((cardId, handOrder) => ({ card: CARD_BY_ID[cardId], handOrder }))
        .filter(
          (entry): entry is { card: CardDefinition; handOrder: number } =>
            Boolean(entry.card?.preparable)
            && (reductions[entry.handOrder] ?? 0) === 0,
        )
        .sort(
          (left, right) =>
            right.card.cost - left.card.cost || left.handOrder - right.handOrder,
        )[0];
      if (preparable && next.players[player].mana > 0) {
        const prepareResult = applyAiCommand(next, {
          type: "prepare-card",
          player,
          cardId: preparable.card.id,
          handIndex: preparable.handOrder,
        });
        if (!prepareResult.accepted) break;
        next = prepareResult.state;
        continue;
      }
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
        handIndex: tradeable.handOrder,
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
      handIndex: playable.handOrder,
      placement: playable.placement,
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
      const choice = chooseAiDiscoverChoice(next, player, next.discover.choices);
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
      const optionIndex = chooseAiChooseOneOption(
        next,
        player,
        next.chooseOne.options,
        next.chooseOne.target,
      );
      const chooseOneResult = applyAiCommand(next, {
        type: "choose-one",
        player,
        optionIndex,
      });
      if (!chooseOneResult.accepted) return next;
      next = chooseOneResult.state;
    }
  }

  for (let safety = 0; safety < MAX_BOARD_SIZE * 2; safety += 1) {
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
