import type { CardDefinition, CardRarity, Faction, Keyword, SpellSchool } from "./types.js";

export interface FactionTheme {
  faction: Faction;
  slug: string;
  sigil: string;
  doctrine: string;
  tone: string;
  school: SpellSchool;
  nouns: readonly string[];
  roles: readonly string[];
  keywords: readonly Keyword[];
  offset: number;
}

/** The live card set is intentionally data-driven: every theme exposes the
 * same 50-card distribution, which keeps pack odds, AI decks, and collection
 * filters consistent as new seasons add more factions. */
export const EXPANDED_FACTION_THEMES: readonly FactionTheme[] = Object.freeze([
  { faction: "曜光", slug: "sun", sigil: "☼", doctrine: "护盾 · 增益", tone: "sun", school: "radiance", nouns: ["晨辉", "棱镜", "白昼", "曙冠"], roles: ["斥候", "守望者", "旗手", "铸师"], keywords: ["shield", "taunt", "charge", "battlecry"], offset: 0 },
  { faction: "幽潮", slug: "void", sigil: "◒", doctrine: "汲取 · 手牌", tone: "void", school: "tide", nouns: ["深潮", "雾汐", "夜鳍", "沉湾"], roles: ["潜行者", "引潮者", "掠夺者", "祭司"], keywords: ["lifesteal", "freeze", "windfury", "discover"], offset: 1 },
  { faction: "中立", slug: "neutral", sigil: "◇", doctrine: "通用 · 巧铸", tone: "neutral", school: "construct", nouns: ["远途", "齿轮", "商路", "荒原"], roles: ["旅者", "工匠", "护卫", "策士"], keywords: ["tradeable", "combo", "taunt", "spell-damage"], offset: 2 },
  { faction: "烬火", slug: "ember", sigil: "△", doctrine: "冲锋 · 直伤", tone: "ember", school: "ember", nouns: ["熔火", "赤焰", "焦岩", "灰烬"], roles: ["先锋", "决斗家", "祭司", "战兽"], keywords: ["charge", "fury", "rush", "windfury"], offset: 3 },
  { faction: "星穹", slug: "astral", sigil: "✦", doctrine: "秘契 · 护盾", tone: "astral", school: "astral", nouns: ["星穹", "彗尾", "星图", "天琴"], roles: ["观测者", "织星师", "守门人", "秘契者"], keywords: ["discover", "shield", "lifesteal", "taunt"], offset: 4 },
  { faction: "苍林", slug: "verdant", sigil: "♧", doctrine: "治疗 · 猎痕", tone: "verdant", school: "verdant", nouns: ["根须", "苔径", "月蕨", "世界根"], roles: ["守林人", "猎手", "shaman", "护根者"], keywords: ["deathrattle", "reborn", "lifesteal", "taunt"], offset: 5 },
  { faction: "雷铸", slug: "storm", sigil: "ϟ", doctrine: "巧铸 · 激昂", tone: "storm", school: "storm", nouns: ["雷铸", "电弧", "铜轨", "风暴"], roles: ["炮台", "信使", "机师", "雷王"], keywords: ["overload", "spell-trigger", "charge", "shield"], offset: 6 },
  { faction: "霜境", slug: "frost", sigil: "❄", doctrine: "冻结 · 冰甲", tone: "frost", school: "tide", nouns: ["霜境", "冰冠", "雪脉", "寒星"], roles: ["冰卫", "冻原猎手", "晶龙", "观测者"], keywords: ["freeze", "taunt", "shield", "reborn"], offset: 7 },
  { faction: "砂海", slug: "sand", sigil: "⌁", doctrine: "沙暴 · 资源", tone: "sand", school: "construct", nouns: ["砂海", "风蚀", "黄昏", "沙舟"], roles: ["游侠", "商队长", "掘金者", "风暴使"], keywords: ["rush", "tradeable", "discover", "fury"], offset: 8 },
  { faction: "赤月", slug: "bloodmoon", sigil: "☾", doctrine: "献祭 · 吸血", tone: "bloodmoon", school: "ember", nouns: ["赤月", "猩红", "血契", "夜宴"], roles: ["祭刃", "猎魔人", "血骑", "契约师"], keywords: ["lifesteal", "fury", "stealth", "deathrattle"], offset: 9 },
  { faction: "灵脉", slug: "leyline", sigil: "⌬", doctrine: "法术 · 共鸣", tone: "leyline", school: "astral", nouns: ["灵脉", "共鸣", "符文", "源流"], roles: ["术士", "符文师", "回路守卫", "灵能体"], keywords: ["spell-damage", "discover", "spell-trigger", "combo"], offset: 10 },
  { faction: "暮影", slug: "dusk", sigil: "◐", doctrine: "潜伏 · 反制", tone: "dusk", school: "tide", nouns: ["暮影", "暗巷", "无光", "薄暮"], roles: ["潜伏者", "刺客", "影卫", "窃密师"], keywords: ["stealth", "secret", "silence", "rush"], offset: 11 },
  { faction: "云瀑", slug: "cloudfall", sigil: "≋", doctrine: "风行 · 回旋", tone: "cloudfall", school: "storm", nouns: ["云瀑", "风脊", "天港", "流云"], roles: ["飞骑", "航海士", "风语者", "云兽"], keywords: ["windfury", "charge", "rush", "freeze"], offset: 12 },
  { faction: "磁风", slug: "magnet", sigil: "⊕", doctrine: "磁场 · 装配", tone: "magnet", school: "construct", nouns: ["磁风", "极轨", "铁潮", "反转"], roles: ["机甲", "磁轨师", "装配师", "极性兽"], keywords: ["shield", "overload", "battlecry", "taunt"], offset: 13 },
  { faction: "晶核", slug: "crystal", sigil: "◈", doctrine: "护晶 · 变形", tone: "crystal", school: "astral", nouns: ["晶核", "棱面", "折光", "矿心"], roles: ["晶卫", "切面师", "棱镜兽", "矿脉王"], keywords: ["transform", "shield", "reborn", "spell-damage"], offset: 14 },
  { faction: "梦境", slug: "dream", sigil: "✧", doctrine: "幻术 · 发现", tone: "dream", school: "astral", nouns: ["梦境", "幻潮", "睡莲", "星梦"], roles: ["织梦者", "梦魇", "入梦师", "幻兽"], keywords: ["discover", "secret", "stealth", "lifesteal"], offset: 15 },
  { faction: "裂星", slug: "rift", sigil: "✺", doctrine: "撕裂 · 直伤", tone: "rift", school: "ember", nouns: ["裂星", "陨痕", "断界", "星陨"], roles: ["碎片猎手", "裂界者", "陨石兽", "终结者"], keywords: ["spell-damage", "rush", "overload", "charge"], offset: 16 },
  { faction: "时砂", slug: "timesand", sigil: "⌛", doctrine: "延时 · 复写", tone: "timesand", school: "construct", nouns: ["时砂", "回环", "刻度", "沙漏"], roles: ["计时师", "回溯者", "时兽", "钟卫"], keywords: ["temporary", "start-of-turn", "end-of-turn", "discover"], offset: 17 },
  { faction: "幽森", slug: "gloomwood", sigil: "♠", doctrine: "亡语 · 毒荆", tone: "gloomwood", school: "verdant", nouns: ["幽森", "毒荆", "黑根", "腐花"], roles: ["森巫", "毒猎手", "荆棘兽", "腐木王"], keywords: ["poisonous", "deathrattle", "reborn", "stealth"], offset: 18 },
  { faction: "天穹", slug: "firmament", sigil: "⬡", doctrine: "巨像 · 终局", tone: "firmament", school: "radiance", nouns: ["天穹", "穹顶", "日冕", "云端"], roles: ["巨像", "圣卫", "穹顶龙", "终局者"], keywords: ["taunt", "charge", "shield", "battlecry"], offset: 19 },
]);

