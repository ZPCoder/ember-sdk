export type PlayerId = 0 | 1;

export type Faction =
  | "曜光"
  | "幽潮"
  | "中立"
  | "烬火"
  | "星穹"
  | "苍林"
  | "雷铸";

export type CardType = "unit" | "spell";

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
  | "freeze";

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
      kind: "summon";
      cardId: string;
      count: number;
    }
  | {
      kind: "random-enemy-damage";
      amount: number;
    }
  | {
      kind: "freeze" | "random-enemy-freeze";
      amount?: number;
    }
  | {
      kind: "armor";
      amount: number;
    };

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
}

export interface PlayerState {
  id: PlayerId;
  hero: HeroState;
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

export type BattlePhase = "mulligan" | "main" | "game-over";

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
  | "unit-summoned"
  | "damage"
  | "healing"
  | "unit-buffed"
  | "shield-broken"
  | "attack"
  | "unit-died"
  | "turn-ended"
  | "turn-started"
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
