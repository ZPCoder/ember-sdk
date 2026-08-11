import type { CardDefinition, Keyword, Trait } from "./types.ts";

export type TraitTier = 0 | 1 | 2;

export interface TraitDefinition {
  id: Trait;
  label: string;
  sigil: string;
  thresholds: readonly [2, 4];
  descriptions: readonly [string, string];
}

export interface TraitStatus extends TraitDefinition {
  count: number;
  tier: TraitTier;
  nextThreshold: number | null;
}

export const TRAIT_ORDER: readonly Trait[] = Object.freeze([
  "swift",
  "bulwark",
  "arcane",
  "hunt",
  "craft",
]);

export const TRAIT_DEFINITIONS: Readonly<Record<Trait, TraitDefinition>> =
  Object.freeze({
    swift: {
      id: "swift",
      label: "迅锋",
      sigil: "↗",
      thresholds: [2, 4],
      descriptions: [
        "迅锋单位主动攻击时额外造成 1 点伤害。",
        "迅锋单位主动攻击时额外造成 2 点伤害。",
      ],
    },
    bulwark: {
      id: "bulwark",
      label: "坚阵",
      sigil: "◇",
      thresholds: [2, 4],
      descriptions: [
        "坚阵单位受到战斗伤害时减少 1 点，最低为 1。",
        "坚阵单位受到战斗伤害时减少 2 点，最低为 1。",
      ],
    },
    arcane: {
      id: "arcane",
      label: "秘契",
      sigil: "✦",
      thresholds: [2, 4],
      descriptions: [
        "伤害、治疗与增益战术的数值提高 1。",
        "伤害、治疗与增益战术的数值提高 2。",
      ],
    },
    hunt: {
      id: "hunt",
      label: "猎痕",
      sigil: "⌁",
      thresholds: [2, 4],
      descriptions: [
        "猎痕单位主动击败单位并存活后，恢复 1 点生命。",
        "猎痕单位主动击败单位并存活后，恢复 2 点生命。",
      ],
    },
    craft: {
      id: "craft",
      label: "巧铸",
      sigil: "⬡",
      thresholds: [2, 4],
      descriptions: [
        "巧铸单位升至二星时额外获得 +1/+1。",
        "巧铸单位升至二星时额外获得 +2/+2。",
      ],
    },
  });

export const KEYWORD_DEFINITIONS: Readonly<
  Record<Keyword, { label: string; description: string }>
> = Object.freeze({
  battlecry: { label: "战吼", description: "使用卡牌时立即触发一次效果。" },
  deathrattle: { label: "亡语", description: "单位被摧毁时触发一次效果。" },
  charge: { label: "冲锋", description: "部署回合即可主动攻击。" },
  rush: { label: "突袭", description: "部署回合可攻击敌方单位，但不能攻击核心。" },
  taunt: { label: "嘲讽", description: "敌方必须优先攻击该单位。" },
  shield: { label: "护盾", description: "抵消下一次受到的伤害。" },
  lifesteal: {
    label: "汲取",
    description: "主动攻击造成伤害后，为己方核心恢复 1 点生命。",
  },
  fury: {
    label: "激昂",
    description: "受到战斗伤害并存活后获得 +1 攻击，最多触发两次。",
  },
  windfury: { label: "风怒", description: "每回合可以攻击两次。" },
  poisonous: { label: "剧毒", description: "对单位造成伤害后摧毁该单位。" },
  stealth: { label: "潜行", description: "潜行期间不能成为敌方直接目标。攻击后解除。" },
  reborn: { label: "复生", description: "第一次被摧毁后以 1 点生命回到战场。" },
  freeze: { label: "冻结", description: "使目标跳过下一次攻击机会。" },
  secret: { label: "奥秘", description: "暗置后等待敌方行为触发一次效果。" },
  discover: { label: "发现", description: "从三张候选卡牌中选择一张加入手牌。" },
  overload: { label: "过载", description: "本回合正常支付费用，下回合锁定指定数量的法力水晶。" },
  combo: { label: "连击", description: "本回合先使用过其他牌时，额外触发连击效果。" },
  "spell-damage": { label: "法术伤害", description: "你施放的伤害性法术额外造成指定伤害。" },
  silence: { label: "沉默", description: "移除目标单位的卡牌文本、关键词和临时属性增益。" },
  "choose-one": { label: "抉择", description: "从两个战术分支中选择一个结算。" },
  transform: { label: "变形", description: "将目标替换为一张全新的单位档案，移除原有增益。" },
  temporary: { label: "临时", description: "该数值增益会在单位所属玩家回合结束时移除。" },
  "end-of-turn": { label: "回合结束", description: "在该单位所属玩家结束回合时触发一次。" },
  "start-of-turn": { label: "回合开始", description: "在该单位所属玩家开始回合时触发一次。" },
  "spell-trigger": { label: "战术触发", description: "在你完成施放战术后触发一次效果。" },
});

export function getTraitTier(
  count: number,
  thresholds: readonly [number, number] = [2, 4],
): TraitTier {
  if (count >= thresholds[1]) return 2;
  if (count >= thresholds[0]) return 1;
  return 0;
}

export function getTraitCount(
  cards: readonly Pick<CardDefinition, "id" | "traits">[],
  trait: Trait,
): number {
  return new Set(
    cards
      .filter((card) => card.traits?.includes(trait))
      .map((card) => card.id),
  ).size;
}

export function getTraitStatuses(
  cards: readonly Pick<CardDefinition, "id" | "traits">[],
): TraitStatus[] {
  return TRAIT_ORDER.map((trait) => {
    const definition = TRAIT_DEFINITIONS[trait];
    const count = getTraitCount(cards, trait);
    const tier = getTraitTier(count, definition.thresholds);
    return {
      ...definition,
      count,
      tier,
      nextThreshold:
        tier === 0
          ? definition.thresholds[0]
          : tier === 1
            ? definition.thresholds[1]
            : null,
    };
  });
}
