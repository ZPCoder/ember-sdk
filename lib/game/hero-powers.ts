import { CARD_BY_ID } from "./catalog.ts";
import type { Faction, HeroPowerDefinition } from "./types.ts";

export const HERO_POWERS: Readonly<Record<Faction, HeroPowerDefinition>> = Object.freeze({
  "曜光": {
    id: "radiance-mend",
    faction: "曜光",
    name: "日耀修复",
    description: "为你的核心恢复 2 点生命。",
    cost: 2,
    effect: { kind: "heal-friendly-hero", amount: 2 },
  },
  "幽潮": {
    id: "tide-pulse",
    faction: "幽潮",
    name: "潮汐脉冲",
    description: "对敌方核心造成 1 点伤害。",
    cost: 2,
    effect: { kind: "damage-enemy-hero", amount: 1 },
  },
  "烬火": {
    id: "ember-scorch",
    faction: "烬火",
    name: "熔火灼痕",
    description: "对敌方核心造成 2 点伤害。",
    cost: 2,
    effect: { kind: "damage-enemy-hero", amount: 2 },
  },
  "星穹": {
    id: "astral-insight",
    faction: "星穹",
    name: "星穹洞见",
    description: "抽一张牌。",
    cost: 2,
    effect: { kind: "draw", count: 1 },
  },
  "苍林": {
    id: "verdant-growth",
    faction: "苍林",
    name: "苍林生长",
    description: "召唤一个 1/2 的苔径奔行兽。",
    cost: 2,
    effect: { kind: "summon", cardId: "neutral-moss-runner", count: 1 },
  },
  "雷铸": {
    id: "storm-plating",
    faction: "雷铸",
    name: "雷铸装甲",
    description: "为你的核心获得 2 点护甲。",
    cost: 2,
    effect: { kind: "armor", amount: 2 },
  },
  "中立": {
    id: "core-pulse",
    faction: "中立",
    name: "核心脉冲",
    description: "对敌方核心造成 1 点伤害。",
    cost: 2,
    effect: { kind: "damage-enemy-hero", amount: 1 },
  },
});

export function factionForDeck(deck: readonly string[]): Faction {
  for (const cardId of deck) {
    const card = CARD_BY_ID[cardId];
    if (card && card.faction !== "中立") return card.faction;
  }
  return "中立";
}

export function getHeroPower(faction: Faction): HeroPowerDefinition {
  return HERO_POWERS[faction] ?? HERO_POWERS["中立"];
}
