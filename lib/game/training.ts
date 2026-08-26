import { DEFAULT_STARTER_DECK } from "./catalog.ts";
import type { BattleCommand } from "./types.ts";

export type TrainingProgress = {
  mulligan: boolean;
  cardPlayed: boolean;
  attack: boolean;
  turnEnded: boolean;
};

export type TrainingStage = "mulligan" | "play-card" | "end-turn" | "attack" | "complete";

export type TrainingDialogue = {
  speaker: string;
  role: "mentor" | "opponent";
  line: string;
};

export const TRAINING_DECK_ID = "training:starter";
export const TRAINING_MATCH_SEED = 0x1a57_2026;
export const TRAINING_STARTING_PLAYER = 0 as const;
export const TRAINING_OPPONENT_ARCHETYPE_ID = "radiance-midrange";
export const TRAINING_PLAYER_DECK: readonly string[] = DEFAULT_STARTER_DECK;
export const TRAINING_PLAY_CARD_ID = "sun-dawn-scout";
export const TRAINING_DIALOGUE_BY_STAGE: Readonly<Record<TrainingStage, TrainingDialogue>> = Object.freeze({
  mulligan: {
    speaker: "战术教官 · 伊蕾",
    role: "mentor",
    line: "雾门正在闭合。别改动我为你校准的起手——先确认链路。",
  },
  "play-card": {
    speaker: "战术教官 · 伊蕾",
    role: "mentor",
    line: "很好。让晨辉斥候先越过雾门，第一束光会为整条战线定向。",
  },
  "end-turn": {
    speaker: "棱镜演算体",
    role: "opponent",
    line: "微弱的先遣信号已经捕获。结束行动，我会展开棱镜防线。",
  },
  attack: {
    speaker: "战术教官 · 伊蕾",
    role: "mentor",
    line: "别被护盾诱导。选中斥候，越过守卫，直接标记敌方核心。",
  },
  complete: {
    speaker: "棱镜演算体",
    role: "opponent",
    line: "核心轨迹已暴露。基础演算完成——接下来的每一步由你决定。",
  },
});

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

export function trainingGateProgressForFacts(
  previous: TrainingProgress,
  facts: {
    status: "mulligan" | "playing" | "discover" | "choose-one" | "game-over";
    cardsPlayed: number;
    attacks: number;
    log: readonly string[];
  },
): TrainingProgress {
  const cumulative = trainingProgressForFacts(previous, facts);
  if (currentTrainingStage(cumulative) === "complete") return cumulative;
  return trainingProgressForFacts(EMPTY_TRAINING_PROGRESS, facts);
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
  command: BattleCommand,
): boolean {
  if (command.type === "concede") return true;
  const stage = currentTrainingStage(progress);
  if (stage === "complete") return true;
  if (stage === "mulligan") {
    return command.type === "mulligan" && command.cardIndexes.length === 0;
  }
  if (stage === "play-card") {
    return command.type === "play-card"
      && command.cardId === TRAINING_PLAY_CARD_ID
      && command.placement !== "enemy";
  }
  if (stage === "end-turn") return command.type === "end-turn";
  return command.type === "attack"
    && command.target.kind === "hero"
    && command.target.player === 1;
}
