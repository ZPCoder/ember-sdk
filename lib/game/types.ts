export type PlayerId = 0 | 1;

export type Faction =
  | "曜光"
  | "幽潮"
  | "中立"
  | "烬火"
  | "星穹"
  | "苍林"
  | "雷铸";

export type CardType = "unit" | "spell" | "weapon";

export type CardRarity = "普通" | "稀有" | "史诗" | "传说";

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
  | "start-of-turn";

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
      kind: "buff";
      attack: number;
      health: number;
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
  | { kind: "armor"; amount: number };

export interface CardDefinition {
  id: string;
  name: string;
  description: string;
  faction: Faction;
  type: CardType;
  cost: number;
  rarity: CardRarity;
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
  keywords?: readonly Keyword[];
  traits?: readonly Trait[];
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
}

export type HeroPowerEffect =
  | { kind: "damage-enemy-hero"; amount: number }
  | { kind: "heal-friendly-hero"; amount: number }
  | { kind: "draw"; count: number }
  | { kind: "summon"; cardId: string; count: number }
  | { kind: "armor"; amount: number };

export interface HeroPowerDefinition {
  id: string;
  faction: Faction;
  name: string;
  description: string;
  cost: number;
  effect: HeroPowerEffect;
}

export interface UnitState {
  entityId: string;
  cardId: string;
  name: string;
  owner: PlayerId;
  attack: number;
  health: number;
  maxHealth: number;
  keywords: Keyword[];
  stars: 1 | 2;
  furyStacks: number;
  hasAttacked: boolean;
  summonedTurn: number;
  attacksMade: number;
  summoningSick: boolean;
  rushOnly: boolean;
  stealthActive: boolean;
  frozenTurns: number;
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

export interface PlayerState {
  id: PlayerId;
  faction: Faction;
  heroPower: HeroPowerDefinition;
  hero: HeroState;
  weapon: WeaponState | null;
  heroHasAttacked: boolean;
  secrets: SecretState[];
  overload: number;
  cardsPlayedThisTurn: number;
  maxMana: number;
  mana: number;
  deck: string[];
  hand: string[];
  board: UnitState[];
  fatigue: number;
  heroPowerUsed: boolean;
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
  | "fatigue"
  | "card-played"
  | "weapon-equipped"
  | "weapon-broke"
  | "secret-armed"
  | "secret-triggered"
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
  | "turn-ended"
  | "turn-started"
  | "turn-triggered"
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
      target?: BattleTarget;
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
    })
  | (CommandMetadata & {
      type: "use-coin";
    })
  | (CommandMetadata & {
      type: "end-turn";
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
  | "discover-closed"
  | "invalid-discover"
  | "choose-one-closed"
  | "invalid-choose-one"
  | "hero-power-used"
  | "coin-unavailable";

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
