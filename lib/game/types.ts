export type PlayerId = 0 | 1;

export type Faction =
  | "曜光"
  | "幽潮"
  | "中立"
  | "烬火"
  | "星穹"
  | "苍林"
  | "雷铸"
  | "霜境"
  | "砂海"
  | "赤月"
  | "灵脉"
  | "暮影"
  | "云瀑"
  | "磁风"
  | "晶核"
  | "梦境"
  | "裂星"
  | "时砂"
  | "幽森"
  | "天穹";

export type CardType = "unit" | "spell" | "weapon" | "hero";

/** Permanent unit classifications used by deck, battlefield and zone queries. */
export type MinionType =
  | "beast"
  | "construct"
  | "dragon"
  | "elemental"
  | "tideborn"
  | "raider"
  | "spirit"
  | "undead"
  | "all";

export type CardRarity = "普通" | "稀有" | "史诗" | "传说";

export type RankedFormat = "standard" | "wild";

export type CardSetId = "core" | "raptor-2025" | "scarab-2026" | "pegasus-2024";

export type Keyword =
  | "battlecry"
  | "deathrattle"
  | "charge"
  | "rush"
  | "taunt"
  | "shield"
  | "lifesteal"
  | "fury"
  | "windfury"
  | "poisonous"
  | "stealth"
  | "reborn"
  | "freeze"
  | "secret"
  | "discover"
  | "overload"
  | "combo"
  | "spell-damage"
  | "silence"
  | "choose-one"
  | "transform"
  | "temporary"
  | "end-of-turn"
  | "start-of-turn"
  | "spell-trigger"
  | "tradeable"
  | "prepare"
  | "bribe"
  | "disguised"
  | "shatter"
  | "herald"
  | "colossal";

export type Trait =
  | "swift"
  | "bulwark"
  | "arcane"
  | "hunt"
  | "craft";

export type SpellSchool =
  | "radiance"
  | "tide"
  | "construct"
  | "ember"
  | "astral"
  | "verdant"
  | "storm";

export type CardTargetRule =
  | "none"
  | "enemy-character"
  | "friendly-character"
  | "any-character"
  | "enemy-unit"
  | "friendly-unit";

export type CardEffect =
  | {
      kind: "damage";
      amount: number;
    }
  | {
      kind: "heal";
      amount: number;
    }
  | {
      kind: "draw";
      count: number;
    }
  | {
      /** Give the opposing player the negotiated benefit of a Bribe card. */
      kind: "draw-opponent";
      count: number;
    }
  | {
      /** Damage the hero currently controlling the source unit. */
      kind: "damage-friendly-hero";
      amount: number;
    }
  | {
      kind: "buff";
      attack: number;
      health: number;
    }
  | {
      /** Apply a battlecry-style stat increase to every friendly unit. */
      kind: "buff-all-friendly";
      attack: number;
      health: number;
    }
  | {
      /** Buff friendly units matching a permanent minion type. */
      kind: "buff-friendly-minion-type";
      minionType: MinionType;
      attack: number;
      health: number;
      excludeSource?: boolean;
    }
  | {
      /** Search the deck for matching units without causing Fatigue on a miss. */
      kind: "draw-minion-type";
      minionType: MinionType;
      count: number;
    }
  | {
      /** Search the deck for spells from one permanent spell school. */
      kind: "draw-spell-school";
      school: SpellSchool;
      count: number;
    }
  | {
      /** Resolve nested text only when the player's successful spell history qualifies. */
      kind: "spell-school-payoff";
      window: "this-turn" | "last-turn";
      requiredSchool?: SpellSchool;
      minimumDistinct?: number;
      effects: readonly CardEffect[];
    }
  | {
      /** Summon fresh printed copies of the most recently killed friendly units. */
      kind: "resurrect-friendly-unit";
      count: number;
      minionType?: MinionType;
    }
  | {
      /** Move a battlefield unit back to its controller's hand without killing it. */
      kind: "return-unit-to-hand";
    }
  | {
      /** Permanently move the targeted enemy unit to the resolving player's battlefield. */
      kind: "take-control";
    }
  | {
      /** Permanently move one random living enemy unit to the resolving player's battlefield. */
      kind: "take-control-random-enemy";
    }
  | {
      /** Randomly move cards from the current hand into public discard history. */
      kind: "discard-random";
      count: number;
    }
  | {
      /** Add printed copies of random cards discarded earlier this game. */
      kind: "recover-discarded";
      count: number;
    }
  | {
      kind: "temporary-buff";
      attack: number;
      health: number;
      duration: "end-of-turn";
    }
  | {
      kind: "summon";
      cardId: string;
      count: number;
    }
  | {
      kind: "random-enemy-damage";
      amount: number;
    }
  | {
      kind: "damage-all-enemies";
      amount: number;
    }
  | {
      /** Deal damage to enemy minions without also hitting the enemy hero. */
      kind: "damage-all-enemy-units";
      amount: number;
    }
  | {
      /** Destroy one enemy minion with the highest current Health. */
      kind: "destroy-highest-health-enemy";
    }
  | {
      kind: "silence";
    }
  | {
      kind: "freeze" | "random-enemy-freeze";
      amount?: number;
    }
  | {
      kind: "armor";
      amount: number;
    }
  | {
      kind: "secret";
      secretId: string;
      trigger: SecretTrigger;
      effect: SecretEffect;
    }
  | {
      kind: "discover";
      choices: readonly string[];
    }
  | {
      kind: "choose-one";
      options: readonly ChooseOneOption[];
    }
  | {
      kind: "transform";
      cardId: string;
    }
  | {
      /** Shuffle generated cards into the deck with an optional fixed drawn cost. */
      kind: "shuffle-random-into-deck";
      cardIds: readonly string[];
      count: number;
      cost?: number;
    };

