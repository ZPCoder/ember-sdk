/** Ranked rules shared by the authoritative store and local fallback. */

export const LADDER_START_RATING = 1000;
export const LADDER_LEGEND_RATING = 1800;
export const LADDER_STARS_PER_RANK = 3;
export const LADDER_RANKS_PER_LEAGUE = 10;
export const LADDER_PROGRESS_PER_LEAGUE = LADDER_STARS_PER_RANK * LADDER_RANKS_PER_LEAGUE;
export const LADDER_LEGEND_PROGRESS = LADDER_PROGRESS_PER_LEAGUE * 5;
export const LADDER_DIAMOND_FIVE_PROGRESS = LADDER_PROGRESS_PER_LEAGUE * 4 + 15;
export const LADDER_MAX_STAR_BONUS = 11;

export const LADDER_LEAGUES = Object.freeze([
  "青铜",
  "白银",
  "黄金",
  "白金",
  "钻石",
] as const);

export type RankedLeague = (typeof LADDER_LEAGUES)[number] | "传说";

/** Rank 10 and rank 5 of every league are protected, as is Legend. */
export const LADDER_RANK_FLOORS = Object.freeze([
  0,
  15,
  30,
  45,
  60,
  75,
  90,
  105,
  120,
  135,
  LADDER_LEGEND_PROGRESS,
] as const);

export function normalizeRankedProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.min(LADDER_LEGEND_PROGRESS, Math.max(0, Math.floor(progress)));
}

/** Keep the legacy public rating monotonic while stars remain the source of truth. */
export function ladderRatingForProgress(progress: number): number {
  const safeProgress = normalizeRankedProgress(progress);
  return Math.round(
    LADDER_START_RATING
      + safeProgress * (LADDER_LEGEND_RATING - LADDER_START_RATING) / LADDER_LEGEND_PROGRESS,
  );
}

/** Decode the monotonic compatibility rating emitted from the new star path. */
export function ladderProgressForRating(rating: number): number {
  if (!Number.isFinite(rating)) return 0;
  return normalizeRankedProgress(Math.round(
    (rating - LADDER_START_RATING)
      * LADDER_LEGEND_PROGRESS / (LADDER_LEGEND_RATING - LADDER_START_RATING),
  ));
}

/** Preserve the named league of rating-only accounts during the one-time upgrade. */
export function ladderProgressForLegacyRating(rating: number): number {
  if (!Number.isFinite(rating)) return 0;
  if (rating < LADDER_START_RATING) {
    return normalizeRankedProgress(Math.round(
      Math.max(0, rating) * LADDER_PROGRESS_PER_LEAGUE / LADDER_START_RATING,
    ));
  }
  return normalizeRankedProgress(
    LADDER_PROGRESS_PER_LEAGUE
      + Math.round(
        (rating - LADDER_START_RATING)
          * (LADDER_LEGEND_PROGRESS - LADDER_PROGRESS_PER_LEAGUE)
          / (LADDER_LEGEND_RATING - LADDER_START_RATING),
      ),
  );
}

export function ladderLeagueForProgress(progress: number): RankedLeague {
  const safeProgress = normalizeRankedProgress(progress);
  if (safeProgress >= LADDER_LEGEND_PROGRESS) return "传说";
  return LADDER_LEAGUES[Math.floor(safeProgress / LADDER_PROGRESS_PER_LEAGUE)] ?? "青铜";
}

/** Rank 10 is the bottom and rank 1 is the top; Legend has no numbered rank here. */
export function ladderRankForProgress(progress: number): number {
  const safeProgress = normalizeRankedProgress(progress);
  if (safeProgress >= LADDER_LEGEND_PROGRESS) return 0;
  const progressInLeague = safeProgress % LADDER_PROGRESS_PER_LEAGUE;
  return LADDER_RANKS_PER_LEAGUE - Math.floor(progressInLeague / LADDER_STARS_PER_RANK);
}

