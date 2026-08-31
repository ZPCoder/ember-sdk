import { CARD_BY_ID, CARD_CATALOG } from "./catalog.js";
import { decodeDeckCode } from "./deck-code.js";
import { cardAvailableInRankedFormat, rankedFormatLabel } from "./formats.js";
import type {
  CardDefinition,
  DeckRules,
  DeckValidationError,
  DeckValidationResult,
  Faction,
  RankedFormat,
} from "./types.js";

export const DEFAULT_DECK_RULES: Readonly<DeckRules> = Object.freeze({
  size: 30,
  maxCopies: 2,
  maxLegendaryCopies: 1,
});

/** Hearthstone exposes twenty-seven constructed deck slots per account. */
export const MAX_SAVED_DECKS = 27;

export type MissingDeckCard = {
  cardId: string;
  required: number;
  owned: number;
  missing: number;
};

export type DeckCodePreview = {
  code: string;
  version: 1 | 2;
  format: RankedFormat;
  name: string;
  cardIds: string[];
};

export type DeckCompletionResult = {
  cardIds: string[];
  addedCardIds: string[];
  faction: Faction | null;
};

const SMART_CURVE_TARGETS = [2, 5, 6, 5, 4, 3, 3, 2] as const;
const SMART_TYPE_TARGETS: Readonly<Record<CardDefinition["type"], number>> = {
  unit: 18,
  spell: 10,
  weapon: 2,
  hero: 1,
  location: 1,
};

function smartCurveBucket(cost: number): number {
  return Math.min(7, Math.max(0, Math.floor(cost)));
}

export function completeDeckFromCollection({
  cardIds,
  collection,
  format,
  catalog = CARD_CATALOG,
}: {
  cardIds: readonly string[];
  collection: Readonly<Record<string, number>>;
  format: RankedFormat;
  catalog?: readonly CardDefinition[];
}): DeckCompletionResult {
  const original = [...cardIds];
  const byId = new Map(catalog.map((card) => [card.id, card]));
  const counts = new Map<string, number>();
  const factions = new Set<Faction>();

  if (original.length > DEFAULT_DECK_RULES.size) {
    return { cardIds: original, addedCardIds: [], faction: null };
  }
  for (const cardId of original) {
    const card = byId.get(cardId);
    if (!card || !cardAvailableInRankedFormat(card, format)) {
      return { cardIds: original, addedCardIds: [], faction: null };
    }
    const nextCount = (counts.get(cardId) ?? 0) + 1;
    const copyLimit = card.rarity === "传说" ? 1 : 2;
    const owned = Math.max(0, Math.floor(collection[cardId] ?? 0));
    if (nextCount > Math.min(copyLimit, owned)) {
      return { cardIds: original, addedCardIds: [], faction: null };
    }
    counts.set(cardId, nextCount);
    if (card.faction !== "中立") factions.add(card.faction);
  }
  if (factions.size > 1) {
    return { cardIds: original, addedCardIds: [], faction: null };
  }

  let faction = factions.values().next().value ?? null;
  if (!faction) {
    const factionCapacity = new Map<Faction, number>();
    for (const card of catalog) {
      if (
        card.faction === "中立" ||
        !cardAvailableInRankedFormat(card, format)
      ) {
        continue;
      }
      const copyLimit = card.rarity === "传说" ? 1 : 2;
      const owned = Math.max(0, Math.floor(collection[card.id] ?? 0));
      factionCapacity.set(
        card.faction,
        (factionCapacity.get(card.faction) ?? 0) + Math.min(copyLimit, owned),
      );
    }
    let bestCapacity = 0;
    for (const [candidateFaction, capacity] of factionCapacity) {
      if (capacity > bestCapacity) {
        faction = candidateFaction;
        bestCapacity = capacity;
      }
    }
  }

  const completed = [...original];
  const addedCardIds: string[] = [];
  const curveCounts = Array.from({ length: 8 }, () => 0);
  const typeCounts: Record<CardDefinition["type"], number> = {
    unit: 0,
    spell: 0,
    weapon: 0,
    hero: 0,
    location: 0,
  };
  const keywordCounts = new Map<string, number>();
  const traitCounts = new Map<string, number>();

  const registerCard = (card: CardDefinition) => {
    curveCounts[smartCurveBucket(card.cost)] += 1;
    typeCounts[card.type] += 1;
    for (const keyword of card.keywords ?? []) {
      keywordCounts.set(keyword, (keywordCounts.get(keyword) ?? 0) + 1);
    }
    for (const trait of card.traits ?? []) {
      traitCounts.set(trait, (traitCounts.get(trait) ?? 0) + 1);
    }
  };
  for (const cardId of completed) registerCard(byId.get(cardId)!);

  while (completed.length < DEFAULT_DECK_RULES.size) {
    let best: { card: CardDefinition; score: number } | null = null;
    for (const card of catalog) {
      if (
        !cardAvailableInRankedFormat(card, format) ||
        (card.faction !== "中立" && card.faction !== faction)
      ) {
        continue;
      }
      const currentCopies = counts.get(card.id) ?? 0;
      const copyLimit = card.rarity === "传说" ? 1 : 2;
      const owned = Math.max(0, Math.floor(collection[card.id] ?? 0));
      if (currentCopies >= Math.min(copyLimit, owned)) continue;

      const bucket = smartCurveBucket(card.cost);
      const curveNeed = SMART_CURVE_TARGETS[bucket] - curveCounts[bucket];
      const typeNeed = SMART_TYPE_TARGETS[card.type] - typeCounts[card.type];
      const keywordSynergy = (card.keywords ?? []).reduce(
        (score, keyword) => score + Math.min(4, keywordCounts.get(keyword) ?? 0),
        0,
      );
      const traitSynergy = (card.traits ?? []).reduce(
        (score, trait) => score + Math.min(4, traitCounts.get(trait) ?? 0),
        0,
      );
      const score =
        curveNeed * 22 +
        typeNeed * 6 +
        keywordSynergy * 8 +
        traitSynergy * 10 +
        (currentCopies > 0 ? 14 : 0) +
        (card.faction === faction ? 4 : 0);
      if (
        !best ||
        score > best.score ||
        (score === best.score &&
          (card.cost < best.card.cost ||
            (card.cost === best.card.cost && card.id < best.card.id)))
      ) {
        best = { card, score };
      }
    }
    if (!best) break;
    completed.push(best.card.id);
    addedCardIds.push(best.card.id);
    counts.set(best.card.id, (counts.get(best.card.id) ?? 0) + 1);
    registerCard(best.card);
  }

  return { cardIds: completed, addedCardIds, faction };
}