const THEME_BY_FACTION = new Map(EXPANDED_FACTION_THEMES.map((theme) => [theme.faction, theme]));
const EXISTING_FACTIONS = new Set<Faction>(["曜光", "幽潮", "中立", "烬火", "星穹", "苍林", "雷铸"]);

function rarityFor(index: number, count: number, allowLegendary: boolean): CardRarity {
  if (allowLegendary && index === count - 1) return "传说";
  if (index % 9 === 0) return "史诗";
  if (index % 3 === 0) return "稀有";
  return "普通";
}

function unitCard(theme: FactionTheme, index: number, count: number, allowLegendary: boolean): CardDefinition {
  const noun = theme.nouns[index % theme.nouns.length];
  const role = theme.roles[index % theme.roles.length];
  const cost = 1 + (index % 8);
  // Some Hearthstone keywords are spell-only (secret/discover) or require a
  // dedicated choice window. Keep them on generated spells instead of
  // shipping dead labels on minions.
  const unitKeywords = theme.keywords.filter(
    (candidate) => candidate !== "secret" && candidate !== "discover" && candidate !== "choose-one" && candidate !== "transform",
  );
  const keyword = unitKeywords[index % Math.max(unitKeywords.length, 1)] ?? "battlecry";
  const id = `${theme.slug}-season-${String(index + 1).padStart(2, "0")}`;
  const card: CardDefinition = {
    id,
    name: `${noun}${role}·${String(index + 1).padStart(2, "0")}`,
    description: `${keyword === "battlecry" ? "登场时触发战吼。" : keyword === "deathrattle" ? "亡语。" : `${keyword}。`} ${theme.faction}的战线单位。`,
    faction: theme.faction,
    type: "unit",
    cost,
    rarity: rarityFor(index, count, allowLegendary),
    attack: Math.max(1, cost + ((index + theme.offset) % 3) - 1),
    health: Math.max(1, cost + 1 + ((index * 2 + theme.offset) % 4)),
    keywords: [keyword],
    traits: [index % 2 === 0 ? "swift" : "bulwark", index % 3 === 0 ? "arcane" : "craft"],
  };
  if (index % 6 === 0) {
    card.onPlay = [{ kind: "draw", count: 1 }];
    card.target = "none";
    card.description = `${card.description} 登场时抽一张牌。`;
  } else if (index % 7 === 0) {
    card.target = "enemy-character";
    card.onPlay = [{ kind: "damage", amount: Math.min(3, 1 + Math.floor(cost / 4)) }];
    card.description = `${card.description} 登场时对一个敌方角色造成伤害。`;
  } else if (index % 11 === 0) {
    card.target = "friendly-unit";
    card.onPlay = [{ kind: "buff", attack: 1, health: 1 }];
    card.description = `${card.description} 登场时使一个友方单位获得 +1/+1。`;
  } else if (index % 13 === 0) {
    card.onDeath = [{ kind: "draw", count: 1 }];
    card.description = `${card.description} 亡语：抽一张牌。`;
  }

  // Back the printed keyword with a real reducer hook. These hooks are
  // intentionally small and deterministic so generated cards remain
  // balanced while still exercising the same rules as handcrafted cards.
  switch (keyword) {
    case "battlecry":
      if (!card.onPlay) {
        card.target = "none";
        card.onPlay = [{ kind: "draw", count: 1 }];
        card.description = `${card.description} 战吼：抽一张牌。`;
      }
      break;
    case "deathrattle":
      if (!card.onDeath) {
        card.onDeath = [{ kind: "draw", count: 1 }];
        card.description = `${card.description} 亡语：抽一张牌。`;
      }
      break;
    case "freeze":
      card.target = "enemy-unit";
      card.onPlay = [{ kind: "freeze", amount: 1 }];
      card.description = `冻结。${theme.faction}的战线单位。登场时冻结一个敌方单位。`;
      break;
    case "overload":
      card.overload = 1;
      card.description = `${card.description} 过载（1）。`;
      break;
    case "spell-trigger":
      card.onSpellPlayed = [{ kind: "draw", count: 1 }];
      card.description = `${card.description} 在你施放法术后抽一张牌。`;
      break;
    case "start-of-turn":
      card.onTurnStart = [{ kind: "armor", amount: 1 }];
      card.description = `${card.description} 回合开始：获得 1 点护甲。`;
      break;
    case "end-of-turn":
      card.onTurnEnd = [{ kind: "buff", attack: 1, health: 0 }];
      card.description = `${card.description} 回合结束：获得 +1 攻击。`;
      break;
    case "temporary":
      card.onTurnStart = [{ kind: "temporary-buff", attack: 1, health: 1, duration: "end-of-turn" }];
      card.description = `${card.description} 回合开始：本回合获得 +1/+1。`;
      break;
    case "combo":
      card.combo = [{ kind: "buff-all-friendly", attack: 1, health: 1 }];
      card.description = `${card.description} 连击：使所有友方单位获得 +1/+1。`;
      break;
    case "spell-damage":
      card.spellDamage = 1;
      card.description = `${card.description} 法术伤害 +1。`;
      break;
    case "silence":
      card.target = "enemy-unit";
      card.onPlay = [{ kind: "silence" }];
      card.description = `沉默。${theme.faction}的战线单位。登场时沉默一个敌方单位。`;
      break;
    case "tradeable":
      card.tradeable = true;
      card.description = `${card.description} 可交易。`;
      break;
    default:
      break;
  }
  return card;
}

