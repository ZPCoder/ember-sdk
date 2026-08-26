import { CARD_BY_ID } from "./catalog.ts";
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