export function ladderStarsForProgress(progress: number): number {
  const safeProgress = normalizeRankedProgress(progress);
  return safeProgress >= LADDER_LEGEND_PROGRESS ? 0 : safeProgress % LADDER_STARS_PER_RANK;
}

/** Compatibility helpers for legacy consumers that still hold only a rating. */
export function ladderTierForRating(rating: number): RankedLeague {
  return ladderLeagueForProgress(ladderProgressForRating(rating));
}

export function ladderRankForRating(rating: number): number {
  return ladderRankForProgress(ladderProgressForRating(rating));
}

export function ladderStarsForRating(rating: number): number {
  return ladderStarsForProgress(ladderProgressForRating(rating));
}

export const LADDER_TIERS = Object.freeze([
  ...LADDER_LEAGUES.map((name, index) => ({
    name,
    floor: ladderRatingForProgress(index * LADDER_PROGRESS_PER_LEAGUE),
  })),
  { name: "传说" as const, floor: LADDER_LEGEND_RATING },
]);

export function ladderLabelForProgress(progress: number): string {
  const league = ladderLeagueForProgress(progress);
  return league === "传说" ? league : `${league} ${ladderRankForProgress(progress)}`;
}

export function rankFloorForProgress(progress: number): number {
  const safeProgress = normalizeRankedProgress(progress);
  return [...LADDER_RANK_FLOORS].reverse().find((floor) => floor <= safeProgress) ?? 0;
}

export function isRankFloorProgress(progress: number): boolean {
  const safeProgress = normalizeRankedProgress(progress);
  return LADDER_RANK_FLOORS.some((floor) => floor === safeProgress);
}

/** Previous-season peak determines the starting multiplier for the next season. */
export function starBonusForSeasonPeak(peakProgress: number): number {
  const safePeak = normalizeRankedProgress(peakProgress);
  return Math.min(
    LADDER_MAX_STAR_BONUS,
    1 + LADDER_RANK_FLOORS.filter((floor) => floor > 0 && floor <= safePeak).length,
  );
}

function normalizeStarBonus(starBonus: number): number {
  if (!Number.isFinite(starBonus)) return 1;
  return Math.min(LADDER_MAX_STAR_BONUS, Math.max(1, Math.floor(starBonus)));
}

export type RankedSnapshot = {
  seasonKey: string;
  rating: number;
  tier: RankedLeague;
  rank: number;
  stars: number;
  rankProgress: number;
  starBonus: number;
  seasonBestProgress: number;
  wins: number;
  losses: number;
  highestRating: number;
  winStreak?: number;
};

export function createRankedSnapshot(seasonKey: string, starBonus = 1): RankedSnapshot {
  return {
    seasonKey,
    rating: LADDER_START_RATING,
    tier: "青铜",
    rank: 10,
    stars: 0,
    rankProgress: 0,
    starBonus: normalizeStarBonus(starBonus),
    seasonBestProgress: 0,
    wins: 0,
    losses: 0,
    highestRating: LADDER_START_RATING,
    winStreak: 0,
  };
}

function isRankedRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rankedNonNegativeInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback;
}

