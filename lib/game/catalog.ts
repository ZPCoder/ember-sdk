import type { CardDefinition, CardEffect, Keyword } from "./types.ts";
import { CORE_EXPANSION_CARDS } from "./catalog-core-expansion.ts";
import { EMBER_ASTRAL_CARDS } from "./catalog-ember-astral.ts";
import { VERDANT_STORM_CARDS } from "./catalog-verdant-storm.ts";

const CARD_RULE_KEYWORDS: Readonly<Record<string, readonly Keyword[]>> = {
  "sun-horizon-hunter": ["rush"],
  "sun-zenith-golem": ["deathrattle"],
  "void-nightfin-raider": ["windfury"],
  "void-ink-storm": ["freeze"],
  "neutral-repair-sprite": ["poisonous"],
  "neutral-stonehorn": ["reborn"],
  "ember-ashwing-phoenix": ["reborn", "deathrattle"],
  "ember-crimson-duelist": ["windfury"],
  "astral-eclipse-stalker": ["stealth"],
  "verdant-ancient-bough-guardian": ["deathrattle"],
  "verdant-seedvault-engineer": ["reborn"],
};

const CARD_RULE_DEATHRATTLES: Readonly<Record<string, readonly CardEffect[]>> = {
  "sun-zenith-golem": [
    { kind: "summon", cardId: "sun-dawn-scout", count: 1 },
  ],
  "ember-ashwing-phoenix": [{ kind: "armor", amount: 1 }],
  "verdant-ancient-bough-guardian": [
    { kind: "summon", cardId: "verdant-seedsong-sprite", count: 1 },
  ],
};

function enrichCardRules(card: CardDefinition): CardDefinition {
  const keywords = new Set<Keyword>(card.keywords ?? []);
  for (const keyword of CARD_RULE_KEYWORDS[card.id] ?? []) {
    keywords.add(keyword);
  }
  if (card.onPlay && card.onPlay.length > 0) keywords.add("battlecry");
  if ((card.overload ?? 0) > 0) keywords.add("overload");
  if ((card.combo ?? []).length > 0) keywords.add("combo");
  if ((card.spellDamage ?? 0) > 0) keywords.add("spell-damage");
  if (card.effect?.some((effect) => effect.kind === "silence")) keywords.add("silence");
  if (card.effect?.some((effect) => effect.kind === "choose-one")) keywords.add("choose-one");
  if (card.effect?.some((effect) => effect.kind === "transform")) keywords.add("transform");
  if (card.onTurnStart && card.onTurnStart.length > 0) keywords.add("start-of-turn");
  if (card.onTurnEnd && card.onTurnEnd.length > 0) keywords.add("end-of-turn");
  if (card.onSpellPlayed && card.onSpellPlayed.length > 0) keywords.add("spell-trigger");
  if (card.effect?.some((effect) => effect.kind === "temporary-buff")) keywords.add("temporary");
  const onDeath = [
    ...(card.onDeath ?? []),
    ...(CARD_RULE_DEATHRATTLES[card.id] ?? []),
  ];
  if (onDeath.length > 0) keywords.add("deathrattle");
  const extraEffects: readonly CardEffect[] =
    card.id === "void-ink-storm"
      ? [{ kind: "random-enemy-freeze", amount: 1 }]
      : [];
  return {
    ...card,
    keywords: Array.from(keywords),
    onDeath,
    effect: [...(card.effect ?? []), ...extraEffects],
  };
}

