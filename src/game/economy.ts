import type { CardDefinition, CardRarity } from "./types.js";

export type RewardKind = "gold" | "pack" | "dust";

export type RewardTrackReward = {
  level: number;
  title: string;
  kind: RewardKind;
  amount: number;
};

export type ApprenticeMetric = "packsOpened" | "matchesPlayed" | "wins" | "level";

export type ApprenticeMilestoneId =
  | "decode-first-pack"
  | "complete-first-match"
  | "win-first-match"
  | "reach-level-two";

export type ApprenticeMilestone = {
  id: ApprenticeMilestoneId;
  title: string;
  description: string;
  metric: ApprenticeMetric;
  target: number;
  reward: {
    title: string;
    kind: RewardKind;
    amount: number;
  };
};

export type ApprenticeProgressFacts = Record<ApprenticeMetric, number>;
export type ApprenticeMatchPool = "apprentice" | "standard";

export const APPRENTICE_MILESTONES: readonly ApprenticeMilestone[] = Object.freeze([
  {
    id: "decode-first-pack",
    title: "解密首个档案包",
    description: "打开 1 个卡包，认识稀有度与收藏扩充。",
    metric: "packsOpened",
    target: 1,
    reward: { title: "制卡星尘", kind: "dust", amount: 100 },
  },
  {
    id: "complete-first-match",
    title: "完成首次实战",
    description: "完整结束 1 场 AI 或联机对战。",
    metric: "matchesPlayed",
    target: 1,
    reward: { title: "战备档案包", kind: "pack", amount: 1 },
  },
  {
    id: "win-first-match",
    title: "取得首次胜利",
    description: "赢得 1 场 AI 或联机对战。",
    metric: "wins",
    target: 1,
    reward: { title: "首胜金币", kind: "gold", amount: 150 },
  },
  {
    id: "reach-level-two",
    title: "晋升指挥等级 2",
    description: "通过对战、任务和开包累计 1,000 XP。",
    metric: "level",
    target: 2,
    reward: { title: "毕业档案包", kind: "pack", amount: 2 },
  },
]);

export function apprenticeMilestoneProgress(
  milestone: ApprenticeMilestone,
  facts: ApprenticeProgressFacts,
): number {
  const value = facts[milestone.metric];
  return Math.min(milestone.target, Math.max(0, Number.isFinite(value) ? Math.floor(value) : 0));
}

export function apprenticeMilestoneComplete(
  milestone: ApprenticeMilestone,
  facts: ApprenticeProgressFacts,
): boolean {
  return apprenticeMilestoneProgress(milestone, facts) >= milestone.target;
}

/**
 * Graduation follows durable play facts instead of reward claims, so a player
 * cannot remain in the protected pool by leaving a completed reward unclaimed.
 */
export function apprenticeTrackComplete(facts: ApprenticeProgressFacts): boolean {
  return APPRENTICE_MILESTONES.every((milestone) => apprenticeMilestoneComplete(milestone, facts));
}

export function apprenticeMatchPoolForFacts(facts: ApprenticeProgressFacts): ApprenticeMatchPool {
  return apprenticeTrackComplete(facts) ? "standard" : "apprentice";
}

export const REWARD_TRACK: readonly RewardTrackReward[] = Object.freeze([
  { level: 2, title: "补给金币", kind: "gold", amount: 100 },
  { level: 3, title: "档案包", kind: "pack", amount: 1 },
  { level: 4, title: "星尘补给", kind: "dust", amount: 100 },
  { level: 5, title: "补给金币", kind: "gold", amount: 150 },
  { level: 6, title: "档案包", kind: "pack", amount: 1 },
  { level: 7, title: "星尘补给", kind: "dust", amount: 150 },
  { level: 8, title: "补给金币", kind: "gold", amount: 200 },
  { level: 9, title: "档案包", kind: "pack", amount: 1 },
  { level: 10, title: "星尘补给", kind: "dust", amount: 200 },
]);

const CRAFT_COSTS: Readonly<Record<CardRarity, number>> = Object.freeze({
  普通: 40,
  稀有: 100,
  史诗: 400,
  传说: 1600,
});

const DISENCHANT_VALUES: Readonly<Record<CardRarity, number>> = Object.freeze({
  普通: 5,
  稀有: 20,
  史诗: 100,
  传说: 400,
});

const GOLDEN_CRAFT_COSTS: Readonly<Record<CardRarity, number>> = Object.freeze({
  普通: 400,
  稀有: 800,
  史诗: 1600,
  传说: 3200,
});

const GOLDEN_DISENCHANT_VALUES: Readonly<Record<CardRarity, number>> = Object.freeze({
  普通: 50,
  稀有: 100,
  史诗: 400,
  传说: 1600,
});

export function craftCost(rarity: CardRarity): number {
  return CRAFT_COSTS[rarity];
}

export function disenchantValue(rarity: CardRarity): number {
  return DISENCHANT_VALUES[rarity];
}

export function goldenCraftCost(rarity: CardRarity): number {
  return GOLDEN_CRAFT_COSTS[rarity];
}

export function goldenDisenchantValue(rarity: CardRarity): number {
  return GOLDEN_DISENCHANT_VALUES[rarity];
}

export type ExtraCardDisenchantEntry = {
  cardId: string;
  copies: number;
  dust: number;
};

export type ExtraCardDisenchantPlan = {
  entries: readonly ExtraCardDisenchantEntry[];
  totalCards: number;
  totalCopies: number;
  totalDust: number;
};

/** Preview a safe mass disenchant while retaining one playable card set. */
export function extraCardDisenchantPlan(
  collection: Readonly<Record<string, number>>,
  catalog: readonly Pick<CardDefinition, "id" | "rarity" | "collectible">[],
): ExtraCardDisenchantPlan {
  const entries = catalog.flatMap((card): ExtraCardDisenchantEntry[] => {
    if (card.collectible === false) return [];
    const copyLimit = card.rarity === "传说" ? 1 : 2;
    const owned = Math.max(0, Math.floor(collection[card.id] ?? 0));
    const copies = Math.max(0, owned - copyLimit);
    if (copies === 0) return [];
    return [{ cardId: card.id, copies, dust: copies * disenchantValue(card.rarity) }];
  });
  return {
    entries: Object.freeze(entries),
    totalCards: entries.length,
    totalCopies: entries.reduce((total, entry) => total + entry.copies, 0),
    totalDust: entries.reduce((total, entry) => total + entry.dust, 0),
  };
}
