import { CARD_BY_ID, CARD_CATALOG } from "./catalog.ts";
import { cardAvailableInRankedFormat, rankedFormatLabel } from "./formats.ts";
import type {
  DeckRules,
  DeckValidationError,
  DeckValidationResult,
  Faction,
  RankedFormat,
} from "./types.ts";

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
      !cardAvailableInRankedFormat(card, format) &&
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
): DeckValidationResult {
  return validateDeck(cardIds, rules, format);
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
