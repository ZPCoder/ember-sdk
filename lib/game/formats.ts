import type { CardDefinition, CardReleaseWave, CardSetId, RankedFormat } from "./types.ts";

export const RANKED_FORMATS: readonly RankedFormat[] = Object.freeze(["standard", "wild"]);

export const CARD_SET_DEFINITIONS: Readonly<Record<CardSetId, {
  id: CardSetId;
  label: string;
  year: number | null;
  releases: readonly {
    wave: CardReleaseWave;
    label: string;
    availableFrom: string;
  }[];
}>> = Object.freeze({
  core: { id: "core", label: "核心系列", year: null, releases: [] },
  "raptor-2025": {
    id: "raptor-2025",
    label: "猛禽年",
    year: 2025,
    releases: [
      { wave: 1, label: "第一扩展", availableFrom: "2025-03-25T17:00:00.000Z" },
      { wave: 2, label: "第二扩展", availableFrom: "2025-07-08T17:00:00.000Z" },
      { wave: 3, label: "第三扩展", availableFrom: "2025-11-04T18:00:00.000Z" },
    ],
  },
  "scarab-2026": {
    id: "scarab-2026",
    label: "圣甲虫年",
    year: 2026,
    releases: [
      { wave: 1, label: "灾变", availableFrom: "2026-03-17T17:00:00.000Z" },
      { wave: 2, label: "越狱行动", availableFrom: "2026-07-07T17:00:00.000Z" },
      // Blizzard has announced the third set for October; the month boundary
      // is intentionally data-driven so the exact live date can replace it.
      { wave: 3, label: "第三扩展", availableFrom: "2026-10-01T00:00:00.000Z" },
    ],
  },
  "pegasus-2024": {
    id: "pegasus-2024",
    label: "飞马年",
    year: 2024,
    releases: [
      { wave: 1, label: "第一扩展", availableFrom: "2024-03-19T17:00:00.000Z" },
      { wave: 2, label: "第二扩展", availableFrom: "2024-07-23T17:00:00.000Z" },
      { wave: 3, label: "第三扩展", availableFrom: "2024-11-05T18:00:00.000Z" },
    ],
  },
});

export type StandardFormatSnapshot = {
  at: string;
  seasonYear: number;
  seasonLabel: string;
  activeSetIds: readonly CardSetId[];
  currentWave: CardReleaseWave;
  currentWaveLabel: string;
  nextRelease: { setId: CardSetId; label: string; availableFrom: string } | null;
};

function timestamp(value: Date | string | number): number {
  const result = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(result) ? result : Date.now();
}

/** Resolve the newest catalog year that has actually launched by this date. */
export function standardFormatSnapshot(
  at: Date | string | number = new Date(),
): StandardFormatSnapshot {
  const atMs = timestamp(at);
  const annualSets = Object.values(CARD_SET_DEFINITIONS)
    .filter((set) => set.year !== null && set.releases.length > 0)
    .sort((left, right) => left.year! - right.year!);
  const launchedSets = annualSets.filter(
    (set) => Date.parse(set.releases[0].availableFrom) <= atMs,
  );
  const currentSet = launchedSets.at(-1) ?? annualSets[0];
  const seasonYear = currentSet.year!;
  const activeAnnualSets = annualSets.filter(
    (set) => set.year === seasonYear || set.year === seasonYear - 1,
  );
  const releasedWindows = currentSet.releases.filter(
    (release) => Date.parse(release.availableFrom) <= atMs,
  );
  const currentRelease = releasedWindows.at(-1) ?? currentSet.releases[0];
  const nextRelease = currentSet.releases.find(
    (release) => Date.parse(release.availableFrom) > atMs,
  );
  return {
    at: new Date(atMs).toISOString(),
    seasonYear,
    seasonLabel: currentSet.label,
    activeSetIds: Object.freeze(["core", ...activeAnnualSets.map((set) => set.id)]),
    currentWave: currentRelease.wave,
    currentWaveLabel: currentRelease.label,
    nextRelease: nextRelease
      ? { setId: currentSet.id, label: nextRelease.label, availableFrom: nextRelease.availableFrom }
      : null,
  };
}

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

export function cardReleaseWaveForFactionOrdinal(ordinal: number): CardReleaseWave | undefined {
  const safeOrdinal = Math.max(0, Math.floor(Number.isFinite(ordinal) ? ordinal : 0));
  if (safeOrdinal >= 10 && safeOrdinal < 25) {
    return (Math.floor((safeOrdinal - 10) / 5) + 1) as CardReleaseWave;
  }
  if (safeOrdinal >= 25 && safeOrdinal < 39) {
    if (safeOrdinal === 34) return 3;
    return (Math.floor((safeOrdinal - 25) / 5) + 1) as CardReleaseWave;
  }
  if (safeOrdinal === 49) return 2;
  return undefined;
}

export function rankedFormatLabel(format: RankedFormat): string {
  return format === "wild" ? "狂野" : "标准";
}

export function cardAvailableInRankedFormat(
  card: Pick<CardDefinition, "set" | "releaseWave">,
  format: RankedFormat,
  at: Date | string | number = new Date(),
): boolean {
  if (card.set === undefined) return false;
  const definition = CARD_SET_DEFINITIONS[card.set];
  const released = definition.year === null || card.releaseWave === undefined
    ? true
    : definition.releases.some(
        (entry) => entry.wave === card.releaseWave && Date.parse(entry.availableFrom) <= timestamp(at),
      );
  if (!released || format === "wild") return released;
  return standardFormatSnapshot(at).activeSetIds.includes(card.set);
}

export function rankedFormatCardCount(
  catalog: readonly Pick<CardDefinition, "set" | "releaseWave">[],
  format: RankedFormat,
  at: Date | string | number = new Date(),
): number {
  return catalog.filter((card) => cardAvailableInRankedFormat(card, format, at)).length;
}
