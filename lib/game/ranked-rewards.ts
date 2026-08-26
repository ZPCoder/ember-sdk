import type { CardDefinition, CardRarity } from "./types.ts";
import type { RankedFormat } from "./types.ts";
import {
  LADDER_LEGEND_PROGRESS,
  ladderLabelForProgress,
  normalizeRankedProgress,
  resetRankedSnapshotForSeason,
  updateRankedSnapshot,
} from "./ranked.ts";
import {
  type RankedLadders,
  totalRankedWins,
} from "./ranked-formats.ts";

export type RankedRewardBundle = {
  packs: number;
  rareCards: number;
  epicCards: number;
  legendaryCards: number;
};

export type RankedSeasonChest = RankedRewardBundle & {
  seasonKey: string;
  sourceFormat: RankedFormat;
  peakProgress: number;
  peakLabel: string;
  awardedAt: string;
};

export type RankedRewardState = {
  claimedFirstTimeFloors: number[];
  earnedCardBackSeasons: string[];
  legendSeasons: string[];
  seasonChests: RankedSeasonChest[];
};

export type RankedRewardCard = {
  cardId: string;
  count: number;
  rarity: Exclude<CardRarity, "普通">;
};

export type RankedRewardEconomy = {
  ladders: RankedLadders;
  rankedRewards: RankedRewardState;
  collection: Record<string, number>;
  packsAvailable: number;
};

export type RankedRewardResult = RankedRewardEconomy & {
  grantedFirstTimeFloors: number[];
  cardBackUnlocked: boolean;
  legendSeasonCardBackUnlocked: boolean;
  seasonChest: RankedSeasonChest | null;
  grantedCards: RankedRewardCard[];
  grantedPacks: number;
};

export const ETERNAL_SCARAB_CARD_BACK_NAME = "永恒圣甲虫";
export const ETERNAL_SCARAB_LEGEND_SEASON_TARGET = 6;
export const YEAR_OF_THE_SCARAB = 2026;

export const EMPTY_RANKED_REWARD_BUNDLE: RankedRewardBundle = Object.freeze({
  packs: 0,
  rareCards: 0,
  epicCards: 0,
  legendaryCards: 0,
});

export const RANKED_SEASON_REWARD_LEVELS = Object.freeze([
  { floor: 15, label: "青铜 5", reward: { ...EMPTY_RANKED_REWARD_BUNDLE, rareCards: 1 } },
  { floor: 30, label: "白银 10", reward: { ...EMPTY_RANKED_REWARD_BUNDLE, packs: 1 } },
  { floor: 45, label: "白银 5", reward: { ...EMPTY_RANKED_REWARD_BUNDLE, rareCards: 2 } },
  { floor: 60, label: "黄金 10", reward: { ...EMPTY_RANKED_REWARD_BUNDLE, packs: 1 } },
  { floor: 75, label: "黄金 5", reward: { ...EMPTY_RANKED_REWARD_BUNDLE, rareCards: 2 } },
  { floor: 90, label: "白金 10", reward: { ...EMPTY_RANKED_REWARD_BUNDLE, packs: 1 } },
  { floor: 105, label: "白金 5", reward: { ...EMPTY_RANKED_REWARD_BUNDLE, rareCards: 2 } },
  { floor: 120, label: "钻石 10", reward: { ...EMPTY_RANKED_REWARD_BUNDLE, packs: 1 } },
  { floor: 135, label: "钻石 5", reward: { ...EMPTY_RANKED_REWARD_BUNDLE, epicCards: 1 } },
  { floor: 150, label: "传说", reward: { ...EMPTY_RANKED_REWARD_BUNDLE, packs: 1 } },
] as const);

