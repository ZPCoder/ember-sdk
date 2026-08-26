import { DEFAULT_STARTER_DECK } from "./catalog.ts";
import type { BattleCommand } from "./types.ts";

export type TrainingProgress = {
  mulligan: boolean;
  cardPlayed: boolean;
  attack: boolean;
  turnEnded: boolean;
};

export type TrainingStage = "mulligan" | "play-card" | "end-turn" | "attack" | "complete";

export const TRAINING_DECK_ID = "training:starter";
export const TRAINING_MATCH_SEED = 0x1a57_2026;
export const TRAINING_STARTING_PLAYER = 0 as const;
export const TRAINING_OPPONENT_ARCHETYPE_ID = "radiance-midrange";
export const TRAINING_PLAYER_DECK: readonly string[] = DEFAULT_STARTER_DECK;

export const EMPTY_TRAINING_PROGRESS: Readonly<TrainingProgress> = Object.freeze({
  mulligan: false,
  cardPlayed: false,
  attack: false,
  turnEnded: false,
});

export function trainingProgressForFacts(
  previous: TrainingProgress,
  facts: {
    status: string;
    cardsPlayed: number;
    attacks: number;
    log: readonly string[];
  },
): TrainingProgress {
  return {
    mulligan: previous.mulligan || facts.status !== "mulligan",
    cardPlayed: previous.cardPlayed || facts.cardsPlayed > 0,
    attack: previous.attack || facts.attacks > 0,
    turnEnded: previous.turnEnded || facts.log.some((line) => line.includes("我方结束了回合")),
  };
}

export function currentTrainingStage(progress: TrainingProgress): TrainingStage {
  if (!progress.mulligan) return "mulligan";
  if (!progress.cardPlayed) return "play-card";
  if (!progress.turnEnded) return "end-turn";
  if (!progress.attack) return "attack";
  return "complete";
}

export function trainingCommandAllowed(
  progress: TrainingProgress,
  commandType: BattleCommand["type"],
): boolean {
  if (commandType === "concede") return true;
  const stage = currentTrainingStage(progress);
  if (stage === "complete") return true;
  if (stage === "mulligan") return commandType === "mulligan";
  if (stage === "play-card") {
    return commandType === "play-card"
      || commandType === "use-coin"
      || commandType === "prepare-card"
      || commandType === "trade-card"
      || commandType === "choose-discover"
      || commandType === "choose-one";
  }
  if (stage === "end-turn") return commandType === "end-turn";
  return commandType === "attack" || commandType === "hero-attack";
}
