import type { CardDefinition, CardEffect, CardTargetRule, Keyword, MinionType } from "./types.ts";
import { cardSetForFactionOrdinal } from "./formats.ts";
import { CORE_EXPANSION_CARDS } from "./catalog-core-expansion.ts";
import { EMBER_ASTRAL_CARDS } from "./catalog-ember-astral.ts";
import { VERDANT_STORM_CARDS } from "./catalog-verdant-storm.ts";
import { EXPANDED_CARD_CATALOG } from "./catalog-extended.ts";

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
  if (card.tradeable) keywords.add("tradeable");
  if (card.preparable) keywords.add("prepare");
  if (card.bribe) keywords.add("bribe");
  if (card.disguised) keywords.add("disguised");
  if (card.shatter) keywords.add("shatter");
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

const EXPLICIT_MINION_TYPES: Readonly<Record<string, readonly MinionType[]>> = {
  "void-echo-mimic": ["all"],
  "neutral-clockwork-beetle": ["beast", "construct"],
  "neutral-riveted-ram": ["beast", "construct"],
  "neutral-gearhawk-handler": ["beast", "construct"],
  "neutral-repair-sprite": ["construct", "spirit"],
  "neutral-stonehorn": ["beast"],
};

const MINION_TYPE_NAME_PATTERNS: readonly [MinionType, RegExp][] = [
  ["dragon", /龙|多首/],
  ["undead", /亡灵|不死|尸|骸|枯骨|骨龙|墓穴|亡者|死者/],
  ["construct", /机械|魔像|机甲|构装|发条|齿隼|铆钉|熔铸炉|自走|壁垒机|线圈|雷轮|哨机|钟表|时钟|傀儡|铠像/],
  ["tideborn", /潮裔|鱼人|鳍|鲨|鲸|鳗|海妖|潮民|水母|章鱼|乌贼|蟹|虾/],
  ["raider", /海盗|私掠|掠夺|舰长|船长|水手|劫掠/],
  ["elemental", /元素|火灵|焰灵|冰灵|雷灵|风灵|土灵|岩灵|熔岩|烈焰|霜核|雷核|焰核|沙暴|晶卵/],
  ["spirit", /灵体|幽灵|魂|精灵|幻灵|梦灵|灵狐|怨灵|影灵/],
  ["beast", /兽|狮|狼|鲸|鲨|鳗|鸟|鹰|隼|鹿|羊|龟|螨|獾|犬|虫|凤凰|狮鹫|鳍|鸦|熊|蛛|蛇|蛙|鱼|鳄|豹|虎|狐|犀|象|猿|蝠|蜂|蝶|蛾|螳|蝎|蜥|蟹|虾|章鱼|乌贼|水母/],
];

function inferMinionTypes(card: CardDefinition): readonly MinionType[] {
  if (card.type !== "unit") return [];
  const explicit = EXPLICIT_MINION_TYPES[card.id];
  if (explicit) return explicit;
  if (/拟态|拟形|变形怪|万象/.test(card.name)) return ["all"];
  const inferred = MINION_TYPE_NAME_PATTERNS
    .filter(([, pattern]) => pattern.test(card.name))
    .map(([minionType]) => minionType);
  return [...new Set(inferred)].slice(0, 2);
}

function enrichMinionTypeRules(card: CardDefinition): CardDefinition {
  if (card.type !== "unit") return card;
  const minionTypes = [...(card.minionTypes ?? inferMinionTypes(card))];
  if (card.id === "neutral-relic-appraiser") {
    return {
      ...card,
      description: "法术伤害 +1。战吼：从牌库抽一张构装单位。真品总会回应懂行的人。",
      keywords: [...new Set([...(card.keywords ?? []), "battlecry" as const])],
      minionTypes,
      onPlay: [{ kind: "draw-minion-type", minionType: "construct", count: 1 }],
    };
  }
  if (card.id === "neutral-gearhawk-handler") {
    return {
      ...card,
      description: "护盾。战吼：使其他友方构装获得 +1/+1。她与机械猎隼共享警戒视野。",
      keywords: [...new Set([...(card.keywords ?? []), "battlecry" as const])],
      minionTypes,
      onPlay: [{
        kind: "buff-friendly-minion-type",
        minionType: "construct",
        attack: 1,
        health: 1,
        excludeSource: true,
      }],
    };
  }
  return { ...card, minionTypes };
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
  ...EXPANDED_CARD_CATALOG,
]);

const factionOrdinals = new Map<CardDefinition["faction"], number>();

