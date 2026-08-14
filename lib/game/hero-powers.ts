import { CARD_BY_ID } from "./catalog.ts";
import type { Faction, HeroPowerDefinition } from "./types.ts";

export const HERO_POWERS: Readonly<Record<Faction, HeroPowerDefinition>> = Object.freeze({
  "曜光": {
    id: "radiance-mend",
    faction: "曜光",
    name: "日耀修复",
    description: "为一个友方角色恢复 2 点生命。",
    cost: 2,
    target: "friendly-character",
    effect: { kind: "heal-friendly-character", amount: 2 },
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
    description: "对一个敌方单位造成 2 点伤害。",
    cost: 2,
    target: "enemy-unit",
    effect: { kind: "damage-enemy-unit", amount: 2 },
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
  "霜境": { id: "frost-ward", faction: "霜境", name: "冰甲脉冲", description: "为你的核心获得 2 点护甲。", cost: 2, effect: { kind: "armor", amount: 2 } },
  "砂海": { id: "sand-trade", faction: "砂海", name: "沙海寻路", description: "抽一张牌。", cost: 2, effect: { kind: "draw", count: 1 } },
  "赤月": { id: "bloodmoon-drain", faction: "赤月", name: "猩红汲取", description: "对敌方核心造成 1 点伤害。", cost: 2, effect: { kind: "damage-enemy-hero", amount: 1 } },
  "灵脉": { id: "leyline-focus", faction: "灵脉", name: "灵脉聚焦", description: "抽一张牌。", cost: 2, effect: { kind: "draw", count: 1 } },
  "暮影": { id: "dusk-veil", faction: "暮影", name: "暮影帷幕", description: "对敌方核心造成 1 点伤害。", cost: 2, effect: { kind: "damage-enemy-hero", amount: 1 } },
  "云瀑": { id: "cloudfall-drift", faction: "云瀑", name: "云瀑回旋", description: "抽一张牌。", cost: 2, effect: { kind: "draw", count: 1 } },
  "磁风": { id: "magnet-plate", faction: "磁风", name: "磁场装配", description: "为你的核心获得 2 点护甲。", cost: 2, effect: { kind: "armor", amount: 2 } },
  "晶核": { id: "crystal-prism", faction: "晶核", name: "晶核折光", description: "为一个友方角色恢复 2 点生命。", cost: 2, target: "friendly-character", effect: { kind: "heal-friendly-character", amount: 2 } },
  "梦境": { id: "dream-discover", faction: "梦境", name: "入梦寻迹", description: "抽一张牌。", cost: 2, effect: { kind: "draw", count: 1 } },
  "裂星": { id: "rift-strike", faction: "裂星", name: "裂星冲击", description: "对敌方核心造成 1 点伤害。", cost: 2, effect: { kind: "damage-enemy-hero", amount: 1 } },
  "时砂": { id: "timesand-loop", faction: "时砂", name: "回环刻度", description: "抽一张牌。", cost: 2, effect: { kind: "draw", count: 1 } },
  "幽森": { id: "gloomwood-thorn", faction: "幽森", name: "毒荆护根", description: "为你的核心获得 2 点护甲。", cost: 2, effect: { kind: "armor", amount: 2 } },
  "天穹": { id: "firmament-guard", faction: "天穹", name: "穹顶壁垒", description: "为你的核心获得 2 点护甲。", cost: 2, effect: { kind: "armor", amount: 2 } },
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
