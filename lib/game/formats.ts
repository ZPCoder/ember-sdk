import type { CardDefinition, CardSetId, RankedFormat } from "./types.ts";

export const RANKED_FORMATS: readonly RankedFormat[] = Object.freeze(["standard", "wild"]);

export const CARD_SET_DEFINITIONS: Readonly<Record<CardSetId, {
  id: CardSetId;
  label: string;
  year: number | null;
  standard: boolean;
}>> = Object.freeze({
  core: { id: "core", label: "核心系列", year: null, standard: true },
  "raptor-2025": { id: "raptor-2025", label: "猛禽年", year: 2025, standard: true },
  "scarab-2026": { id: "scarab-2026", label: "圣甲虫年", year: 2026, standard: true },
  "pegasus-2024": { id: "pegasus-2024", label: "飞马年", year: 2024, standard: false },
});

/**
 * Each faction ships fifty cards in catalog order. The first ten form the
 * evergreen Core set, the next thirty are the two current Standard years,
 * and ten cards are the rotated 2024 set retained by Wild. The generated
 * faction catalogs place their signature weapon last, so that slot remains
 * in the current year while ordinal 39 rotates in its place.
 */
export function cardSetForFactionOrdinal(ordinal: number): CardSetId {
  const safeOrdinal = Math.max(0, Math.floor(Number.isFinite(ordinal) ? ordinal : 0));
  if (safeOrdinal < 10) return "core";
  if (safeOrdinal < 25) return "raptor-2025";
  if (safeOrdinal < 39 || safeOrdinal === 49) return "scarab-2026";
  return "pegasus-2024";
}

export function rankedFormatLabel(format: RankedFormat): string {
  return format === "wild" ? "狂野" : "标准";
}

export function cardAvailableInRankedFormat(
  card: Pick<CardDefinition, "set">,
  format: RankedFormat,
): boolean {
  if (format === "wild") return true;
  return card.set !== undefined && CARD_SET_DEFINITIONS[card.set].standard;
}

export function rankedFormatCardCount(
  catalog: readonly Pick<CardDefinition, "set">[],
  format: RankedFormat,
): number {
  return catalog.filter((card) => cardAvailableInRankedFormat(card, format)).length;
}