const SCARAB_BRIBE_CARD_IDS = new Set([
  "sun-season-spell-05",
  "void-season-spell-05",
  "neutral-season-spell-05",
  "ember-calamity-verdict",
  "astral-deep-divination",
  "verdant-flourishing-chorus",
  "storm-season-spell-05",
  "frost-season-spell-04",
  "sand-season-spell-04",
  "bloodmoon-season-spell-04",
  "leyline-season-spell-04",
  "dusk-season-spell-04",
  "cloudfall-season-spell-04",
  "magnet-season-spell-04",
  "crystal-season-spell-04",
  "dream-season-spell-04",
  "rift-season-spell-04",
  "timesand-season-spell-04",
  "gloomwood-season-spell-04",
  "firmament-season-spell-04",
]);

const SCARAB_DISGUISED_CARD_IDS = new Set([
  "sun-season-03",
  "void-season-03",
  "neutral-season-03",
  "ember-season-03",
  "astral-season-03",
  "verdant-season-03",
  "storm-season-03",
  "frost-season-27",
  "sand-season-27",
  "bloodmoon-season-27",
  "leyline-season-27",
  "dusk-season-27",
  "cloudfall-season-27",
  "magnet-season-27",
  "crystal-season-27",
  "dream-season-27",
  "rift-season-27",
  "timesand-season-27",
  "gloomwood-season-27",
  "firmament-season-27",
]);

const RAPTOR_SHATTER_CARDS: Readonly<Record<string, {
  description: string;
  left: readonly CardEffect[];
  right: readonly CardEffect[];
  leftTarget?: CardTargetRule;
  rightTarget?: CardTargetRule;
}>> = {
  "neutral-cloudrail-behemoth": {
    description: "破碎。左片：对一个敌方角色造成 3 点伤害。右片：对一个敌方角色造成 4 点伤害。重组后恢复原本的 7 点伤害。",
    left: [{ kind: "damage", amount: 3 }],
    right: [{ kind: "damage", amount: 4 }],
    leftTarget: "enemy-character",
    rightTarget: "enemy-character",
  },
  "ember-cinder-dispatch": {
    description: "破碎。左片：抽 1 张牌。右片：随机对一个敌方角色造成 1 点伤害。重组后同时结算。",
    left: [{ kind: "draw", count: 1 }],
    right: [{ kind: "random-enemy-damage", amount: 1 }],
  },
  "astral-lucid-script": {
    description: "破碎。左片：抽 1 张牌。右片：为一个友方角色恢复 2 点生命。重组后同时结算。",
    left: [{ kind: "draw", count: 1 }],
    right: [{ kind: "heal", amount: 2 }],
    leftTarget: "none",
    rightTarget: "friendly-character",
  },
  "verdant-rooting-rite": {
    description: "破碎。左片：使一个友方单位获得 +1 攻击。右片：使一个友方单位获得 +3 生命。重组后恢复原本的 +1/+3。",
    left: [{ kind: "buff", attack: 1, health: 0 }],
    right: [{ kind: "buff", attack: 0, health: 3 }],
    leftTarget: "friendly-unit",
    rightTarget: "friendly-unit",
  },
  "storm-emergency-plating": {
    description: "破碎。左右片各使一个友方单位获得 +1 生命。重组后恢复原本的 +0/+2。",
    left: [{ kind: "buff", attack: 0, health: 1 }],
    right: [{ kind: "buff", attack: 0, health: 1 }],
    leftTarget: "friendly-unit",
    rightTarget: "friendly-unit",
  },
};

const SCARAB_COLOSSAL_CARDS: Readonly<Record<string, NonNullable<CardDefinition["colossal"]>>> = {
  "void-season-08": {
    parts: [{
      id: "void-season-08-appendage",
      name: "深潮巨鳍",
      attack: 2,
      health: 3,
      keywords: ["lifesteal"],
      effect: [{ kind: "armor", amount: 1 }],
    }],
  },
  "ember-season-08": {
    parts: [{
      id: "ember-season-08-appendage",
      name: "熔核巨爪",
      attack: 3,
      health: 2,
      keywords: ["rush"],
      effect: [{ kind: "random-enemy-damage", amount: 1 }],
    }],
  },
  "storm-season-08": {
    parts: [{
      id: "storm-season-08-appendage",
      name: "雷甲侧翼",
      attack: 2,
      health: 4,
      keywords: ["shield"],
      effect: [{ kind: "armor", amount: 1 }],
    }],
  },
  "dusk-season-32": {
    parts: [{
      id: "dusk-season-32-appendage",
      name: "暮影潜肢",
      attack: 3,
      health: 2,
      keywords: ["stealth"],
      effect: [{ kind: "draw", count: 1 }],
    }],
  },
  "rift-season-32": {
    parts: [{
      id: "rift-season-32-appendage",
      name: "裂星冲角",
      attack: 4,
      health: 1,
      keywords: ["charge"],
      effect: [{ kind: "random-enemy-damage", amount: 1 }],
    }],
  },
  "firmament-season-32": {
    parts: [{
      id: "firmament-season-32-appendage",
      name: "天穹承柱",
      attack: 2,
      health: 5,
      keywords: ["taunt"],
      effect: [{ kind: "buff-all-friendly", attack: 0, health: 1 }],
    }],
  },
};