export function previewDeckCode(
  value: string,
  fallbackFormat: RankedFormat,
): DeckCodePreview | null {
  try {
    const code = value.trim();
    const decoded = decodeDeckCode(code);
    const format = decoded.format ?? fallbackFormat;
    if (!validateDeckForFormat(decoded.cardIds, format).valid) return null;
    return {
      code,
      version: decoded.version,
      format,
      name: decoded.name ?? "导入牌组",
      cardIds: [...decoded.cardIds],
    };
  } catch {
    return null;
  }
}

export function findMissingDeckCards(
  cardIds: readonly string[],
  collection: Readonly<Record<string, number>>,
): MissingDeckCard[] {
  const required = new Map<string, number>();
  for (const cardId of cardIds) {
    required.set(cardId, (required.get(cardId) ?? 0) + 1);
  }
  return [...required.entries()].flatMap(([cardId, count]) => {
    const owned = Math.max(0, Math.floor(collection[cardId] ?? 0));
    return owned < count
      ? [{ cardId, required: count, owned, missing: count - owned }]
      : [];
  });
}

export function removeSavedDeck<T extends { id: string }>(
  decks: readonly T[],
  activeDeckId: string | null,
  deckId: string,
): { decks: T[]; activeDeckId: string | null } | null {
  if (!decks.some((deck) => deck.id === deckId)) return null;
  const remaining = decks.filter((deck) => deck.id !== deckId);
  const activeStillExists = remaining.some(
    (deck) => deck.id === activeDeckId,
  );
  return {
    decks: remaining,
    activeDeckId: activeStillExists
      ? activeDeckId
      : (remaining[0]?.id ?? null),
  };
}