const RAW_CARD_CATALOG: readonly CardDefinition[] = Object.freeze([
  {
    id: "sun-dawn-scout",
    name: "晨辉斥候",
    description: "冲锋。",
    faction: "曜光",
    type: "unit",
    cost: 1,
    rarity: "普通",
    attack: 2,
    health: 1,
    keywords: ["charge"],
    traits: ["swift", "hunt"],
  },
  {
    id: "sun-mirror-warden",
    name: "镜盾守望者",
    description: "护盾。",
    faction: "曜光",
    type: "unit",
    cost: 2,
    rarity: "普通",
    attack: 2,
    health: 3,
    keywords: ["shield"],
    traits: ["bulwark", "craft"],
  },
  {
    id: "sun-banner-bearer",
    name: "曙色旗手",
    description: "激昂。登场时抽一张牌。",
    faction: "曜光",
    type: "unit",
    cost: 3,
    rarity: "稀有",
    attack: 3,
    health: 3,
    keywords: ["fury"],
    traits: ["arcane"],
    onPlay: [{ kind: "draw", count: 1 }],
  },
  {
    id: "sun-lion-guard",
    name: "曜原狮卫",
    description: "嘲讽。",
    faction: "曜光",
    type: "unit",
    cost: 4,
    rarity: "稀有",
    attack: 3,
    health: 6,
    keywords: ["taunt"],
    traits: ["bulwark", "arcane"],
  },
  {
    id: "sun-skyfire-roc",
    name: "焰羽巡天者",
    description: "冲锋。",
    faction: "曜光",
    type: "unit",
    cost: 5,
    rarity: "史诗",
    attack: 5,
    health: 4,
    keywords: ["charge"],
    traits: ["swift", "hunt"],
  },
  {
    id: "sun-focused-ray",
    name: "聚光灼流",
    description: "对一个敌方角色造成 2 点伤害。",
    faction: "曜光",
    type: "spell",
    cost: 1,
    rarity: "普通",
    school: "radiance",
    target: "enemy-character",
    effect: [{ kind: "damage", amount: 2 }],
  },
  {
    id: "sun-dew-blessing",
    name: "晨露祝福",
    description: "为一个友方角色恢复 4 点生命。",
    faction: "曜光",
    type: "spell",
    cost: 2,
    rarity: "普通",
    school: "radiance",
    target: "friendly-character",
    effect: [{ kind: "heal", amount: 4 }],
  },
  {
    id: "sun-daybreak-order",
    name: "破晓号令",
    description: "使一个友方单位获得 +2/+2。",
    faction: "曜光",
    type: "spell",
    cost: 3,
    rarity: "稀有",
    school: "radiance",
    target: "friendly-unit",
    effect: [{ kind: "buff", attack: 2, health: 2 }],
  },
  {
    id: "void-mist-lurker",
    name: "雾汐潜行者",
    description: "汲取。来自幽潮浅滩的敏捷猎手。",
    faction: "幽潮",
    type: "unit",
    cost: 1,
    rarity: "普通",
    attack: 1,
    health: 3,
    keywords: ["lifesteal"],
    traits: ["swift", "hunt"],
  },
  {
    id: "void-undertow-guard",
    name: "逆流卫士",
    description: "嘲讽。",
    faction: "幽潮",
    type: "unit",
    cost: 2,
    rarity: "普通",
    attack: 2,
    health: 4,
    keywords: ["taunt"],
    traits: ["bulwark"],
  },
  {
    id: "void-echo-mimic",
    name: "回声拟形",
    description: "护盾。",
    faction: "幽潮",
    type: "unit",
    cost: 3,
    rarity: "稀有",
    attack: 3,
    health: 3,
    keywords: ["shield"],
    traits: ["arcane", "craft"],
  },
  {
    id: "void-nightfin-raider",
    name: "夜鳍突袭者",
    description: "冲锋，激昂。",
    faction: "幽潮",
    type: "unit",
    cost: 4,
    rarity: "稀有",
    attack: 5,
    health: 3,
    keywords: ["charge", "fury"],
    traits: ["swift", "hunt"],
  },
  {
    id: "void-abyss-whale",
    name: "渊歌巨鲸",
    description: "嘲讽。",
    faction: "幽潮",
    type: "unit",
    cost: 6,
    rarity: "史诗",
    attack: 6,
    health: 7,
    keywords: ["taunt"],
    traits: ["bulwark", "arcane"],
  },
  {
    id: "void-chill-needle",
    name: "寒潮刺针",
    description: "对一个敌方角色造成 2 点伤害。",
    faction: "幽潮",
    type: "spell",
    cost: 1,
    rarity: "普通",
    school: "tide",
    target: "enemy-character",
    effect: [{ kind: "damage", amount: 2 }],
  },
  {
    id: "void-moonless-surge",
    name: "无月涌流",
    description: "抽两张牌。",
    faction: "幽潮",
    type: "spell",
    cost: 3,
    rarity: "普通",
    school: "tide",
    target: "none",
    effect: [{ kind: "draw", count: 2 }],
  },
  {
    id: "void-ink-storm",
    name: "墨云震荡",
    description: "对所有敌方角色造成 1 点伤害，并随机冻结一个敌方单位。",
    faction: "幽潮",
    type: "spell",
    cost: 4,
    rarity: "史诗",
    school: "tide",
    target: "none",
    effect: [{ kind: "damage-all-enemies", amount: 1 }],
  },
  {
    id: "neutral-moss-runner",
    name: "苔径奔行兽",
    description: "穿行于古老商路的小兽。",
    faction: "中立",
    type: "unit",
    cost: 1,
    rarity: "普通",
    attack: 1,
    health: 2,
    traits: ["swift", "hunt"],
  },
  {
    id: "neutral-clockwork-beetle",
    name: "发条甲虫",
    description: "可靠但吵闹的机械伙伴。",
    faction: "中立",
    type: "unit",
    cost: 2,
    rarity: "普通",
    attack: 3,
    health: 2,
    traits: ["swift", "craft"],
  },
  {
    id: "neutral-caravan-guard",
    name: "远途商队卫",
    description: "嘲讽。",
    faction: "中立",
    type: "unit",
    cost: 3,
    rarity: "普通",
    attack: 2,
    health: 5,
    keywords: ["taunt"],
    traits: ["bulwark", "craft"],
  },
  {
    id: "neutral-stonehorn",
    name: "石角驮兽",
    description: "激昂。沉稳强壮的荒原驮兽。",
    faction: "中立",
    type: "unit",
    cost: 4,
    rarity: "普通",
    attack: 4,
    health: 5,
    keywords: ["fury"],
    traits: ["bulwark", "hunt"],
  },
  {
    id: "neutral-wandering-alchemist",
    name: "云游调剂师",
    description: "汲取。登场时为一个友方角色恢复 2 点生命。",
    faction: "中立",
    type: "unit",
    cost: 3,
    rarity: "稀有",
    attack: 3,
    health: 3,
    keywords: ["lifesteal"],
    traits: ["arcane"],
    target: "friendly-character",
    onPlay: [{ kind: "heal", amount: 2 }],
  },
  {
    id: "neutral-tactical-map",
    name: "折痕战术图",
    description: "抽一张牌。",
    faction: "中立",
    type: "spell",
    cost: 2,
    rarity: "普通",
    school: "construct",
    target: "none",
    effect: [{ kind: "draw", count: 1 }],
  },
  {
    id: "neutral-repair-sprite",
    name: "修补精灵",
    description: "登场时抽一张牌。",
    faction: "中立",
    type: "unit",
    cost: 2,
    rarity: "稀有",
    attack: 2,
    health: 2,
    traits: ["arcane", "craft"],
    onPlay: [{ kind: "draw", count: 1 }],
  },
  {
    id: "neutral-thunder-egg",
    name: "蕴雷晶卵",
    description: "护盾。",
    faction: "中立",
    type: "unit",
    cost: 5,
    rarity: "传说",
    attack: 5,
    health: 5,
    keywords: ["shield"],
    traits: ["craft"],
  },
  ...CORE_EXPANSION_CARDS,
  ...EMBER_ASTRAL_CARDS,
  ...VERDANT_STORM_CARDS,
]);

