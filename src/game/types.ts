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

export type CardType = "unit" | "spell" | "weapon" | "hero" | "location";

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

/** Expansion release within an annual Hearthstone-style content year. */
export type CardReleaseWave = 1 | 2 | 3;

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
  | "elusive"
  | "immune"
  | "immune-while-attacking"
  | "dormant"
  | "titan"
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
  | "colossal"
  | "quickdraw"
  | "casts-when-drawn";

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
  | "friendly-unit"
  | "any-unit";

export type CardEffect =
  | {
      /** Gain temporary mana this turn; used by the match-only Coin card. */
      kind: "gain-temporary-mana";
      amount: number;
    }
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
      /** Discover a physical opposing hand card and retain its current enchantments. */
      kind: "discover-copy-opponent-hand";
    }
  | {
      /** Copy random physical opposing deck cards with their current enchantments. */
      kind: "copy-random-opponent-deck";
      count: number;
    }
  | {
      /** Cast a copy of the most recent spell the opposing player played. */
      kind: "recast-last-opponent-spell";
    }
  | {
      /** Once per game, recast each friendly spell that did not start in deck. */
      kind: "recast-nondeck-spells-once";
    }
  | {
      /** Transform the resolving Battlecry source into an exact battlefield copy. */
      kind: "become-copy-of-unit";
    }
  | {
      /** Summon an exact battlefield copy of the targeted living minion. */
      kind: "summon-copy-of-unit";
    }
  | {
      /** Add the targeted minion's current card identity to hand without battlefield enchantments. */
      kind: "copy-unit-to-hand";
    }
  | {
      kind: "temporary-buff";
      attack: number;
      health: number;
      duration: "end-of-turn";
    }
  | {
      /** Prevent damage and opposing direct selection until the owner's turn ends. */
      kind: "grant-immune";
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
      /** Fixed pools remain available for cards that name exact candidates. */
      choices?: readonly string[];
      /** Dynamic pools are evaluated when the choice opens, against the match format. */
      pool?: {
        faction: "friendly" | "neutral";
        includeNeutral?: boolean;
        cardType?: CardType;
      };
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
      /** Defaults to the resolving player; opponent supports Bomb/Plague-style inserts. */
      player?: "friendly" | "opponent";
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
  /** Annual expansion window; Core cards do not have a release wave. */
  releaseWave?: CardReleaseWave;
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
  /** Dynamic immunity derived from the current friendly battlefield. */
  conditionalImmune?: {
    kind: "while-friendly-minion-type";
    minionType: MinionType;
    excludeSelf?: boolean;
  };
  /** Printed Dormant countdown and effects resolved when the unit awakens. */
  dormant?: {
    turns: number;
    onAwaken?: readonly CardEffect[];
  };
  /** Three once-per-minion abilities used in place of this unit's first attacks. */
  titan?: {
    abilities: readonly ChooseOneOption[];
  };
  /** Effects triggered at the start of this unit owner's turn. */
  onTurnStart?: readonly CardEffect[];
  /** Effects triggered at the end of this unit owner's turn. */
  onTurnEnd?: readonly CardEffect[];
  /** Effects triggered after this player finishes resolving a spell. */
  onSpellPlayed?: readonly CardEffect[];
  /** Effects triggered when this card is discarded from hand. */
  onDiscard?: readonly CardEffect[];
  /** Bonus resolved only when played during the turn this physical card entered hand. */
  quickdraw?: readonly CardEffect[];
  /** Automatically cast from the deck instead of entering hand, then draw a replacement. */
  castsWhenDrawn?: boolean;
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
  /** Physical identity of the latest Hero card that transformed this hero. */
  cardEntityId?: string;
  /** Freeze consumes the hero's next attack opportunity. */
  frozenTurns?: number;
  /** True while Freeze has blocked the current turn's hero attack. */
  freezeBlocked?: boolean;
  /** Temporary immunity expires when this hero's controller ends the turn. */
  immuneThisTurn?: boolean;
}

export interface WeaponState {
  /** Physical card identity preserved from hand until this weapon leaves play. */
  entityId?: string;
  cardId: string;
  name: string;
  attack: number;
  durability: number;
  maxDurability: number;
}

export interface SecretState {
  /** Physical card identity preserved from hand while the Secret is armed. */
  entityId?: string;
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
  copiedFrom?: "opponent-hand";
  /** Hand-to-hand copies retain the chosen physical card's current enchantments. */
  choiceSnapshots?: Array<{
    cardId: string;
    costReduction: number;
    fragment?: "left" | "right";
  }>;
}

export interface ChooseOneState {
  player: PlayerId;
  sourceCardId: string;
  /** Physical source identity retained while a played card awaits a choice. */
  sourceEntityId?: string;
  options: ChooseOneOption[];
  target?: BattleTarget;
  /** Remaining selections, including the next selection. Legacy Choose One defaults to one. */
  remainingChoices?: number;
  sourceKind?: "spell" | "hero-card";
  chosenLabels?: string[];
  /** Origin of the pending spell's physical hand entity. */
  startedInDeck?: boolean;
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
  /** Temporary immunity expires when this unit's controller ends the turn. */
  immuneThisTurn?: boolean;
  /** Public projection of a currently satisfied printed immunity condition. */
  conditionalImmuneActive?: boolean;
  /** Remaining starts of this unit's controller turn before it awakens. */
  dormantTurns?: number;
  /** Stable printed Titan ability indexes already consumed by this physical minion. */
  titanAbilitiesUsed?: number[];
}

