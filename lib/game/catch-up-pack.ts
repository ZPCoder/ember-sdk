import { CARD_CATALOG } from "./catalog.ts";
import { CARD_SET_DEFINITIONS } from "./formats.ts";
import type { CardDefinition, CardSetId } from "./types.ts";

export const CATCH_UP_PACK_MIN_CARDS = 5;
export const CATCH_UP_PACK_MAX_CARDS = 50;
export const CATCH_UP_PACK_RARE_FLOOR = 0.2;
export const CATCH_UP_LEGENDARY_GUARANTEE_CARDS = 50;
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

export type CatchUpPackProgress = {
  cardsSeenBySet: Partial<Record<CardSetId, number>>;
  legendarySeenSets: CardSetId[];
};

export type CatchUpPackReward = {
  cards: string[];
  progress: CatchUpPackProgress;
  guaranteedLegendarySets: CardSetId[];
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

/**
 * Generates a pack while carrying the per-expansion first-Legendary ledger.
 * A batch that reaches card 50 for a set is repaired inside the eligible
 * prefix, so the guarantee cannot accidentally land after the cutoff.
 */
export function generateCatchUpPackReward(
  collection: Readonly<Record<string, number>>,
  seed: number,
  progress: CatchUpPackProgress,
): CatchUpPackReward {
  const cards = generateCatchUpPack(collection, seed);
  const guaranteedLegendarySets: CardSetId[] = [];
  const legendarySeen = new Set(progress.legendarySeenSets);

  for (const set of CATCH_UP_PACK_SETS) {
    if (legendarySeen.has(set)) continue;
    const seenBefore = Math.max(0, Math.floor(progress.cardsSeenBySet[set] ?? 0));
    const setIndexes = cards.flatMap((cardId, index) => CARD_BY_ID.get(cardId)?.set === set ? [index] : []);
    // Older state or a non-pack acquisition can arrive with the counter at
    // the boundary but no recorded Legendary. Repair that overdue guarantee
    // in the first slot of the next Catch-Up reward instead of losing it.
    const eligibleCount = seenBefore >= CATCH_UP_LEGENDARY_GUARANTEE_CARDS
      ? Math.min(1, setIndexes.length)
      : Math.min(setIndexes.length, CATCH_UP_LEGENDARY_GUARANTEE_CARDS - seenBefore);
    const eligibleIndexes = setIndexes.slice(0, eligibleCount);
    const legendaryIndex = eligibleIndexes.find((index) => CARD_BY_ID.get(cards[index]!)?.rarity === "传说");
    if (legendaryIndex !== undefined) {
      legendarySeen.add(set);
      continue;
    }
    if (
      (seenBefore < CATCH_UP_LEGENDARY_GUARANTEE_CARDS
      && seenBefore + setIndexes.length < CATCH_UP_LEGENDARY_GUARANTEE_CARDS)
      || eligibleIndexes.length === 0
    ) continue;

    const resultCounts = new Map<string, number>();
    cards.forEach((cardId) => resultCounts.set(cardId, (resultCounts.get(cardId) ?? 0) + 1));
    const setLegendaries = catchUpCollectibleCards().filter((card) => card.set === set && card.rarity === "传说");
    const missingPool = setLegendaries.filter((card) =>
      normalizeOwnedCopies(collection[card.id], 1) + (resultCounts.get(card.id) ?? 0) < 1);
    const pool = missingPool.length > 0 ? missingPool : setLegendaries;
    if (pool.length === 0) continue;
    const random = nextRandom((seed ^ stableSetSeed(set)) >>> 0 || 0x9e3779b9);
    const replacement = pool[Math.min(pool.length - 1, Math.floor(random.value * pool.length))]!;
    const replaceable = eligibleIndexes.filter((index) => CARD_BY_ID.get(cards[index]!)?.rarity !== "传说");
    const replacementIndex = replaceable[Math.min(replaceable.length - 1, Math.floor(nextRandom(random.state).value * replaceable.length))];
    if (replacementIndex === undefined) continue;
    cards[replacementIndex] = replacement.id;
    guaranteedLegendarySets.push(set);
    legendarySeen.add(set);
  }

  return {
    cards,
    progress: recordCatchUpCards(progress, cards),
    guaranteedLegendarySets,
  };
}

export function catchUpProgressFromCollection(
  collection: Readonly<Record<string, number>>,
): CatchUpPackProgress {
  const progress: CatchUpPackProgress = { cardsSeenBySet: {}, legendarySeenSets: [] };
  const cards: string[] = [];
  for (const card of catchUpCollectibleCards()) {
    const copies = normalizeOwnedCopies(collection[card.id], collectibleCopyLimit(card.rarity));
    for (let index = 0; index < copies; index += 1) cards.push(card.id);
  }
  return recordCatchUpCards(progress, cards);
}

export function recordCatchUpCards(
  progress: CatchUpPackProgress,
  cardIds: readonly string[],
): CatchUpPackProgress {
  const cardsSeenBySet = { ...progress.cardsSeenBySet };
  const legendarySeenSets = new Set(progress.legendarySeenSets.filter((set) => CATCH_UP_PACK_SETS.includes(set)));
  for (const cardId of cardIds) {
    const card = CARD_BY_ID.get(cardId);
    if (!card?.set || !CATCH_UP_PACK_SETS.includes(card.set)) continue;
    cardsSeenBySet[card.set] = Math.max(0, Math.floor(cardsSeenBySet[card.set] ?? 0)) + 1;
    if (card.rarity === "传说") legendarySeenSets.add(card.set);
  }
  return { cardsSeenBySet, legendarySeenSets: CATCH_UP_PACK_SETS.filter((set) => legendarySeenSets.has(set)) };
}

function catchUpCollectibleCards(): CardDefinition[] {
  return CARD_CATALOG.filter((card) =>
    card.collectible !== false && card.set !== undefined && CATCH_UP_PACK_SETS.includes(card.set));
}

const CARD_BY_ID = new Map(CARD_CATALOG.map((card) => [card.id, card]));

function stableSetSeed(set: CardSetId): number {
  let hash = 2_166_136_261;
  for (const character of set) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
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
