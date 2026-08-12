import { CARD_CATALOG } from "./catalog.ts";
import { validateDeck } from "./deck.ts";
import type { CardDefinition, CardEffect, Faction, Keyword } from "./types.ts";

export interface AiArchetype {
  id: string;
  name: string;
  faction: Faction;
  description: string;
  deck: readonly string[];
}

interface ArchetypeProfile {
  keywords: readonly Keyword[];
  curve: readonly number[];
  preferredEffects: readonly CardEffect["kind"][];
}

const ARCHETYPE_PROFILES: Readonly<Record<Faction, ArchetypeProfile>> = Object.freeze({
  曜光: {
    keywords: ["shield", "taunt", "charge", "battlecry"],
    curve: [1, 2, 2, 3, 4, 5, 6, 8],
    preferredEffects: ["heal", "buff", "buff-all-friendly", "draw", "secret"],
  },
  幽潮: {
    keywords: ["freeze", "lifesteal", "windfury", "taunt", "discover"],
    curve: [1, 2, 3, 4, 4, 5, 6, 8],
    preferredEffects: ["damage-all-enemies", "random-enemy-freeze", "silence", "draw", "secret"],
  },
  烬火: {
    keywords: ["charge", "fury", "battlecry", "overload", "windfury"],
    curve: [1, 1, 2, 3, 3, 4, 5, 7],
    preferredEffects: ["damage", "random-enemy-damage", "temporary-buff", "draw", "overload"],
  },
  星穹: {
    keywords: ["discover", "shield", "lifesteal", "battlecry", "taunt"],
    curve: [1, 2, 3, 4, 5, 6, 7, 8],
    preferredEffects: ["discover", "draw", "heal", "buff", "transform"],
  },
  苍林: {
    keywords: ["deathrattle", "reborn", "lifesteal", "taunt", "discover"],
    curve: [0, 1, 2, 3, 4, 5, 7, 8],
    preferredEffects: ["summon", "heal", "buff", "discover", "secret"],
  },
  雷铸: {
    keywords: ["overload", "spell-trigger", "charge", "shield", "battlecry"],
    curve: [0, 1, 2, 3, 4, 5, 7, 8],
    preferredEffects: ["random-enemy-damage", "damage-all-enemies", "discover", "draw", "secret"],
  },
  中立: {
    keywords: ["tradeable", "combo", "choose-one", "spell-damage", "taunt"],
    curve: [1, 2, 3, 4, 5, 6, 7, 8],
    preferredEffects: ["draw", "discover", "buff", "temporary-buff", "secret"],
  },
});

function effectKinds(card: CardDefinition): CardEffect["kind"][] {
  return [
    ...(card.effect ?? []),
    ...(card.onPlay ?? []),
    ...(card.combo ?? []),
  ].map((effect) => effect.kind);
}

function cardScore(card: CardDefinition, profile: ArchetypeProfile): number {
  const keywords = card.keywords ?? [];
  const effects = effectKinds(card);
  const curveScore = profile.curve.reduce(
    (score, cost, index) => score + (cost === card.cost ? 7 - Math.min(index, 6) * 0.35 : 0),
    0,
  );
  const keywordScore = profile.keywords.reduce(
    (score, keyword) => score + (keywords.includes(keyword) ? 7 : 0),
    0,
  );
  const effectScore = profile.preferredEffects.reduce(
    (score, kind) => score + (effects.includes(kind) ? 4 : 0),
    0,
  );
  const typeScore = card.type === "weapon" ? 8 : card.type === "spell" ? 2 : 1;
  const highRarityScore = card.rarity === "传说" ? 2 : card.rarity === "史诗" ? 1 : 0;
  return curveScore + keywordScore + effectScore + typeScore + highRarityScore + card.cost * 0.02;
}

function pickCards(
  cards: readonly CardDefinition[],
  count: number,
  profile: ArchetypeProfile,
  allowLegendary = true,
): CardDefinition[] {
  const selected: CardDefinition[] = [];
  let legendaryTaken = false;
  const candidates = [...cards].sort((left, right) => {
    return cardScore(right, profile) - cardScore(left, profile) ||
      left.cost - right.cost ||
      left.id.localeCompare(right.id, "en");
  });

  const canTake = (card: CardDefinition): boolean =>
    !selected.some((entry) => entry.id === card.id) &&
    (allowLegendary || card.rarity !== "传说") &&
    (card.rarity !== "传说" || !legendaryTaken);

  // First reserve one slot for each requested curve beat. This prevents a
  // keyword-heavy faction from accidentally producing a pile of 2/3-cost
  // cards with no mid-game or finisher window.
  for (const targetCost of profile.curve) {
    if (selected.length >= count) break;
    const candidate = candidates.find((card) => card.cost === targetCost && canTake(card));
    if (!candidate) continue;
    selected.push(candidate);
    if (candidate.rarity === "传说") legendaryTaken = true;
  }

  for (const card of candidates) {
    if (selected.length >= count) break;
    if (!canTake(card)) continue;
    selected.push(card);
    if (card.rarity === "传说") legendaryTaken = true;
  }
  return selected;
}