export interface ChooseOneOption {
  label: string;
  effects: readonly CardEffect[];
}

export type SecretTrigger =
  | "opponent-plays-spell"
  | "opponent-attacks-hero"
  | "opponent-summons-unit";

export type SecretEffect =
  | { kind: "damage-attacker"; amount: number }
  | { kind: "damage-enemy-hero"; amount: number }
  | { kind: "draw"; count: number }
  | { kind: "heal-friendly-hero"; amount: number }
  | { kind: "armor"; amount: number }
  | { kind: "counterspell" };

export interface CardDefinition {
  id: string;
  name: string;
  description: string;
  faction: Faction;
  type: CardType;
  cost: number;
  rarity: CardRarity;
  /** Release set assigned by the assembled catalog; raw expansion fixtures may omit it. */
  set?: CardSetId;
  attack?: number;
  health?: number;
  /** Attack value for weapons; health is intentionally not used for durability. */
  durability?: number;
  /** Mana crystals locked at the start of the player's next turn. */
  overload?: number;
  /** Additional effects when another card was played earlier this turn. */
  combo?: readonly CardEffect[];
  /** Bonus damage applied to damage-dealing spells while this unit is in play. */
  spellDamage?: number;
  /** Effects triggered at the start of this unit owner's turn. */
  onTurnStart?: readonly CardEffect[];
  /** Effects triggered at the end of this unit owner's turn. */
  onTurnEnd?: readonly CardEffect[];
  /** Effects triggered after this player finishes resolving a spell. */
  onSpellPlayed?: readonly CardEffect[];
  /** Effects triggered when this card is discarded from hand. */
  onDiscard?: readonly CardEffect[];
  /** Allows the card to be shuffled back into the deck for 1 mana to draw a replacement. */
  tradeable?: boolean;
  /** Allows the card to consume all remaining mana once for a permanent hand discount of that amount plus one. */
  preparable?: boolean;
  /** Marks a spell whose strong primary effect also grants the opponent a smaller benefit. */
  bribe?: boolean;
  /** Allows this unit card to be played onto either player's battlefield. */
  disguised?: boolean;
  /** Splits into independently playable fragments when added to hand. */
  shatter?: {
    left: readonly CardEffect[];
    right: readonly CardEffect[];
    leftTarget?: CardTargetRule;
    rightTarget?: CardTargetRule;
  };
  /** Playing this minion advances and materializes the linked Colossal plan. */
  herald?: {
    colossalCardId: string;
  };
  /** A multi-body minion whose main body and parts scale with Herald progress. */
  colossal?: {
    parts: readonly Array<{
      id: string;
      name: string;
      attack: number;
      health: number;
      keywords?: readonly Keyword[];
      minionTypes?: readonly MinionType[];
      effect?: readonly CardEffect[];
    }>;
  };
  /** Replaces the current hero, grants Armor, installs a Hero Power and opens a choice sequence. */
  heroCard?: {
    heroId: string;
    heroName: string;
    armor: number;
    heroPower: HeroPowerDefinition;
    options: readonly ChooseOneOption[];
    /** Select 1 option normally, 2 after two Heralds, and all 4 after four. */
    scalesWithHerald?: boolean;
  };
  /** False for generated cards that can exist in a match but never in collection/deckbuilding. */
  collectible?: boolean;
  keywords?: readonly Keyword[];
  traits?: readonly Trait[];
  /** Printed unit types. These persist through Silence and are replaced by Transform. */
  minionTypes?: readonly MinionType[];
  school?: SpellSchool;
  target?: CardTargetRule;
  effect?: readonly CardEffect[];
  onPlay?: readonly CardEffect[];
  onDeath?: readonly CardEffect[];
}