export const RANKED_FIRST_TIME_REWARD_LEVELS = Object.freeze([
  { floor: 15, label: "青铜 5", reward: { ...EMPTY_RANKED_REWARD_BUNDLE, packs: 1 } },
  { floor: 30, label: "白银 10", reward: { ...EMPTY_RANKED_REWARD_BUNDLE, rareCards: 4 } },
  { floor: 45, label: "白银 5", reward: { ...EMPTY_RANKED_REWARD_BUNDLE, packs: 1 } },
  { floor: 60, label: "黄金 10", reward: { ...EMPTY_RANKED_REWARD_BUNDLE, rareCards: 4 } },
  { floor: 75, label: "黄金 5", reward: { ...EMPTY_RANKED_REWARD_BUNDLE, packs: 1 } },
  { floor: 90, label: "白金 10", reward: { ...EMPTY_RANKED_REWARD_BUNDLE, epicCards: 1 } },
  { floor: 105, label: "白金 5", reward: { ...EMPTY_RANKED_REWARD_BUNDLE, packs: 1 } },
  { floor: 120, label: "钻石 10", reward: { ...EMPTY_RANKED_REWARD_BUNDLE, epicCards: 1 } },
  { floor: 135, label: "钻石 5", reward: { ...EMPTY_RANKED_REWARD_BUNDLE, packs: 1 } },
  { floor: 150, label: "传说", reward: { ...EMPTY_RANKED_REWARD_BUNDLE, legendaryCards: 1 } },
] as const);

const SEASON_KEY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

