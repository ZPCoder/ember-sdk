import type { CardDefinition, CardRarity } from "./types.ts";
import {
  type RankedSnapshot,
  ladderLabelForProgress,
  normalizeRankedProgress,
  resetRankedSnapshotForSeason,
  updateRankedSnapshot,
} from "./ranked.ts";

export type RankedRewardBundle = {
  packs: number;
  rareCards: number;
  epicCards: number;
  legendaryCards: number;
};

export type RankedSeasonChest = RankedRewardBundle & {
  seasonKey: string;
  peakProgress: number;
  peakLabel: string;
  awardedAt: string;
};

export type RankedRewardState = {
  claimedFirstTimeFloors: number[];
  earnedCardBackSeasons: string[];
  seasonChests: RankedSeasonChest[];
};

export type RankedRewardCard = {
  cardId: string;
  count: number;
  rarity: Exclude<CardRarity, "普通">;
};

export type RankedRewardEconomy = {
  ladder: RankedSnapshot;
  rankedRewards: RankedRewardState;
  collection: Record<string, number>;
  packsAvailable: number;
};

export type RankedRewardResult = RankedRewardEconomy & {
  grantedFirstTimeFloors: number[];
  cardBackUnlocked: boolean;
  seasonChest: RankedSeasonChest | null;
  grantedCards: RankedRewardCard[];
  grantedPacks: number;
};

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
  return {
    claimedFirstTimeFloors,
    earnedCardBackSeasons,
    seasonChests: [...uniqueChests.values()].sort((a, b) => a.seasonKey.localeCompare(b.seasonKey)),
  };
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
    next.ladder.seasonBestProgress,
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
  const cardBackUnlocked = next.ladder.wins >= 5
    && !next.rankedRewards.earnedCardBackSeasons.includes(next.ladder.seasonKey);
  next = {
    ...next,
    rankedRewards: {
      ...next.rankedRewards,
      claimedFirstTimeFloors: [...new Set([
        ...next.rankedRewards.claimedFirstTimeFloors,
        ...grantedFirstTimeFloors,
      ])].sort((a, b) => a - b),
      earnedCardBackSeasons: cardBackUnlocked
        ? [...next.rankedRewards.earnedCardBackSeasons, next.ladder.seasonKey].sort()
        : next.rankedRewards.earnedCardBackSeasons,
    },
  };
  return {
    ...next,
    grantedFirstTimeFloors,
    cardBackUnlocked,
    seasonChest: null,
    grantedCards,
    grantedPacks,
  };
}

export function applyRankedMatchResult(
  economy: RankedRewardEconomy,
  catalog: readonly Pick<CardDefinition, "id" | "rarity">[],
  result: "win" | "loss" | "draw",
): RankedRewardResult {
  return applyOutstandingRankedRewards({
    ...economy,
    ladder: updateRankedSnapshot(economy.ladder, result),
  }, catalog);
}

export function rollRankedSeason(
  economy: RankedRewardEconomy,
  catalog: readonly Pick<CardDefinition, "id" | "rarity">[],
  nextSeasonKey: string,
  awardedAt: string,
): RankedRewardResult {
  const outstanding = applyOutstandingRankedRewards(economy, catalog);
  if (outstanding.ladder.seasonKey === nextSeasonKey) return outstanding;

  let next: RankedRewardEconomy = outstanding;
  const alreadyAwarded = next.rankedRewards.seasonChests.some(
    (chest) => chest.seasonKey === next.ladder.seasonKey,
  );
  const bundle = rankedSeasonRewardForPeak(next.ladder.seasonBestProgress);
  const hasReward = Object.values(bundle).some((amount) => amount > 0);
  let seasonChest: RankedSeasonChest | null = null;
  const grantedCards = [...outstanding.grantedCards];
  let grantedPacks = outstanding.grantedPacks;
  if (!alreadyAwarded && hasReward) {
    const granted = grantBundle(
      next,
      catalog,
      bundle,
      `ranked-season:${next.ladder.seasonKey}:${next.ladder.seasonBestProgress}`,
    );
    next = granted.economy;
    grantedCards.push(...granted.cards);
    grantedPacks += bundle.packs;
    seasonChest = {
      seasonKey: next.ladder.seasonKey,
      peakProgress: normalizeRankedProgress(next.ladder.seasonBestProgress),
      peakLabel: ladderLabelForProgress(next.ladder.seasonBestProgress),
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
    ladder: resetRankedSnapshotForSeason(next.ladder, nextSeasonKey),
  };
  return {
    ...next,
    grantedFirstTimeFloors: outstanding.grantedFirstTimeFloors,
    cardBackUnlocked: outstanding.cardBackUnlocked,
    seasonChest,
    grantedCards,
    grantedPacks,
  };
}