const SCARAB_HERALD_CARDS: Readonly<Record<string, string>> = {
  "void-season-01": "void-season-08",
  "void-season-04": "void-season-08",
  "ember-season-01": "ember-season-08",
  "ember-season-04": "ember-season-08",
  "storm-season-01": "storm-season-08",
  "storm-season-04": "storm-season-08",
  "dusk-season-26": "dusk-season-32",
  "dusk-season-28": "dusk-season-32",
  "rift-season-26": "rift-season-32",
  "rift-season-28": "rift-season-32",
  "firmament-season-26": "firmament-season-32",
  "firmament-season-28": "firmament-season-32",
};

export const CATACLYSM_DRAGON_CARD_IDS = Object.freeze([
  "generated-emberwing-matriarch",
  "generated-tidecoil-leviathan",
  "generated-thundercrown-drake",
  "generated-riftmaw-tyrant",
  "generated-skyvault-guardian",
] as const);

/**
 * Match-only cards stay out of the 1,000-card collection but are resolvable by
 * the reducer and battle clients when a Hero Card generates them.
 */
export const GENERATED_CARD_DEFINITIONS: readonly CardDefinition[] = Object.freeze([
  {
    id: "generated-emberwing-matriarch",
    name: "熔翼龙母",
    description: "传说龙裔。突袭。",
    faction: "中立",
    type: "unit",
    cost: 8,
    rarity: "传说",
    attack: 8,
    health: 8,
    keywords: ["rush"],
    minionTypes: ["dragon"],
    collectible: false,
  },
  {
    id: "generated-tidecoil-leviathan",
    name: "潮盘巨龙",
    description: "传说龙裔。吸血。",
    faction: "中立",
    type: "unit",
    cost: 8,
    rarity: "传说",
    attack: 6,
    health: 10,
    keywords: ["lifesteal"],
    minionTypes: ["dragon"],
    collectible: false,
  },
  {
    id: "generated-thundercrown-drake",
    name: "雷冠天龙",
    description: "传说龙裔。护盾。",
    faction: "中立",
    type: "unit",
    cost: 8,
    rarity: "传说",
    attack: 7,
    health: 9,
    keywords: ["shield"],
    minionTypes: ["dragon"],
    collectible: false,
  },
  {
    id: "generated-riftmaw-tyrant",
    name: "裂界暴龙",
    description: "传说龙裔。冲锋。",
    faction: "中立",
    type: "unit",
    cost: 8,
    rarity: "传说",
    attack: 9,
    health: 7,
    keywords: ["charge"],
    minionTypes: ["dragon"],
    collectible: false,
  },
  {
    id: "generated-skyvault-guardian",
    name: "穹库守望龙",
    description: "传说龙裔。嘲讽。",
    faction: "中立",
    type: "unit",
    cost: 8,
    rarity: "传说",
    attack: 8,
    health: 12,
    keywords: ["taunt"],
    minionTypes: ["dragon"],
    collectible: false,
  },
  {
    id: "generated-worldbreaker-progeny",
    name: "灭世龙裔",
    description: "由灭世灾变召来的 12/12 龙裔。",
    faction: "中立",
    type: "unit",
    cost: 10,
    rarity: "传说",
    attack: 12,
    health: 12,
    minionTypes: ["dragon"],
    collectible: false,
  },
]);

const WORLD_BREAKER_HERO_CARD_ID = "neutral-season-08";

const WORLD_BREAKER_HERO_CARD: NonNullable<CardDefinition["heroCard"]> = {
  heroId: "hero-scarlet-worldbreaker",
  heroName: "赤曜灭世者",
  armor: 12,
  heroPower: {
    id: "hero-power-ruthless-rend",
    faction: "中立",
    name: "残酷撕裂",
    description: "本回合获得 +5 攻击。",
    cost: 2,
    effect: { kind: "gain-attack", amount: 5 },
  },
  options: [
    {
      label: "崩岳：摧毁生命最高的敌方单位",
      effects: [{ kind: "destroy-highest-health-enemy" }],
    },
    {
      label: "焚世：对所有敌方单位造成 4 点伤害",
      effects: [{ kind: "damage-all-enemy-units", amount: 4 }],
    },
    {
      label: "役龙：洗入五张费用为 1 的随机传说龙裔",
      effects: [{
        kind: "shuffle-random-into-deck",
        cardIds: CATACLYSM_DRAGON_CARD_IDS,
        count: 5,
        cost: 1,
      }],
    },
    {
      label: "龙裔君临：召唤一个 12/12 的灭世龙裔",
      effects: [{ kind: "summon", cardId: "generated-worldbreaker-progeny", count: 1 }],
    },
  ],
  scalesWithHerald: true,
};

