export const RETURN_QUEST_STAGE_IDS = ["reconnect", "rebuild", "battle"] as const;

export type ReturnQuestStageId = (typeof RETURN_QUEST_STAGE_IDS)[number];

export type ReturnJourneyState = {
  claimedStageIds: ReturnQuestStageId[];
  matchesPlayedAtActivation: number;
};

export type ReturnJourneyFacts = {
  activatedAt: string | null | undefined;
  decks: readonly { format?: string; updatedAt: string }[];
  matchesPlayed: number;
};

export const RETURN_QUEST_STAGES: readonly {
  id: ReturnQuestStageId;
  title: string;
  description: string;
}[] = Object.freeze([
  { id: "reconnect", title: "重启星图", description: "启动七日回归扶持" },
  { id: "rebuild", title: "重铸战术", description: "扶持启动后保存一套标准卡组" },
  { id: "battle", title: "重返战场", description: "扶持启动后完成一场对战" },
]);

export function returnQuestStageReady(
  stageId: ReturnQuestStageId,
  journey: ReturnJourneyState | null | undefined,
  facts: ReturnJourneyFacts,
): boolean {
  const stageIndex = RETURN_QUEST_STAGE_IDS.indexOf(stageId);
  if (stageIndex < 0) return false;
  if (RETURN_QUEST_STAGE_IDS.slice(0, stageIndex).some((id) => !journey?.claimedStageIds.includes(id))) {
    return false;
  }
  const activatedAt = facts.activatedAt ? Date.parse(facts.activatedAt) : Number.NaN;
  if (!Number.isFinite(activatedAt)) return false;
  if (stageId === "reconnect") return true;
  if (stageId === "rebuild") {
    return facts.decks.some((deck) =>
      deck.format === "standard" && timestampOnOrAfter(deck.updatedAt, activatedAt));
  }
  return facts.matchesPlayed > (journey?.matchesPlayedAtActivation ?? facts.matchesPlayed);
}

function timestampOnOrAfter(value: string, minimum: number): boolean {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp >= minimum;
}
