import {
  type RankedSnapshot,
  createRankedSnapshot,
  normalizeRankedSnapshot,
} from "./ranked.js";
import type { RankedFormat } from "./types.js";

export type RankedLadders = Record<RankedFormat, RankedSnapshot>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createRankedLadders(seasonKey: string): RankedLadders {
  return {
    standard: createRankedSnapshot(seasonKey),
    wild: createRankedSnapshot(seasonKey),
  };
}

/**
 * Existing single-ladder accounts are split into identical Standard and Wild
 * snapshots once, matching Hearthstone's original format migration.
 */
export function normalizeRankedLadders(
  value: unknown,
  legacyLadder: unknown,
  fallbackSeasonKey: string,
): RankedLadders {
  const source = isRecord(value) ? value : null;
  const legacy = legacyLadder ?? createRankedSnapshot(fallbackSeasonKey);
  return {
    standard: normalizeRankedSnapshot(source?.standard ?? legacy, fallbackSeasonKey),
    wild: normalizeRankedSnapshot(source?.wild ?? legacy, fallbackSeasonKey),
  };
}

export function highestRankedFormat(ladders: RankedLadders): RankedFormat {
  return ladders.wild.seasonBestProgress > ladders.standard.seasonBestProgress
    ? "wild"
    : "standard";
}

export function totalRankedWins(ladders: RankedLadders): number {
  return ladders.standard.wins + ladders.wild.wins;
}

export function cloneRankedLadders(ladders: RankedLadders): RankedLadders {
  return {
    standard: { ...ladders.standard },
    wild: { ...ladders.wild },
  };
}