export function validateDeck(
  cardIds: readonly string[],
  rules: DeckRules = DEFAULT_DECK_RULES,
  format?: RankedFormat,
  at: Date | string | number = new Date(),
): DeckValidationResult {
  const errors: DeckValidationError[] = [];

  if (cardIds.length !== rules.size) {
    errors.push({
      code: "wrong-size",
      message: `牌组必须正好包含 ${rules.size} 张卡牌，当前为 ${cardIds.length} 张。`,
    });
  }

  const copies = new Map<string, number>();
  const factions = new Set<Faction>();

  for (const cardId of cardIds) {
    const card = CARD_BY_ID[cardId];
    copies.set(cardId, (copies.get(cardId) ?? 0) + 1);

    if (!card) {
      if (!errors.some((error) => error.code === "unknown-card" && error.cardId === cardId)) {
        errors.push({
          code: "unknown-card",
          cardId,
          message: `未知卡牌：${cardId}。`,
        });
      }
      continue;
    }

    if (card.faction !== "中立") {
      factions.add(card.faction);
    }
    if (
      format &&
      !cardAvailableInRankedFormat(card, format, at) &&
      !errors.some((error) => error.code === "format-ineligible" && error.cardId === cardId)
    ) {
      errors.push({
        code: "format-ineligible",
        cardId,
        message: `${card.name} 已轮换出${rankedFormatLabel(format)}模式。`,
      });
    }
  }

  for (const [cardId, count] of copies) {
    const card = CARD_BY_ID[cardId];
    if (!card) {
      continue;
    }

    const limit =
      card.rarity === "传说"
        ? rules.maxLegendaryCopies
        : rules.maxCopies;
    if (count > limit) {
      errors.push({
        code: "too-many-copies",
        cardId,
        message: `${card.name} 最多可携带 ${limit} 张，当前为 ${count} 张。`,
      });
    }
  }

  if (factions.size > 1) {
    errors.push({
      code: "mixed-factions",
      message: "牌组不能混合两个非中立阵营。",
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    faction: factions.size === 1 ? [...factions][0] : null,
  };
}

export function validateDeckForFormat(
  cardIds: readonly string[],
  format: RankedFormat,
  rules: DeckRules = DEFAULT_DECK_RULES,
  at: Date | string | number = new Date(),
): DeckValidationResult {
  return validateDeck(cardIds, rules, format, at);
}

export function suggestDeckReplacements({
  cardIds,
  missingCardId,
  collection,
  format,
  limit = 3,
}: {
  cardIds: readonly string[];
  missingCardId: string;
  collection: Readonly<Record<string, number>>;
  format: RankedFormat;
  limit?: number;
}): string[] {
  const target = CARD_BY_ID[missingCardId];
  const targetIndex = cardIds.lastIndexOf(missingCardId);
  if (!target || targetIndex < 0 || limit <= 0) return [];

  const counts = new Map<string, number>();
  for (const cardId of cardIds) {
    counts.set(cardId, (counts.get(cardId) ?? 0) + 1);
  }
  const targetKeywords = new Set(target.keywords ?? []);
  const targetTraits = new Set(target.traits ?? []);

  return CARD_CATALOG.flatMap((candidate) => {
    if (
      candidate.id === missingCardId ||
      !cardAvailableInRankedFormat(candidate, format)
    ) {
      return [];
    }
    const currentCopies = counts.get(candidate.id) ?? 0;
    const ownedCopies = Math.max(0, Math.floor(collection[candidate.id] ?? 0));
    const copyLimit = candidate.rarity === "传说" ? 1 : 2;
    if (currentCopies >= Math.min(copyLimit, ownedCopies)) return [];

    const replaced = [...cardIds];
    replaced[targetIndex] = candidate.id;
    if (!validateDeckForFormat(replaced, format).valid) return [];

    const sharedKeywords = (candidate.keywords ?? []).filter((keyword) =>
      targetKeywords.has(keyword)
    ).length;
    const sharedTraits = (candidate.traits ?? []).filter((trait) =>
      targetTraits.has(trait)
    ).length;
    const score =
      160 - Math.abs(candidate.cost - target.cost) * 18 +
      (candidate.type === target.type ? 46 : 0) +
      (candidate.faction === target.faction ? 20 : 0) +
      (candidate.rarity === target.rarity ? 6 : 0) +
      sharedKeywords * 12 +
      sharedTraits * 10;
    return [{ id: candidate.id, score, cost: candidate.cost }];
  })
    .sort((left, right) =>
      right.score - left.score || left.cost - right.cost || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
    )
    .slice(0, limit)
    .map((candidate) => candidate.id);
}
