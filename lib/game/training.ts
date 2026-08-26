export type TrainingProgress = {
  mulligan: boolean;
  cardPlayed: boolean;
  attack: boolean;
  turnEnded: boolean;
};

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
