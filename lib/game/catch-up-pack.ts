import { CARD_CATALOG } from "./catalog.ts";

export const CATCH_UP_PACK_MIN_CARDS = 5;
export const CATCH_UP_PACK_MAX_CARDS = 50;

export type CatchUpPackPreview = {
  cardCount: number;
  collectionCompletion: number;
  missingCopies: number;
  totalCopies: number;
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
  const collectible = CARD_CATALOG.filter((card) => card.collectible !== false);
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
  return { cardCount, collectionCompletion, missingCopies, totalCopies };
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
  const collectible = CARD_CATALOG.filter((card) => card.collectible !== false);
  const missingPool = collectible.flatMap((card) => {
    const limit = collectibleCopyLimit(card.rarity);
    const missing = limit - normalizeOwnedCopies(collection[card.id], limit);
    return Array.from({ length: Math.max(0, missing) }, () => card.id);
  });
  const fallbackPool = collectible.map((card) => card.id);
  const result: string[] = [];
  let rngState = seed >>> 0 || 0x9e3779b9;
  while (result.length < preview.cardCount) {
    const pool = missingPool.length > 0 ? missingPool : fallbackPool;
    if (pool.length === 0) break;
    const random = nextRandom(rngState);
    rngState = random.state;
    const index = Math.min(pool.length - 1, Math.floor(random.value * pool.length));
    result.push(pool[index]!);
    if (pool === missingPool) missingPool.splice(index, 1);
  }
  return result;
}
