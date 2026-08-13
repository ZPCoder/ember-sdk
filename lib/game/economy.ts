import type { CardRarity } from "./types.ts";

export type RewardKind = "gold" | "pack" | "dust";

export type RewardTrackReward = {
  level: number;
  title: string;
  kind: RewardKind;
  amount: number;
};

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

export function craftCost(rarity: CardRarity): number {
  return CRAFT_COSTS[rarity];
}

export function disenchantValue(rarity: CardRarity): number {
  return DISENCHANT_VALUES[rarity];
}