/**
 * Build a deterministic, legal 30-card AI deck with a real curve and a
 * faction identity. Each deck reserves space for five tactical cards and a
 * weapon when that faction has one, then fills the remaining slots with
 * units scored by the archetype's keyword/effect preferences.
 */
export function buildAiArchetypeDeck(
  faction: Faction,
  profile: ArchetypeProfile = ARCHETYPE_PROFILES[faction],
): readonly string[] {
  const factionCards = CARD_CATALOG.filter((card) => card.faction === faction);
  const weapon = pickCards(
    factionCards.filter((card) => card.type === "weapon"),
    1,
    profile,
  );
  const weaponHasLegendary = weapon.some((card) => card.rarity === "传说");
  const units = pickCards(
    factionCards.filter((card) => card.type === "unit"),
    9,
    profile,
    !weaponHasLegendary,
  );
  const unitHasLegendary = units.some((card) => card.rarity === "传说");
  const spells = pickCards(
    factionCards.filter((card) => card.type === "spell"),
    5,
    profile,
    !weaponHasLegendary && !unitHasLegendary,
  );
  const selected = [...units, ...spells, ...weapon];
  const deck = selected.flatMap((card) =>
    card.rarity === "传说" ? [card.id] : [card.id, card.id],
  );

  // One legendary occupies one slot, so fill its missing second copy with a
  // non-legendary signature card while preserving the normal 30-card size.
  const selectedIds = new Set(selected.map((card) => card.id));
  while (deck.length < 30) {
    const counts = new Map<string, number>();
    for (const cardId of deck) counts.set(cardId, (counts.get(cardId) ?? 0) + 1);
    const filler = factionCards.find(
      (card) => card.rarity !== "传说" && (counts.get(card.id) ?? 0) < 2,
    ) ?? factionCards.find((card) => card.rarity !== "传说" && !selectedIds.has(card.id));
    if (!filler) break;
    deck.push(filler.id);
  }

  const validation = validateDeck(deck);
  if (!validation.valid || deck.length !== 30) {
    throw new Error(`无法生成${faction} AI 牌组：${validation.errors.map((error) => error.message).join(" ")}`);
  }
  return Object.freeze(deck);
}

export const AI_ARCHETYPES: readonly AiArchetype[] = Object.freeze([
  {
    id: "radiance-midrange",
    name: "曜光 · 棱镜守线",
    faction: "曜光",
    description: "护盾、嘲讽与增益，先稳住战线再用高费核心收束战局。",
    deck: buildAiArchetypeDeck("曜光"),
  },
  {
    id: "tide-control",
    name: "幽潮 · 逆流控场",
    faction: "幽潮",
    description: "冻结、汲取与反制，擅长拖长战局并把资源差滚起来。",
    deck: buildAiArchetypeDeck("幽潮"),
  },
  {
    id: "ember-rush",
    name: "烬火 · 熔线突袭",
    faction: "烬火",
    description: "低费冲锋、激昂与直伤，前期压力强，过载换取爆发。",
    deck: buildAiArchetypeDeck("烬火"),
  },
  {
    id: "astral-value",
    name: "星穹 · 观测增值",
    faction: "星穹",
    description: "发现、抽牌与高费护盾核心，后期资源厚度最高。",
    deck: buildAiArchetypeDeck("星穹"),
  },
  {
    id: "verdant-rebirth",
    name: "苍林 · 根系复生",
    faction: "苍林",
    description: "复生、亡语和治疗，持续铺场并用大体型单位换取胜势。",
    deck: buildAiArchetypeDeck("苍林"),
  },
  {
    id: "storm-overload",
    name: "雷铸 · 过载炮台",
    faction: "雷铸",
    description: "过载、法术触发和范围伤害，压制宽战场并滚动护甲。",
    deck: buildAiArchetypeDeck("雷铸"),
  },
  {
    id: "neutral-toolbox",
    name: "中立 · 商路工具箱",
    faction: "中立",
    description: "交易、连击、抉择和法术伤害，靠灵活换牌寻找最佳解。",
    deck: buildAiArchetypeDeck("中立"),
  },
]);