export const CARD_CATALOG: readonly CardDefinition[] = Object.freeze(
  RAW_CARD_CATALOG.map(enrichCardRules),
);

export const CARD_BY_ID: Readonly<Record<string, CardDefinition>> =
  Object.freeze(
    Object.fromEntries(CARD_CATALOG.map((card) => [card.id, card])),
  );

const SUN_STARTER_CARD_IDS = [
  "sun-dawn-scout",
  "sun-mirror-warden",
  "sun-banner-bearer",
  "sun-lion-guard",
  "sun-skyfire-roc",
  "sun-focused-ray",
  "sun-orbit-insight",
  "sun-daybreak-order",
  "neutral-moss-runner",
  "neutral-clockwork-beetle",
  "neutral-caravan-guard",
  "neutral-stonehorn",
  "neutral-relic-appraiser",
  "sun-supernova-judgment",
  "sun-dawn-muster",
] as const;

const VOID_STARTER_CARD_IDS = [
  "void-mist-lurker",
  "void-undertow-guard",
  "void-echo-mimic",
  "void-nightfin-raider",
  "void-abyss-whale",
  "void-chill-needle",
  "void-moonpool-mutation",
  "void-ink-storm",
  "neutral-moss-runner",
  "neutral-clockwork-beetle",
  "neutral-caravan-guard",
  "neutral-stonehorn",
  "neutral-wandering-alchemist",
  "void-maelstrom-memory",
  "void-echoing-current",
] as const;

export const DEFAULT_STARTER_DECK: readonly string[] = Object.freeze(
  SUN_STARTER_CARD_IDS.flatMap((cardId) => [cardId, cardId]),
);

export const DEFAULT_OPPONENT_DECK: readonly string[] = Object.freeze(
  VOID_STARTER_CARD_IDS.flatMap((cardId) => [cardId, cardId]),
);

// Concise aliases are kept for UI and persistence callers.
export const STARTER_DECK = DEFAULT_STARTER_DECK;
export const OPPONENT_STARTER_DECK = DEFAULT_OPPONENT_DECK;