function spellCard(theme: FactionTheme, index: number): CardDefinition {
  const noun = theme.nouns[(index + 1) % theme.nouns.length];
  const id = `${theme.slug}-season-spell-${String(index + 1).padStart(2, "0")}`;
  const mark = `·${String(index + 1).padStart(2, "0")}`;
  const cost = 1 + (index % 8);
  const mode = index % 6;
  if (theme.keywords.includes("secret") && index % 3 === 0) {
    const trigger = index % 2 === 0 ? "opponent-plays-spell" : "opponent-attacks-hero";
    const effect = trigger === "opponent-plays-spell"
      ? { kind: "counterspell" as const }
      : { kind: "damage-attacker" as const, amount: 2 };
    return {
      id,
      name: `${noun}秘契${mark}`,
      description: trigger === "opponent-plays-spell" ? "奥秘：敌方施放法术时反制该法术。" : "奥秘：敌方攻击时对攻击者造成 2 点伤害。",
      faction: theme.faction,
      type: "spell",
      cost,
      rarity: rarityFor(index, 14, false),
      school: theme.school,
      target: "none",
      keywords: ["secret"],
      effect: [{ kind: "secret", secretId: `${theme.slug}-season-secret-${String(index + 1).padStart(2, "0")}`, trigger, effect }],
    };
  }
  if (mode === 0) return { id, name: `${noun}灼流${mark}`, description: "对一个敌方角色造成 3 点伤害。", faction: theme.faction, type: "spell", cost, rarity: rarityFor(index, 14, false), school: theme.school, target: "enemy-character", effect: [{ kind: "damage", amount: 3 }] };
  if (mode === 1) return { id, name: `${noun}回响${mark}`, description: "抽两张牌。", faction: theme.faction, type: "spell", cost, rarity: rarityFor(index, 14, false), school: theme.school, target: "none", effect: [{ kind: "draw", count: 2 }] };
  if (mode === 2) return { id, name: `${noun}复苏${mark}`, description: "为一个友方角色恢复 5 点生命。", faction: theme.faction, type: "spell", cost, rarity: rarityFor(index, 14, false), school: theme.school, target: "friendly-character", effect: [{ kind: "heal", amount: 5 }] };
  if (mode === 3) return { id, name: `${noun}战令${mark}`, description: "使一个友方单位获得 +2/+2。", faction: theme.faction, type: "spell", cost, rarity: rarityFor(index, 14, false), school: theme.school, target: "friendly-unit", effect: [{ kind: "buff", attack: 2, health: 2 }] };
  if (mode === 4) return { id, name: `${noun}风暴${mark}`, description: "对所有敌方角色造成 1 点伤害。", faction: theme.faction, type: "spell", cost, rarity: rarityFor(index, 14, false), school: theme.school, target: "none", effect: [{ kind: "damage-all-enemies", amount: 1 }] };
  return { id, name: `${noun}发现${mark}`, description: "从当前模式的本体系卡池中发现一张牌。", faction: theme.faction, type: "spell", cost, rarity: rarityFor(index, 14, false), school: theme.school, target: "none", effect: [{ kind: "discover", pool: { faction: "friendly" } }] };
}