/** Upgrade stored snapshots from the earlier rating-only ladder shape. */
export function normalizeRankedSnapshot(
  value: unknown,
  fallbackSeasonKey: string,
): RankedSnapshot {
  if (!isRankedRecord(value)) return createRankedSnapshot(fallbackSeasonKey);
  const legacyRating = rankedNonNegativeInteger(value.rating, LADDER_START_RATING);
  const wins = rankedNonNegativeInteger(value.wins, 0);
  const losses = rankedNonNegativeInteger(value.losses, 0);
  const rankProgress = Object.hasOwn(value, "rankProgress")
    ? normalizeRankedProgress(rankedNonNegativeInteger(value.rankProgress, 0))
    : legacyRating === LADDER_START_RATING && wins === 0 && losses === 0
      ? 0
      : ladderProgressForLegacyRating(legacyRating);
  const seasonBestProgress = Math.max(
    rankProgress,
    normalizeRankedProgress(rankedNonNegativeInteger(value.seasonBestProgress, rankProgress)),
  );
  const rating = ladderRatingForProgress(rankProgress);
  return {
    seasonKey: typeof value.seasonKey === "string" ? value.seasonKey : fallbackSeasonKey,
    rating,
    tier: ladderLeagueForProgress(rankProgress),
    rank: ladderRankForProgress(rankProgress),
    stars: ladderStarsForProgress(rankProgress),
    rankProgress,
    starBonus: normalizeStarBonus(rankedNonNegativeInteger(value.starBonus, 1)),
    seasonBestProgress,
    wins,
    losses,
    highestRating: Math.max(
      rating,
      rankedNonNegativeInteger(value.highestRating, legacyRating),
    ),
    winStreak: rankedNonNegativeInteger(value.winStreak, 0),
  };
}

export function resetRankedSnapshotForSeason(
  ladder: RankedSnapshot,
  seasonKey: string,
): RankedSnapshot {
  const previousPeak = normalizeRankedProgress(ladder.seasonBestProgress);
  return {
    ...createRankedSnapshot(seasonKey, starBonusForSeasonPeak(previousPeak)),
    highestRating: Number.isFinite(ladder.highestRating)
      ? Math.max(LADDER_START_RATING, Math.floor(ladder.highestRating))
      : LADDER_START_RATING,
  };
}

function crossedRankFloors(fromProgress: number, toProgress: number): number {
  return LADDER_RANK_FLOORS.filter(
    (floor) => floor > fromProgress && floor <= toProgress,
  ).length;
}

/**
 * Hearthstone-style visible progression:
 * - each rank has three stars;
 * - a season multiplier applies only to wins and drops at every new floor;
 * - the third consecutive win doubles earned stars below Diamond 5;
 * - losses remove one star but cannot cross a rank 10/5 floor.
 */
export function updateRankedSnapshot(
  ladder: RankedSnapshot,
  result: "win" | "loss" | "draw",
): RankedSnapshot {
  // A draw is recorded elsewhere, but it does not move ladder progress or
  // interrupt the existing non-draw win streak.
  if (result === "draw") return { ...ladder };

  const progress = normalizeRankedProgress(ladder.rankProgress);
  const previousStreak = Math.max(0, Math.floor(ladder.winStreak ?? 0));
  const winStreak = result === "win" ? previousStreak + 1 : 0;
  const currentStarBonus = normalizeStarBonus(ladder.starBonus);

  let nextProgress = progress;
  let nextStarBonus = currentStarBonus;
  if (result === "win") {
    const streakMultiplier = winStreak >= 3 && progress < LADDER_DIAMOND_FIVE_PROGRESS ? 2 : 1;
    nextProgress = normalizeRankedProgress(progress + currentStarBonus * streakMultiplier);
    nextStarBonus = Math.max(
      1,
      currentStarBonus - crossedRankFloors(progress, nextProgress),
    );
  } else {
    nextProgress = Math.max(rankFloorForProgress(progress), progress - 1);
  }

  const rating = ladderRatingForProgress(nextProgress);
  return {
    ...ladder,
    rating,
    tier: ladderLeagueForProgress(nextProgress),
    rank: ladderRankForProgress(nextProgress),
    stars: ladderStarsForProgress(nextProgress),
    rankProgress: nextProgress,
    starBonus: nextStarBonus,
    seasonBestProgress: Math.max(
      normalizeRankedProgress(ladder.seasonBestProgress),
      nextProgress,
    ),
    wins: ladder.wins + (result === "win" ? 1 : 0),
    losses: ladder.losses + (result === "loss" ? 1 : 0),
    highestRating: Math.max(
      Number.isFinite(ladder.highestRating) ? Math.floor(ladder.highestRating) : LADDER_START_RATING,
      rating,
    ),
    winStreak,
  };
}