export interface DeckRules {
  size: number;
  maxCopies: number;
  maxLegendaryCopies: number;
}

export type DeckValidationErrorCode =
  | "wrong-size"
  | "unknown-card"
  | "too-many-copies"
  | "format-ineligible"
  | "mixed-factions";

export interface DeckValidationError {
  code: DeckValidationErrorCode;
  message: string;
  cardId?: string;
}

export interface DeckValidationResult {
  valid: boolean;
  errors: DeckValidationError[];
  faction: Faction | null;
}

export interface HeroState {
  health: number;
  maxHealth: number;
  armor: number;
  /** Optional transformed identity; legacy snapshots fall back to the faction commander. */
  id?: string;
  name?: string;
}

export interface WeaponState {
  cardId: string;
  name: string;
  attack: number;
  durability: number;
  maxDurability: number;
}

export interface SecretState {
  cardId: string;
  secretId: string;
  name: string;
  description: string;
  trigger: SecretTrigger;
  effect: SecretEffect;
}

export interface DiscoverState {
  player: PlayerId;
  sourceCardId: string;
  choices: string[];
}

export interface ChooseOneState {
  player: PlayerId;
  sourceCardId: string;
  options: ChooseOneOption[];
  target?: BattleTarget;
  /** Remaining selections, including the next selection. Legacy Choose One defaults to one. */
  remainingChoices?: number;
  sourceKind?: "spell" | "hero-card";
  chosenLabels?: string[];
}

export type HeroPowerEffect =
  | { kind: "damage-enemy-hero"; amount: number }
  | { kind: "damage-enemy-unit"; amount: number }
  | { kind: "heal-friendly-hero"; amount: number }
  | { kind: "heal-friendly-character"; amount: number }
  | { kind: "heal-friendly-unit"; amount: number }
  | { kind: "draw"; count: number }
  | { kind: "summon"; cardId: string; count: number }
  | { kind: "armor"; amount: number }
  | { kind: "gain-attack"; amount: number };

export interface HeroPowerDefinition {
  id: string;
  faction: Faction;
  name: string;
  description: string;
  cost: number;
  /** Target rule for powers that require a character or unit selection. */
  target?: CardTargetRule;
  effect: HeroPowerEffect;
}