/** A Location occupies one battlefield slot but is not a minion or attack target. */
export interface LocationState {
  entityId: string;
  cardId: string;
  name: string;
  owner: PlayerId;
  durability: number;
  maxDurability: number;
  /** Global turn on which the button next becomes usable. */
  readyOnTurn: number;
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

export interface CardGraveyardRecord {
  entityId: string;
  cardId: string;
  name: string;
  cardType: CardType;
  player: PlayerId;
  fromZone: "deck" | "hand" | "weapon" | "secret" | "location" | "generated";
  reason: "resolved" | "countered" | "cast-when-drawn" | "discarded" | "replaced" | "durability" | "triggered" | "transformed" | "burned";
  turn: number;
  order: number;
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
  /** Ordered private identities of spells successfully played from hand this game. */
  spellsPlayedThisGame?: string[];
  /** Physical card identities aligned with `spellsPlayedThisGame`. */
  spellsPlayedEntityIds?: string[];
  /** Whether each aligned spell-history entry originated in the starting deck. */
  spellsPlayedFromStartingDeck?: boolean[];
  /** Once-per-game limiter for replaying every non-starting-deck spell. */
  nonDeckSpellRecastUsed?: boolean;
  /** Public ordered history of friendly units killed while controlled by this player. */
  deathHistory?: DeathRecord[];
  /** Public ordered history of cards discarded from this player's hand. */
  discardHistory?: DiscardRecord[];
  /** Ordered physical non-unit cards that have reached the graveyard. */
  cardGraveyard?: CardGraveyardRecord[];
  maxMana: number;
  mana: number;
  deck: string[];
  /** Optional fixed costs aligned with `deck`; null means printed cost. */
  deckCostOverrides?: Array<number | null>;
  /** Origin flags aligned with `deck`; false marks cards generated after match start. */
  deckStartedInDeck?: boolean[];
  /** Stable private identities aligned with physical deck positions. */
  deckEntityIds?: string[];
  hand: string[];
  /** Per-hand-slot permanent cost reductions. Missing legacy entries are treated as zero. */
  handCostReductions?: number[];
  /** Physical Shatter fragment metadata aligned with `hand`. */
  handFragments?: Array<{
    groupId: string;
    piece: "left" | "right";
  } | null>;
  /** Origin flags aligned with `hand`; Shatter fragments share the source flag. */
  handStartedInDeck?: boolean[];
  /** Global turn when each physical card entered hand; zero means before normal turns. */
  handEnteredTurns?: number[];
  /** Stable private identities aligned with hand slots and preserved onto played/bounced units. */
  handEntityIds?: string[];
  /** Number of Herald minions played this match; every two double linked Colossals. */
  heraldCount?: number;
  board: UnitState[];
  /** Locations share the seven battlefield slots with minions. */
  locations?: LocationState[];
  fatigue: number;
  heroPowerUsed: boolean;
  /** Temporary attack granted to the hero until the end of its controller's turn. */
  heroAttackBonus?: number;
  /** Derived compatibility mirror: true while at least one Coin is in hand. */
  coinAvailable: boolean;
  /** Derived identity of the first Coin in the generic hand. */
  coinEntityId?: string;
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
  | "card-added"
  | "card-burned"
  | "card-discarded"
  | "card-recovered"
  | "card-copied"
  | "card-traded"
  | "card-prepared"
  | "card-shattered"
  | "card-reassembled"
  | "quickdraw-triggered"
  | "card-cast-when-drawn"
  | "herald-triggered"
  | "colossal-assembled"
  | "hero-transformed"
  | "cataclysm-unleashed"
  | "cards-shuffled"
  | "fatigue"
  | "card-played"
  | "location-played"
  | "location-activated"
  | "location-destroyed"
  | "weapon-equipped"
  | "weapon-broke"
  | "secret-armed"
  | "secret-triggered"
  | "spell-countered"
  | "spell-recast"
  | "discover-started"
  | "discover-chosen"
  | "choose-one-started"
  | "choose-one-chosen"
  | "mana-overloaded"
  | "mana-gained"
  | "combo-triggered"
  | "unit-summoned"
  | "unit-awakened"
  | "titan-ability-used"
  | "damage"
  | "healing"
  | "unit-buffed"
  | "hero-frozen"
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
  /** Collection legality used by effects that generate cards dynamically. */
  rankedFormat: RankedFormat;
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
      type: "activate-location";
      locationId: string;
      target?: BattleTarget;
    })
  | (CommandMetadata & {
      type: "use-titan-ability";
      unitId: string;
      abilityIndex: number;
      target?: BattleTarget;
    })
  | (CommandMetadata & {
      type: "choose-discover";
      cardId: string;
      /** Disambiguates physical copies of the same card with different hand enchantments. */
      choiceIndex?: number;
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
  | "titan-unavailable"
  | "target-required"
  | "invalid-target"
  | "attacker-not-found"
  | "attacker-exhausted"
  | "attacker-summoning-sick"
  | "taunt-blocking"
  | "weapon-unavailable"
  | "hero-exhausted"
  | "hero-frozen"
  | "location-not-found"
  | "location-cooling-down"
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
  /** Injected for deterministic clients and server replays when no explicit seed is supplied. */
  clock?: { now(): number };
  rankedFormat?: RankedFormat;
  decks?: readonly [readonly string[], readonly string[]];
  playerDeck?: readonly string[];
  opponentDeck?: readonly string[];
  startingPlayer?: PlayerId;
  matchId?: string;
}