function weaponCard(theme: FactionTheme): CardDefinition {
  return {
    id: `${theme.slug}-season-weapon`,
    name: `${theme.faction}·核心武装`,
    description: `武器：${theme.faction}的专属终端武装。`,
    faction: theme.faction,
    type: "weapon",
    cost: 5,
    rarity: "史诗",
    attack: 4,
    durability: 2,
    school: theme.school,
  };
}

function buildThemeCards(theme: FactionTheme): CardDefinition[] {
  const isExisting = EXISTING_FACTIONS.has(theme.faction);
  const unitCount = isExisting ? 15 : 35;
  const spellCount = isExisting ? 5 : 14;
  const units = Array.from({ length: unitCount }, (_, index) => unitCard(theme, index, unitCount, !isExisting));
  // Transform is a board action, so wire it after the unit roster exists and
  // choose a deterministic same-faction replacement card.
  units.forEach((card, index) => {
    if (!theme.keywords.includes("transform") || index % 5 !== 0) return;
    const replacement = units[(index + 1) % units.length];
    card.keywords = [...(card.keywords ?? []), "transform"];
    card.target = "enemy-unit";
    card.onPlay = [{ kind: "transform", cardId: replacement.id }];
    card.description = `变形。${theme.faction}的战线单位。登场时将一个敌方单位变形为${replacement.name}。`;
  });
  const spells = Array.from({ length: spellCount }, (_, index) => spellCard(theme, index));
  return [...units, ...spells, ...(isExisting ? [] : [weaponCard(theme)])];
}

export const EXPANDED_CARD_CATALOG: readonly CardDefinition[] = Object.freeze(
  EXPANDED_FACTION_THEMES.flatMap(buildThemeCards),
);

export function factionTheme(faction: Faction): FactionTheme {
  const theme = THEME_BY_FACTION.get(faction);
  if (!theme) throw new Error(`未知体系：${faction}`);
  return theme;
}