export const CARD_CATALOG = Object.freeze(
  RAW_CARD_CATALOG.map((rawCard) => {
    const ordinal = factionOrdinals.get(rawCard.faction) ?? 0;
    factionOrdinals.set(rawCard.faction, ordinal + 1);
    const set = cardSetForFactionOrdinal(ordinal);
    const enrichedCard = enrichCardRules(rawCard);
    const card: CardDefinition = rawCard.id === WORLD_BREAKER_HERO_CARD_ID
      ? {
          ...enrichedCard,
          name: "赤曜灭世者",
          description: "英雄牌。战吼：选择要释放的灭世灾变。每使用两次先驱，额外选择一个；四次后释放全部四个灾变。",
          type: "hero",
          cost: 10,
          rarity: "传说",
          attack: undefined,
          health: undefined,
          durability: undefined,
          overload: undefined,
          combo: [],
          spellDamage: undefined,
          onTurnStart: [],
          onTurnEnd: [],
          onSpellPlayed: [],
          tradeable: false,
          preparable: false,
          bribe: false,
          disguised: false,
          shatter: undefined,
          herald: undefined,
          colossal: undefined,
          traits: [],
          keywords: [],
          school: undefined,
          target: "none",
          effect: [],
          onPlay: [],
          onDeath: [],
          heroCard: WORLD_BREAKER_HERO_CARD,
        }
      : enrichedCard;
    const preparable = set === "scarab-2026" && card.cost === 8;
    const bribe = set === "scarab-2026" && SCARAB_BRIBE_CARD_IDS.has(card.id);
    const disguised = set === "scarab-2026" && SCARAB_DISGUISED_CARD_IDS.has(card.id);
    const shatter = set === "raptor-2025" ? RAPTOR_SHATTER_CARDS[card.id] : undefined;
    const colossal = set === "scarab-2026" ? SCARAB_COLOSSAL_CARDS[card.id] : undefined;
    const heraldColossalCardId = set === "scarab-2026" ? SCARAB_HERALD_CARDS[card.id] : undefined;
    return enrichMinionTypeRules({
      ...card,
      ...(preparable
        ? {
            description: `预备。${card.description}`,
            keywords: [...new Set([...(card.keywords ?? []), "prepare" as const])],
            preparable: true,
          }
        : {}),
      ...(bribe
        ? {
            description: `贿赂：对手抽 1 张牌。${card.description}`,
            effect: [...(card.effect ?? []), { kind: "draw-opponent" as const, count: 1 }],
            keywords: [...new Set([...(card.keywords ?? []), "bribe" as const])],
            bribe: true,
          }
        : {}),
      ...(disguised
        ? {
            description: `伪装。可部署到任一方战场。回合结束：对其控制者的核心造成 1 点伤害。${card.description}`,
            keywords: [...new Set([...(card.keywords ?? []), "disguised" as const, "end-of-turn" as const])],
            onTurnEnd: [...(card.onTurnEnd ?? []), { kind: "damage-friendly-hero" as const, amount: 1 }],
            disguised: true,
          }
        : {}),
      ...(shatter
        ? {
            description: shatter.description,
            keywords: [...new Set([...(card.keywords ?? []), "shatter" as const])],
            shatter: {
              left: [...shatter.left],
              right: [...shatter.right],
              leftTarget: shatter.leftTarget,
              rightTarget: shatter.rightTarget,
            },
          }
        : {}),
      ...(heraldColossalCardId
        ? {
            description: `先驱：召唤一名继承所属巨型附肢力量的士兵。每使用两次先驱，该巨型、附肢与士兵的数值翻倍。${card.description}`,
            keywords: [...new Set([...(card.keywords ?? []), "herald" as const])],
            herald: { colossalCardId: heraldColossalCardId },
          }
        : {}),
      ...(colossal
        ? {
            description: `${preparable ? "预备。" : ""}巨型：召唤时组装 ${colossal.parts.length} 个附肢；每使用两次先驱，本体、附肢与附肢效果翻倍。${card.description}`,
            keywords: [
              ...new Set([
                ...(card.keywords ?? []),
                ...(preparable ? ["prepare" as const] : []),
                "colossal" as const,
              ]),
            ],
            colossal,
          }
        : {}),
      set,
    });
  }),
);

export const CARD_BY_ID: Readonly<Record<string, CardDefinition>> =
  Object.freeze(
    Object.fromEntries(
      [...CARD_CATALOG, ...GENERATED_CARD_DEFINITIONS].map((card) => [card.id, card]),
    ),
  );

export { EXPANDED_FACTION_THEMES, factionTheme } from "./catalog-extended.ts";

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