export interface UnitState {
  entityId: string;
  cardId: string;
  name: string;
  owner: PlayerId;
  /** Monotonic battlefield entry order used to resolve simultaneous deaths. */
  playOrder?: number;
  attack: number;
  health: number;
  maxHealth: number;
  keywords: Keyword[];
  /** Public, permanent unit types copied from the current transformed identity. */
  minionTypes?: MinionType[];
  stars: 1 | 2;
  furyStacks: number;
  hasAttacked: boolean;
  summonedTurn: number;
  attacksMade: number;
  summoningSick: boolean;
  rushOnly: boolean;
  stealthActive: boolean;
  frozenTurns: number;
  /** True when Freeze has already consumed this unit's current-turn attack. */
  freezeBlocked?: boolean;
  rebornUsed: boolean;
  /** Printed stats used to remove temporary buffs when a unit is silenced. */
  baseAttack?: number;
  baseHealth?: number;
  silenced?: boolean;
  /** Printed spell-damage aura. Optional for backwards-compatible snapshots. */
  spellDamage?: number;
  /** Temporary attack added until the end of the unit owner's turn. */
  temporaryAttackBonus?: number;
  /** Temporary max-health added until the end of the unit owner's turn. */
  temporaryHealthBonus?: number;
}

export interface DeathRecord {
  entityId: string;
  cardId: string;
  name: string;
  controller: PlayerId;
  diedTurn: number;
  deathOrder: number;
  minionTypes: MinionType[];
}

export interface DiscardRecord {
  discardId: string;
  cardId: string;
  name: string;
  player: PlayerId;
  discardedTurn: number;
  discardOrder: number;
  fragment?: "left" | "right";
}

export interface PlayerState {
  id: PlayerId;
  faction: Faction;
  heroPower: HeroPowerDefinition;
  hero: HeroState;
  weapon: WeaponState | null;
  heroHasAttacked: boolean;
  secrets: SecretState[];
  overload: number;
  /** Mana crystals currently locked this turn after Overload is applied. */
  overloadLocked: number;
  cardsPlayedThisTurn: number;
  /** Successful, school-tagged spells completed during the current turn. */
  spellSchoolsPlayedThisTurn?: SpellSchool[];
  /** Successful, school-tagged spells completed during this player's previous turn. */
  spellSchoolsPlayedLastTurn?: SpellSchool[];
  /** Public ordered history of friendly units killed while controlled by this player. */
  deathHistory?: DeathRecord[];
  /** Public ordered history of cards discarded from this player's hand. */
  discardHistory?: DiscardRecord[];
  maxMana: number;
  mana: number;
  deck: string[];
  /** Optional fixed costs aligned with `deck`; null means printed cost. */
  deckCostOverrides?: Array<number | null>;
  hand: string[];
  /** Per-hand-slot permanent cost reductions. Missing legacy entries are treated as zero. */
  handCostReductions?: number[];
  /** Physical Shatter fragment metadata aligned with `hand`. */
  handFragments?: Array<{
    groupId: string;
    piece: "left" | "right";
  } | null>;
  /** Number of Herald minions played this match; every two double linked Colossals. */
  heraldCount?: number;
  board: UnitState[];
  fatigue: number;
  heroPowerUsed: boolean;
  /** Temporary attack granted to the hero until the end of its controller's turn. */
  heroAttackBonus?: number;
  /** The Hearthstone-style temporary +1 mana token for the second player. */
  coinAvailable: boolean;
}

export type BattlePhase = "mulligan" | "main" | "discover" | "choose-one" | "game-over";

export type MatchEndReason = "hero-defeated" | "fatigue" | "concede" | "draw";

export interface MatchResult {
  winner: PlayerId | null;
  reason: MatchEndReason;
}

export type BattleEventType =
  | "match-started"
  | "hero-power"
  | "card-drawn"
  | "card-burned"
  | "card-discarded"
  | "card-recovered"
  | "card-traded"
  | "card-prepared"
  | "card-shattered"
  | "card-reassembled"
  | "herald-triggered"
  | "colossal-assembled"
  | "hero-transformed"
  | "cataclysm-unleashed"
  | "cards-shuffled"
  | "fatigue"
  | "card-played"
  | "weapon-equipped"
  | "weapon-broke"
  | "secret-armed"
  | "secret-triggered"
  | "spell-countered"
  | "discover-started"
  | "discover-chosen"
  | "choose-one-started"
  | "choose-one-chosen"
  | "mana-overloaded"
  | "combo-triggered"
  | "unit-summoned"
  | "damage"
  | "healing"
  | "unit-buffed"
  | "temporary-expired"
  | "unit-silenced"
  | "unit-transformed"
  | "shield-broken"
  | "attack"
  | "unit-died"
  | "unit-resurrected"
  | "unit-returned"
  | "unit-control-changed"
  | "turn-ended"
  | "turn-timed-out"
  | "turn-started"
  | "turn-triggered"
  | "card-triggered"
  | "mulligan-completed"
  | "conceded"
  | "match-ended";

