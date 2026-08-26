import { AI_ARCHETYPES } from "./ai-decks.ts";
import type { Faction } from "./types.ts";

export const LADDER_READY_TRIAL_DAYS = 7;
export const LADDER_READY_TRIAL_MS = LADDER_READY_TRIAL_DAYS * 24 * 60 * 60 * 1_000;

export type LadderReadyDeckId =
  | "radiance-aegis"
  | "ember-breakthrough"
  | "tide-lockdown"
  | "verdant-revival"
  | "storm-battery"
  | "astral-horizon";

export type LadderReadyDeck = {
  id: LadderReadyDeckId;
  name: string;
  faction: Faction;
  style: string;
  difficulty: "易上手" | "进阶";
  description: string;
  sourceArchetypeId: string;
  deck: readonly string[];
};

export type LadderReadyTrialSnapshot = {
  activatedAt: string | null;
  expiresAt: string | null;
  claimedDeckId: LadderReadyDeckId | null;
};

const LADDER_READY_SPECS: ReadonlyArray<{
  id: LadderReadyDeckId;
  sourceArchetypeId: string;
  name: string;
  style: string;
  difficulty: LadderReadyDeck["difficulty"];
}> = [
  { id: "radiance-aegis", sourceArchetypeId: "radiance-midrange", name: "棱镜守线", style: "护盾中速", difficulty: "易上手" },
  { id: "ember-breakthrough", sourceArchetypeId: "ember-rush", name: "熔线突破", style: "低费速攻", difficulty: "易上手" },
  { id: "tide-lockdown", sourceArchetypeId: "tide-control", name: "逆流封锁", style: "冻结控制", difficulty: "进阶" },
  { id: "verdant-revival", sourceArchetypeId: "verdant-rebirth", name: "根系复苏", style: "亡语铺场", difficulty: "易上手" },
  { id: "storm-battery", sourceArchetypeId: "storm-overload", name: "过载炮台", style: "法术节奏", difficulty: "进阶" },
  { id: "astral-horizon", sourceArchetypeId: "astral-value", name: "星穹视界", style: "发现增值", difficulty: "进阶" },
];

export const LADDER_READY_DECKS: readonly LadderReadyDeck[] = Object.freeze(
  LADDER_READY_SPECS.map((spec) => {
    const archetype = AI_ARCHETYPES.find((candidate) => candidate.id === spec.sourceArchetypeId);
    if (!archetype) throw new Error(`天梯预备套牌缺少原型：${spec.sourceArchetypeId}`);
    return Object.freeze({
      ...spec,
      faction: archetype.faction,
      description: archetype.description,
      deck: Object.freeze([...archetype.deck]),
    });
  }),
);

export function getLadderReadyDeck(id: string): LadderReadyDeck | undefined {
  return LADDER_READY_DECKS.find((deck) => deck.id === id);
}

export function ladderReadyDeckMatches(
  candidate: readonly string[],
  expected: readonly string[],
): boolean {
  if (candidate.length !== expected.length) return false;
  const counts = new Map<string, number>();
  for (const cardId of expected) counts.set(cardId, (counts.get(cardId) ?? 0) + 1);
  for (const cardId of candidate) {
    const count = counts.get(cardId);
    if (!count) return false;
    if (count === 1) counts.delete(cardId);
    else counts.set(cardId, count - 1);
  }
  return counts.size === 0;
}

export function ladderReadyTrialIsActive(
  state: LadderReadyTrialSnapshot | null | undefined,
  now = Date.now(),
): boolean {
  if (!state?.activatedAt || !state.expiresAt || state.claimedDeckId !== null) return false;
  const activatedAt = Date.parse(state.activatedAt);
  const expiresAt = Date.parse(state.expiresAt);
  return Number.isFinite(activatedAt)
    && Number.isFinite(expiresAt)
    && expiresAt > activatedAt
    && expiresAt > now;
}