function nonNegativeInteger(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeBundle(value: unknown): RankedRewardBundle {
  if (!isRecord(value)) return { ...EMPTY_RANKED_REWARD_BUNDLE };
  return {
    packs: nonNegativeInteger(value.packs),
    rareCards: nonNegativeInteger(value.rareCards),
    epicCards: nonNegativeInteger(value.epicCards),
    legendaryCards: nonNegativeInteger(value.legendaryCards),
  };
}

export function createRankedRewardState(): RankedRewardState {
  return {
    claimedFirstTimeFloors: [],
    earnedCardBackSeasons: [],
    legendSeasons: [],
    seasonChests: [],
  };
}

export function normalizeRankedRewardState(value: unknown): RankedRewardState {
  if (!isRecord(value)) return createRankedRewardState();
  const validFloors = new Set<number>(RANKED_FIRST_TIME_REWARD_LEVELS.map((level) => level.floor));
  const claimedFirstTimeFloors = Array.isArray(value.claimedFirstTimeFloors)
    ? [...new Set(value.claimedFirstTimeFloors.filter(
        (floor): floor is number => nonNegativeInteger(floor, -1) === floor && validFloors.has(floor),
      ))].sort((a, b) => a - b)
    : [];
  const earnedCardBackSeasons = Array.isArray(value.earnedCardBackSeasons)
    ? [...new Set(value.earnedCardBackSeasons.filter(
        (season): season is string => typeof season === "string" && SEASON_KEY_PATTERN.test(season),
      ))].sort()
    : [];
  const seasonChests = Array.isArray(value.seasonChests)
    ? value.seasonChests.flatMap((entry): RankedSeasonChest[] => {
        if (!isRecord(entry) || typeof entry.seasonKey !== "string" || !SEASON_KEY_PATTERN.test(entry.seasonKey)) return [];
        const peakProgress = normalizeRankedProgress(nonNegativeInteger(entry.peakProgress));
        const bundle = normalizeBundle(entry);
        return [{
          seasonKey: entry.seasonKey,
          sourceFormat: entry.sourceFormat === "wild" ? "wild" : "standard",
          peakProgress,
          peakLabel: ladderLabelForProgress(peakProgress),
          awardedAt: typeof entry.awardedAt === "string" && Number.isFinite(Date.parse(entry.awardedAt))
            ? entry.awardedAt
            : `${entry.seasonKey}-01T00:00:00.000Z`,
          ...bundle,
        }];
      })
    : [];
  const uniqueChests = new Map<string, RankedSeasonChest>();
  for (const chest of seasonChests) uniqueChests.set(chest.seasonKey, chest);
  const normalizedChests = [...uniqueChests.values()]
    .sort((a, b) => a.seasonKey.localeCompare(b.seasonKey));
  const recordedLegendSeasons = Array.isArray(value.legendSeasons)
    ? value.legendSeasons.filter(
        (season): season is string => typeof season === "string" && SEASON_KEY_PATTERN.test(season),
      )
    : [];
  const legendSeasons = [...new Set([
    ...recordedLegendSeasons,
    ...normalizedChests
      .filter((chest) => chest.peakProgress >= LADDER_LEGEND_PROGRESS)
      .map((chest) => chest.seasonKey),
  ])].sort();
  return {
    claimedFirstTimeFloors,
    earnedCardBackSeasons,
    legendSeasons,
    seasonChests: normalizedChests,
  };
}

export function eternalScarabLegendProgress(state: RankedRewardState): number {
  const yearPrefix = `${YEAR_OF_THE_SCARAB}-`;
  return Math.min(
    ETERNAL_SCARAB_LEGEND_SEASON_TARGET,
    new Set(state.legendSeasons.filter((seasonKey) => seasonKey.startsWith(yearPrefix))).size,
  );
}

export function eternalScarabCardBackEarned(state: RankedRewardState): boolean {
  return eternalScarabLegendProgress(state) >= ETERNAL_SCARAB_LEGEND_SEASON_TARGET;
}

function addBundles(left: RankedRewardBundle, right: RankedRewardBundle): RankedRewardBundle {
  return {
    packs: left.packs + right.packs,
    rareCards: left.rareCards + right.rareCards,
    epicCards: left.epicCards + right.epicCards,
    legendaryCards: left.legendaryCards + right.legendaryCards,
  };
}

export function rankedSeasonRewardForPeak(peakProgress: number): RankedRewardBundle {
  const safePeak = normalizeRankedProgress(peakProgress);
  return RANKED_SEASON_REWARD_LEVELS
    .filter((level) => level.floor <= safePeak)
    .reduce((reward, level) => addBundles(reward, level.reward), { ...EMPTY_RANKED_REWARD_BUNDLE });
}

export function rankedFirstTimeRewardForFloor(floor: number): RankedRewardBundle {
  const level = RANKED_FIRST_TIME_REWARD_LEVELS.find((candidate) => candidate.floor === floor);
  return level ? { ...level.reward } : { ...EMPTY_RANKED_REWARD_BUNDLE };
}

export function unclaimedRankedRewardFloors(
  peakProgress: number,
  claimedFloors: readonly number[],
): number[] {
  const safePeak = normalizeRankedProgress(peakProgress);
  const claimed = new Set(claimedFloors);
  return RANKED_FIRST_TIME_REWARD_LEVELS
    .filter((level) => level.floor <= safePeak && !claimed.has(level.floor))
    .map((level) => level.floor);
}

export function describeRankedRewardBundle(bundle: RankedRewardBundle): string {
  const parts: string[] = [];
  if (bundle.packs > 0) parts.push(`${bundle.packs} 包`);
  if (bundle.rareCards > 0) parts.push(`${bundle.rareCards} 张稀有`);
  if (bundle.epicCards > 0) parts.push(`${bundle.epicCards} 张史诗`);
  if (bundle.legendaryCards > 0) parts.push(`${bundle.legendaryCards} 张传说`);
  return parts.length > 0 ? parts.join(" · ") : "尚未达到青铜 5";
}

function stableRewardSeed(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function selectCardsOfRarity(
  catalog: readonly Pick<CardDefinition, "id" | "rarity">[],
  collection: Record<string, number>,
  rarity: RankedRewardCard["rarity"],
  count: number,
  seed: string,
): RankedRewardCard[] {
  const candidates = catalog
    .filter((card) => card.rarity === rarity)
    .map((card) => card.id)
    .sort();
  if (candidates.length === 0 || count <= 0) return [];
  const grants = new Map<string, number>();
  const copyLimit = rarity === "传说" ? 1 : 2;
  const cursor = stableRewardSeed(`${seed}:${rarity}`) % candidates.length;
  for (let pick = 0; pick < count; pick += 1) {
    let selected = candidates[(cursor + pick) % candidates.length];
    for (let offset = 0; offset < candidates.length; offset += 1) {
      const candidate = candidates[(cursor + pick + offset) % candidates.length];
      const owned = (collection[candidate] ?? 0) + (grants.get(candidate) ?? 0);
      if (owned < copyLimit) {
        selected = candidate;
        break;
      }
    }
    grants.set(selected, (grants.get(selected) ?? 0) + 1);
  }
  return [...grants.entries()].map(([cardId, grantedCount]) => ({
    cardId,
    count: grantedCount,
    rarity,
  }));
}

function grantBundle(
  economy: RankedRewardEconomy,
  catalog: readonly Pick<CardDefinition, "id" | "rarity">[],
  bundle: RankedRewardBundle,
  seed: string,
): { economy: RankedRewardEconomy; cards: RankedRewardCard[] } {
  const collection = { ...economy.collection };
  const cards = [
    ...selectCardsOfRarity(catalog, collection, "稀有", bundle.rareCards, seed),
    ...selectCardsOfRarity(catalog, collection, "史诗", bundle.epicCards, seed),
    ...selectCardsOfRarity(catalog, collection, "传说", bundle.legendaryCards, seed),
  ];
  for (const card of cards) collection[card.cardId] = (collection[card.cardId] ?? 0) + card.count;
  return {
    economy: {
      ...economy,
      collection,
      packsAvailable: economy.packsAvailable + bundle.packs,
    },
    cards,
  };
}

export function applyOutstandingRankedRewards(
  economy: RankedRewardEconomy,
  catalog: readonly Pick<CardDefinition, "id" | "rarity">[],
): RankedRewardResult {
  let next: RankedRewardEconomy = {
    ...economy,
    rankedRewards: normalizeRankedRewardState(economy.rankedRewards),
    collection: { ...economy.collection },
  };
  const grantedFirstTimeFloors = unclaimedRankedRewardFloors(
    Math.max(next.ladders.standard.seasonBestProgress, next.ladders.wild.seasonBestProgress),
    next.rankedRewards.claimedFirstTimeFloors,
  );
  const grantedCards: RankedRewardCard[] = [];
  let grantedPacks = 0;
  for (const floor of grantedFirstTimeFloors) {
    const bundle = rankedFirstTimeRewardForFloor(floor);
    const granted = grantBundle(next, catalog, bundle, `ranked-first:${floor}`);
    next = granted.economy;
    grantedCards.push(...granted.cards);
    grantedPacks += bundle.packs;
  }
  const seasonKey = next.ladders.standard.seasonKey;
  const cardBackUnlocked = totalRankedWins(next.ladders) >= 5
    && !next.rankedRewards.earnedCardBackSeasons.includes(seasonKey);
  const legendProgressBefore = eternalScarabLegendProgress(next.rankedRewards);
  const legendSeasons = new Set(next.rankedRewards.legendSeasons);
  for (const ladder of Object.values(next.ladders)) {
    if (
      ladder.seasonBestProgress >= LADDER_LEGEND_PROGRESS
      && SEASON_KEY_PATTERN.test(ladder.seasonKey)
    ) {
      legendSeasons.add(ladder.seasonKey);
    }
  }
  const normalizedLegendSeasons = [...legendSeasons].sort();
  const legendSeasonCardBackUnlocked = legendProgressBefore < ETERNAL_SCARAB_LEGEND_SEASON_TARGET
    && eternalScarabLegendProgress({
      ...next.rankedRewards,
      legendSeasons: normalizedLegendSeasons,
    }) >= ETERNAL_SCARAB_LEGEND_SEASON_TARGET;
  next = {
    ...next,
    rankedRewards: {
      ...next.rankedRewards,
      claimedFirstTimeFloors: [...new Set([
        ...next.rankedRewards.claimedFirstTimeFloors,
        ...grantedFirstTimeFloors,
      ])].sort((a, b) => a - b),
      earnedCardBackSeasons: cardBackUnlocked
        ? [...next.rankedRewards.earnedCardBackSeasons, seasonKey].sort()
        : next.rankedRewards.earnedCardBackSeasons,
      legendSeasons: normalizedLegendSeasons,
    },
  };
  return {
    ...next,
    grantedFirstTimeFloors,
    cardBackUnlocked,
    legendSeasonCardBackUnlocked,
    seasonChest: null,
    grantedCards,
    grantedPacks,
  };
}

export function applyRankedMatchResult(
  economy: RankedRewardEconomy,
  catalog: readonly Pick<CardDefinition, "id" | "rarity">[],
  format: RankedFormat,
  result: "win" | "loss" | "draw",
): RankedRewardResult {
  return applyOutstandingRankedRewards({
    ...economy,
    ladders: {
      ...economy.ladders,
      [format]: updateRankedSnapshot(economy.ladders[format], result),
    },
  }, catalog);
}

export function rollRankedSeason(
  economy: RankedRewardEconomy,
  catalog: readonly Pick<CardDefinition, "id" | "rarity">[],
  nextSeasonKey: string,
  awardedAt: string,
): RankedRewardResult {
  const outstanding = applyOutstandingRankedRewards(economy, catalog);
  if (
    outstanding.ladders.standard.seasonKey === nextSeasonKey
    && outstanding.ladders.wild.seasonKey === nextSeasonKey
  ) return outstanding;

  let next: RankedRewardEconomy = outstanding;
  const outdatedFormats = (["standard", "wild"] as const).filter(
    (format) => outstanding.ladders[format].seasonKey !== nextSeasonKey,
  );
  const sourceFormat = outdatedFormats.reduce<RankedFormat>(
    (best, format) => outstanding.ladders[format].seasonBestProgress
      > outstanding.ladders[best].seasonBestProgress
      ? format
      : best,
    outdatedFormats[0] ?? "standard",
  );
  const sourceLadder = outstanding.ladders[sourceFormat];
  const alreadyAwarded = next.rankedRewards.seasonChests.some(
    (chest) => chest.seasonKey === sourceLadder.seasonKey,
  );
  const bundle = rankedSeasonRewardForPeak(sourceLadder.seasonBestProgress);
  const hasReward = Object.values(bundle).some((amount) => amount > 0);
  let seasonChest: RankedSeasonChest | null = null;
  const grantedCards = [...outstanding.grantedCards];
  let grantedPacks = outstanding.grantedPacks;
  if (!alreadyAwarded && hasReward) {
    const granted = grantBundle(
      next,
      catalog,
      bundle,
      `ranked-season:${sourceLadder.seasonKey}:${sourceFormat}:${sourceLadder.seasonBestProgress}`,
    );
    next = granted.economy;
    grantedCards.push(...granted.cards);
    grantedPacks += bundle.packs;
    seasonChest = {
      seasonKey: sourceLadder.seasonKey,
      sourceFormat,
      peakProgress: normalizeRankedProgress(sourceLadder.seasonBestProgress),
      peakLabel: ladderLabelForProgress(sourceLadder.seasonBestProgress),
      awardedAt,
      ...bundle,
    };
    next = {
      ...next,
      rankedRewards: {
        ...next.rankedRewards,
        seasonChests: [...next.rankedRewards.seasonChests, seasonChest]
          .sort((a, b) => a.seasonKey.localeCompare(b.seasonKey)),
      },
    };
  }
  next = {
    ...next,
    ladders: {
      standard: next.ladders.standard.seasonKey === nextSeasonKey
        ? next.ladders.standard
        : resetRankedSnapshotForSeason(next.ladders.standard, nextSeasonKey),
      wild: next.ladders.wild.seasonKey === nextSeasonKey
        ? next.ladders.wild
        : resetRankedSnapshotForSeason(next.ladders.wild, nextSeasonKey),
    },
  };
  return {
    ...next,
    grantedFirstTimeFloors: outstanding.grantedFirstTimeFloors,
    cardBackUnlocked: outstanding.cardBackUnlocked,
    legendSeasonCardBackUnlocked: outstanding.legendSeasonCardBackUnlocked,
    seasonChest,
    grantedCards,
    grantedPacks,
  };
}
