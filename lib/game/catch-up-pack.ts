import { CARD_CATALOG } from "./catalog.ts";
import { CARD_SET_DEFINITIONS } from "./formats.ts";
import type { CardDefinition, CardSetId } from "./types.ts";

export const CATCH_UP_PACK_MIN_CARDS = 5;
export const CATCH_UP_PACK_MAX_CARDS = 50;
export const CATCH_UP_PACK_RARE_FLOOR = 0.2;
export const CATCH_UP_PACK_SETS: readonly CardSetId[] = Object.freeze(
  Object.values(CARD_SET_DEFINITIONS)
    .filter((set) => set.standard && set.id !== "core")
    .map((set) => set.id),
);

export type CatchUpPackPreview = {
  cardCount: number;
  collectionCompletion: number;
  missingCopies: number;
  totalCopies: number;
  setCardCounts: Readonly<Partial<Record<CardSetId, number>>>;
};

function collectibleCopyLimit(rarity: string): number {
  return rarity === "传说" ? 1 : 2;
}

function normalizeOwnedCopies(value: unknown, limit: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(limit, Math.floor(value)))
    : 0;
}

export function previewCatchUpPack(
  collection: Readonly<Record<string, number>>,
): CatchUpPackPreview {
  const collectible = catchUpCollectibleCards();
  let ownedCopies = 0;
  let totalCopies = 0;
  for (const card of collectible) {
    const limit = collectibleCopyLimit(card.rarity);
    totalCopies += limit;
    ownedCopies += normalizeOwnedCopies(collection[card.id], limit);
  }
  const missingCopies = Math.max(0, totalCopies - ownedCopies);
  const collectionCompletion = totalCopies > 0 ? ownedCopies / totalCopies : 1;
  const cardCount = Math.max(
    CATCH_UP_PACK_MIN_CARDS,
    Math.min(
      CATCH_UP_PACK_MAX_CARDS,
      Math.ceil(CATCH_UP_PACK_MAX_CARDS
        - (CATCH_UP_PACK_MAX_CARDS - CATCH_UP_PACK_MIN_CARDS) * collectionCompletion),
    ),
  );
  return {
    cardCount,
    collectionCompletion,
    missingCopies,
    totalCopies,
    setCardCounts: allocateSetCardCounts(collection, cardCount),
  };
}

function nextRandom(state: number): { state: number; value: number } {
  const next = (Math.imul(state >>> 0, 1_664_525) + 1_013_904_223) >>> 0;
  return { state: next, value: next / 0x1_0000_0000 };
}

/**
 * Builds one deterministic catch-up pack. Missing legal copies are exhausted
 * before ordinary duplicate protection can yield additional copies.
 */
export function generateCatchUpPack(
  collection: Readonly<Record<string, number>>,
  seed: number,
): string[] {
  const preview = previewCatchUpPack(collection);
  const collectible = catchUpCollectibleCards();
  const cardsById = new Map(collectible.map((card) => [card.id, card]));
  const result: string[] = [];
  let rngState = seed >>> 0 || 0x9e3779b9;
  const remainingMissingBySet = new Map<CardSetId, string[]>();

  for (const set of CATCH_UP_PACK_SETS) {
    const setCards = collectible.filter((card) => card.set === set);
    const missingPool = setCards.flatMap((card) => {
      const limit = collectibleCopyLimit(card.rarity);
      const missing = limit - normalizeOwnedCopies(collection[card.id], limit);
      return Array.from({ length: Math.max(0, missing) }, () => card.id);
    });
    const fallbackPool = setCards.map((card) => card.id);
    const count = preview.setCardCounts[set] ?? 0;
    for (let index = 0; index < count; index += 1) {
      const pool = missingPool.length > 0 ? missingPool : fallbackPool;
      if (pool.length === 0) break;
      const drawn = drawFromPool(pool, rngState);
      rngState = drawn.state;
      result.push(drawn.cardId);
      if (pool === missingPool) missingPool.splice(drawn.index, 1);
    }
    remainingMissingBySet.set(set, missingPool);
  }

  const rareTarget = Math.ceil(result.length * CATCH_UP_PACK_RARE_FLOOR);
  let rareCount = result.filter((cardId) => isRareOrBetter(cardsById.get(cardId))).length;
  for (let index = 0; index < result.length && rareCount < rareTarget; index += 1) {
    const current = cardsById.get(result[index]!);
    if (!current || isRareOrBetter(current) || !current.set) continue;
    const missingRarePool = (remainingMissingBySet.get(current.set) ?? [])
      .filter((cardId) => isRareOrBetter(cardsById.get(cardId)));
    const fallbackRarePool = collectible
      .filter((card) => card.set === current.set && isRareOrBetter(card))
      .map((card) => card.id);
    const pool = missingRarePool.length > 0 ? missingRarePool : fallbackRarePool;
    if (pool.length === 0) continue;
    const drawn = drawFromPool(pool, rngState);
    rngState = drawn.state;
    result[index] = drawn.cardId;
    rareCount += 1;
    if (missingRarePool.length > 0) {
      const source = remainingMissingBySet.get(current.set)!;
      source.splice(source.indexOf(drawn.cardId), 1);
    }
  }
  return result;
}

function catchUpCollectibleCards(): CardDefinition[] {
  return CARD_CATALOG.filter((card) =>
    card.collectible !== false && card.set !== undefined && CATCH_UP_PACK_SETS.includes(card.set));
}

function isRareOrBetter(card: Pick<CardDefinition, "rarity"> | undefined): boolean {
  return Boolean(card && card.rarity !== "普通");
}

function drawFromPool(pool: readonly string[], state: number): { cardId: string; index: number; state: number } {
  const random = nextRandom(state);
  const index = Math.min(pool.length - 1, Math.floor(random.value * pool.length));
  return { cardId: pool[index]!, index, state: random.state };
}

function allocateSetCardCounts(
  collection: Readonly<Record<string, number>>,
  cardCount: number,
): Partial<Record<CardSetId, number>> {
  const counts: Partial<Record<CardSetId, number>> = {};
  const completions = CATCH_UP_PACK_SETS.map((set) => {
    const cards = catchUpCollectibleCards().filter((card) => card.set === set);
    const total = cards.reduce((sum, card) => sum + collectibleCopyLimit(card.rarity), 0);
    const owned = cards.reduce((sum, card) => {
      const limit = collectibleCopyLimit(card.rarity);
      return sum + normalizeOwnedCopies(collection[card.id], limit);
    }, 0);
    return { set, weight: Math.max(0.01, 1 - (total > 0 ? owned / total : 1)) };
  });
  for (const entry of completions) counts[entry.set] = cardCount > 0 ? 1 : 0;
  let remaining = Math.max(0, cardCount - completions.length);
  const totalWeight = completions.reduce((sum, entry) => sum + entry.weight, 0);
  while (remaining > 0) {
    const next = [...completions].sort((left, right) => {
      const leftDeficit = left.weight / totalWeight * cardCount - (counts[left.set] ?? 0);
      const rightDeficit = right.weight / totalWeight * cardCount - (counts[right.set] ?? 0);
      return rightDeficit - leftDeficit || left.set.localeCompare(right.set, "en");
    })[0];
    if (!next) break;
    counts[next.set] = (counts[next.set] ?? 0) + 1;
    remaining -= 1;
  }
  return counts;
}
