import { AI_ARCHETYPES, buildAiArchetypeDeck } from "./ai-decks.js";
import type { Faction } from "./types.js";

export const LADDER_READY_TRIAL_DAYS = 7;
export const LADDER_READY_TRIAL_MS = LADDER_READY_TRIAL_DAYS * 24 * 60 * 60 * 1_000;
/** Project-economy price for each non-free deck after the first claim. */
export const LADDER_READY_DECK_PRICE_GOLD = 1_000;
export const LADDER_READY_RETURN_DAYS = 90;
export const LADDER_READY_RETURN_MS = LADDER_READY_RETURN_DAYS * 24 * 60 * 60 * 1_000;

export type LadderReadyDeckId =
  | "radiance-aegis"
  | "ember-breakthrough"
  | "tide-lockdown"
  | "verdant-revival"
  | "storm-battery"
  | "astral-horizon";

export type LadderReadyCatalogVersionId =
  | "scarab-cataclysm"
  | "scarab-jailbreak"
  | "scarab-third";

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

export type LadderReadyCatalog = {
  id: LadderReadyCatalogVersionId;
  label: string;
  availableFrom: string;
  decks: readonly LadderReadyDeck[];
};

export type LadderReadyTrialSnapshot = {
  activatedAt: string | null;
  expiresAt: string | null;
  claimedDeckId: LadderReadyDeckId | null;
  catalogVersionId?: LadderReadyCatalogVersionId | null;
  purchasedDeckIds?: readonly LadderReadyDeckId[];
  cycle?: number;
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

const LADDER_READY_CATALOG_SPECS: ReadonlyArray<{
  id: LadderReadyCatalogVersionId;
  label: string;
  availableFrom: string;
}> = [
  { id: "scarab-cataclysm", label: "圣甲虫年 · 灾变", availableFrom: "2026-03-17T17:00:00.000Z" },
  { id: "scarab-jailbreak", label: "圣甲虫年 · 越狱行动", availableFrom: "2026-07-07T17:00:00.000Z" },
  { id: "scarab-third", label: "圣甲虫年 · 第三扩展", availableFrom: "2026-10-01T00:00:00.000Z" },
];

function buildCatalog(spec: (typeof LADDER_READY_CATALOG_SPECS)[number]): LadderReadyCatalog {
  const decks = LADDER_READY_SPECS.map((deckSpec) => {
    const archetype = AI_ARCHETYPES.find((candidate) => candidate.id === deckSpec.sourceArchetypeId);
    if (!archetype) throw new Error(`天梯预备套牌缺少原型：${deckSpec.sourceArchetypeId}`);
    return Object.freeze({
      ...deckSpec,
      faction: archetype.faction,
      description: archetype.description,
      deck: buildAiArchetypeDeck(archetype.faction, undefined, "standard", spec.availableFrom),
    });
  });
  return Object.freeze({ ...spec, decks: Object.freeze(decks) });
}

/** Immutable recipes for every major Standard content window. */
export const LADDER_READY_CATALOGS: readonly LadderReadyCatalog[] = Object.freeze(
  LADDER_READY_CATALOG_SPECS.map(buildCatalog),
);

function timestamp(value: Date | string | number): number {
  const result = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(result) ? result : Date.now();
}

export function getLadderReadyCatalog(id: string | null | undefined): LadderReadyCatalog | undefined {
  return LADDER_READY_CATALOGS.find((catalog) => catalog.id === id);
}

export function ladderReadyCatalogAt(at: Date | string | number = new Date()): LadderReadyCatalog {
  const atMs = timestamp(at);
  return [...LADDER_READY_CATALOGS]
    .reverse()
    .find((catalog) => Date.parse(catalog.availableFrom) <= atMs)
    ?? LADDER_READY_CATALOGS[0]!;
}

/**
 * Resolve the catalog permanently bound when the seven-day armory starts.
 * Legacy saves infer it from activatedAt, so a later content release never
 * changes the six recipes beneath an active trial or a completed claim.
 */
export function ladderReadyCatalogForTrial(
  state: LadderReadyTrialSnapshot | null | undefined,
  at: Date | string | number = new Date(),
): LadderReadyCatalog {
  return getLadderReadyCatalog(state?.catalogVersionId)
    ?? ladderReadyCatalogAt(state?.activatedAt ?? at);
}

export function ladderReadyDecksForTrial(
  state: LadderReadyTrialSnapshot | null | undefined,
  at: Date | string | number = new Date(),
): readonly LadderReadyDeck[] {
  return ladderReadyCatalogForTrial(state, at).decks;
}

/** Current unactivated offer pool. Existing trials must use ladderReadyDecksForTrial. */
export const LADDER_READY_DECKS: readonly LadderReadyDeck[] = ladderReadyCatalogAt().decks;

export function getLadderReadyDeck(
  id: string,
  catalogVersionId?: string | null,
  at: Date | string | number = new Date(),
): LadderReadyDeck | undefined {
  const catalog = getLadderReadyCatalog(catalogVersionId) ?? ladderReadyCatalogAt(at);
  return catalog.decks.find((deck) => deck.id === id);
}

export function normalizePurchasedLadderReadyDeckIds(
  value: unknown,
  claimedDeckId: LadderReadyDeckId | null = null,
): LadderReadyDeckId[] {
  if (!Array.isArray(value)) return [];
  const validIds = new Set(LADDER_READY_SPECS.map((spec) => spec.id));
  return [...new Set(value.filter(
    (id): id is LadderReadyDeckId => typeof id === "string" && validIds.has(id as LadderReadyDeckId) && id !== claimedDeckId,
  ))];
}

export function ladderReadyReturningPlayerIsEligible(
  lastActiveAt: Date | string | number,
  now: Date | string | number = new Date(),
): boolean {
  const lastActiveMs = timestamp(lastActiveAt);
  const nowMs = timestamp(now);
  return nowMs >= lastActiveMs && nowMs - lastActiveMs >= LADDER_READY_RETURN_MS;
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