export interface BattleEvent {
  seq: number;
  type: BattleEventType;
  turn: number;
  player?: PlayerId;
  message: string;
  data?: Record<string, unknown>;
}

export interface MatchState {
  id: string;
  seed: number;
  rngState: number;
  version: number;
  turn: number;
  activePlayer: PlayerId;
  phase: BattlePhase;
  /** Whether each player has confirmed their opening hand. */
  mulliganDone: [boolean, boolean];
  discover: DiscoverState | null;
  chooseOne: ChooseOneState | null;
  players: [PlayerState, PlayerState];
  winner: PlayerId | null;
  result: MatchResult | null;
  events: BattleEvent[];
  nextEntityId: number;
  processedCommandIds: string[];
}

export type BattleTarget =
  | {
      kind: "hero";
      player: PlayerId;
    }
  | {
      kind: "unit";
      entityId: string;
    };

interface CommandMetadata {
  player: PlayerId;
  commandId?: string;
  expectedVersion?: number;
}

export type BattleCommand =
  | (CommandMetadata & {
      type: "mulligan";
      cardIndexes: number[];
    })
  | (CommandMetadata & {
      type: "play-card";
      cardId: string;
      handIndex?: number;
      placement?: "friendly" | "enemy";
      target?: BattleTarget;
    })
  | (CommandMetadata & {
      type: "trade-card";
      cardId: string;
      handIndex?: number;
    })
  | (CommandMetadata & {
      type: "prepare-card";
      cardId: string;
      handIndex?: number;
    })
  | (CommandMetadata & {
      type: "attack";
      attackerId: string;
      target: BattleTarget;
    })
  | (CommandMetadata & {
      type: "hero-attack";
      target: BattleTarget;
    })
  | (CommandMetadata & {
      type: "choose-discover";
      cardId: string;
    })
  | (CommandMetadata & {
      type: "choose-one";
      optionIndex: number;
    })
  | (CommandMetadata & {
      type: "hero-power";
      target?: BattleTarget;
    })
  | (CommandMetadata & {
      type: "use-coin";
    })
  | (CommandMetadata & {
      type: "end-turn";
      /** Internal server marker used when the authoritative turn clock expires. */
      reason?: "manual" | "timeout";
    })
  | (CommandMetadata & {
      type: "concede";
    });

export type CommandErrorCode =
  | "game-over"
  | "mulligan-closed"
  | "invalid-mulligan"
  | "not-your-turn"
  | "version-conflict"
  | "card-not-in-hand"
  | "not-enough-mana"
  | "board-full"
  | "target-required"
  | "invalid-target"
  | "attacker-not-found"
  | "attacker-exhausted"
  | "attacker-summoning-sick"
  | "taunt-blocking"
  | "weapon-unavailable"
  | "hero-exhausted"
  | "secret-limit"
  | "secret-duplicate"
  | "discover-closed"
  | "invalid-discover"
  | "choose-one-closed"
  | "invalid-choose-one"
  | "hero-power-used"
  | "coin-unavailable"
  | "not-tradeable"
  | "not-preparable"
  | "already-prepared"
  | "invalid-placement";

export interface CommandError {
  code: CommandErrorCode;
  message: string;
}

export interface CommandResult {
  state: MatchState;
  accepted: boolean;
  duplicate?: boolean;
  error?: CommandError;
}

export interface CreateMatchOptions {
  seed?: number;
  decks?: readonly [readonly string[], readonly string[]];
  playerDeck?: readonly string[];
  opponentDeck?: readonly string[];
  startingPlayer?: PlayerId;
  matchId?: string;
}
