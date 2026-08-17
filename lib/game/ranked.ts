/** Ranked rules shared by the authoritative store and local fallback. */
export const LADDER_START_RATING = 1000;

export const LADDER_TIERS = Object.freeze([
  { name: "青铜", floor: 0 },
  { name: "白银", floor: 1000 },
  { name: "黄金", floor: 1200 },
  { name: "白金", floor: 1400 },
  { name: "钻石", floor: 1600 },
  { name: "传说", floor: 1800 },
] as const);

export function ladderTierForRating(rating: number): string {
  const safeRating = Math.max(0, Math.floor(rating));
  return [...LADDER_TIERS].reverse().find((tier) => safeRating >= tier.floor)?.name ?? "青铜";
}

/** Three stars per 50 rating points, matching the visual rank cadence. */
export function ladderStarsForRating(rating: number): number {
  const safeRating = Math.max(0, Math.floor(rating));
  const tier = [...LADDER_TIERS].reverse().find((candidate) => safeRating >= candidate.floor) ?? LADDER_TIERS[0];
  if (tier.name === "传说") return 0;
  return Math.min(3, Math.floor((safeRating - tier.floor) / 50));
}

export type RankedSnapshot = {
  seasonKey: string;
  rating: number;
  tier: string;
  stars: number;
  wins: number;
  losses: number;
  highestRating: number;
  winStreak?: number;
};

/** A small Hearthstone-like streak bonus below Platinum. */
export function updateRankedSnapshot(
  ladder: RankedSnapshot,
  result: "win" | "loss",
): RankedSnapshot {
  const previousStreak = Math.max(0, Math.floor(ladder.winStreak ?? 0));
  const winStreak = result === "win" ? previousStreak + 1 : 0;
  const streakBonus = result === "win" && winStreak >= 3 && ladder.rating < 1400 ? 10 : 0;
  const rating = Math.max(0, ladder.rating + (result === "win" ? 25 + streakBonus : -20));
  return {
    ...ladder,
    rating,
    tier: ladderTierForRating(rating),
    stars: ladderStarsForRating(rating),
    wins: ladder.wins + (result === "win" ? 1 : 0),
    losses: ladder.losses + (result === "loss" ? 1 : 0),
    highestRating: Math.max(ladder.highestRating, rating),
    winStreak,
  };
}
