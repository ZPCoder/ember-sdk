import type { BattleEvent, PlayerId } from "./types.ts";

export type BattleEffectKind =
  | "start"
  | "draw"
  | "card"
  | "summon"
  | "attack"
  | "damage"
  | "heal"
  | "buff"
  | "transform"
  | "shield"
  | "destroy"
  | "turn"
  | "win"
  | "loss";

export type BattleEffectSide = "player" | "ai";
export type BattleEffectTarget = "hero" | "unit";

export type BattleVisualEffect = {
  id: string;
  kind: BattleEffectKind;
  side?: BattleEffectSide;
  sourceId?: string;
  targetId?: string;
  targetSide?: BattleEffectSide;
  targetKind?: BattleEffectTarget;
  cardId?: string;
  amount?: number;
  label: string;
};

function sideFor(player: PlayerId | undefined): BattleEffectSide | undefined {
  if (player === 0) return "player";
  if (player === 1) return "ai";
  return undefined;
}

function opposingSide(side: BattleEffectSide | undefined): BattleEffectSide | undefined {
  if (side === "player") return "ai";
  if (side === "ai") return "player";
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function asEntityId(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function asAmount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, value)
    : undefined;
}

function targetFrom(data: Record<string, unknown> | undefined): {
  targetId?: string;
  targetSide?: BattleEffectSide;
  targetKind?: BattleEffectTarget;
} {
  const target = asRecord(data?.target);
  if (target?.kind === "hero") {
    const player = target.player;
    return {
      targetKind: "hero",
      targetSide: player === 0 ? "player" : player === 1 ? "ai" : undefined,
    };
  }
  if (target?.kind === "unit") {
    return {
      targetKind: "unit",
      targetId: asEntityId(target.entityId),
    };
  }
  const entityId = asEntityId(data?.entityId);
  return entityId
    ? { targetKind: "unit", targetId: entityId }
    : {};
}

export function battleEventsToEffects(
  events: readonly BattleEvent[],
  viewer: PlayerId = 0,
): BattleVisualEffect[] {
  const effects: BattleVisualEffect[] = [];

  for (const event of events) {
    const data = event.data;
    const side = sideFor(event.player);
    const target = targetFrom(data);
    const base = {
      id: `event-${event.seq}`,
      side,
    };

    switch (event.type) {
      case "match-started":
        effects.push({ ...base, kind: "start", label: "战术链路建立" });
        break;
      case "card-drawn":
        if (event.player === viewer) {
          effects.push({
            ...base,
            kind: "draw",
            cardId: asEntityId(data?.cardId),
            label: "抽取战术卡",
          });
        }
        break;
      case "card-played":
        effects.push({
          ...base,
          ...target,
          kind: "card",
          cardId: asEntityId(data?.cardId),
          label: event.player === viewer ? "战术部署" : "敌方战术",
        });
        break;
      case "weapon-equipped":
        effects.push({
          ...base,
          kind: "buff",
          cardId: asEntityId(data?.cardId),
          targetSide: side,
          label: "武器装备",
        });
        break;
      case "weapon-broke":
        effects.push({
          ...base,
          kind: "destroy",
          cardId: asEntityId(data?.cardId),
          targetSide: side,
          label: "武器耗尽",
        });
        break;
      case "secret-armed":
        effects.push({
          ...base,
          kind: "card",
          cardId: asEntityId(data?.cardId),
          label: "奥秘设置",
        });
        break;
      case "secret-triggered": {
        const secretEffect = asRecord(data?.secretEffect);
        const triggerPlayer = data?.triggeringPlayer;
        const triggerSide = triggerPlayer === 0 ? "player" : triggerPlayer === 1 ? "ai" : undefined;
        if (secretEffect?.kind === "damage-attacker" && data?.attackerId) {
          effects.push({
            ...base,
            kind: "damage",
            targetKind: "unit",
            targetId: asEntityId(data.attackerId),
            amount: asAmount(secretEffect.amount),
            label: "奥秘反制",
          });
        } else if (secretEffect?.kind === "damage-enemy-hero") {
          effects.push({
            ...base,
            kind: "damage",
            targetKind: "hero",
            targetSide: triggerSide,
            amount: asAmount(secretEffect.amount),
            label: "奥秘反制",
          });
        } else if (secretEffect?.kind === "heal-friendly-hero") {
          effects.push({
            ...base,
            kind: "heal",
            targetKind: "hero",
            targetSide: side,
            amount: asAmount(secretEffect.amount),
            label: "奥秘修复",
          });
        } else if (secretEffect?.kind === "armor") {
          effects.push({
            ...base,
            kind: "shield",
            targetKind: "hero",
            targetSide: side,
            amount: asAmount(secretEffect.amount),
            label: "奥秘护甲",
          });
        } else {
          effects.push({
            ...base,
            kind: "draw",
            targetSide: side,
            label: "奥秘抽牌",
          });
        }
        break;
      }
      case "discover-started":
        effects.push({
          ...base,
          kind: "card",
          cardId: asEntityId(data?.sourceCardId),
          label: "发现候选",
        });
        break;
      case "discover-chosen":
        effects.push({
          ...base,
          kind: "draw",
          cardId: asEntityId(data?.cardId),
          label: "发现入手",
        });
        break;
      case "choose-one-started":
        effects.push({
          ...base,
          kind: "card",
          cardId: asEntityId(data?.sourceCardId),
          label: "抉择分支",
        });
        break;
      case "choose-one-chosen":
        effects.push({
          ...base,
          kind: "buff",
          label: typeof data?.optionLabel === "string" ? data.optionLabel : "抉择结算",
        });
        break;
      case "mana-overloaded":
        effects.push({
          ...base,
          kind: "card",
          cardId: asEntityId(data?.cardId),
          amount: asAmount(data?.amount),
          label: "法力过载",
        });
        break;
      case "combo-triggered":
        effects.push({
          ...base,
          kind: "card",
          cardId: asEntityId(data?.cardId),
          label: "连击触发",
        });
        break;
      case "hero-power":
        {
          const heroPowerEffect = asRecord(data?.heroPowerEffect);
          const heroPowerName =
            typeof data?.heroPowerName === "string" ? data.heroPowerName : "核心脉冲";
          const effectKind = heroPowerEffect?.kind;
          if (effectKind === "damage-enemy-hero") {
            effects.push({
              ...base,
              kind: "damage",
              targetKind: "hero",
              targetSide: opposingSide(side),
              amount: asAmount(heroPowerEffect.amount) ?? 1,
              label: heroPowerName,
            });
          } else if (effectKind === "heal-friendly-hero") {
            effects.push({
              ...base,
              kind: "heal",
              targetKind: "hero",
              targetSide: side,
              amount: asAmount(heroPowerEffect.amount),
              label: heroPowerName,
            });
          } else if (effectKind === "armor") {
            effects.push({
              ...base,
              kind: "shield",
              targetKind: "hero",
              targetSide: side,
              amount: asAmount(heroPowerEffect.amount),
              label: heroPowerName,
            });
          } else if (effectKind === "summon") {
            effects.push({
              ...base,
              kind: "summon",
              cardId: asEntityId(heroPowerEffect.cardId),
              targetSide: side,
              label: heroPowerName,
            });
          } else {
            effects.push({
              ...base,
              kind: "draw",
              targetSide: side,
              label: heroPowerName,
            });
          }
        }
        break;
      case "unit-summoned":
        effects.push({
          ...base,
          kind: "summon",
          sourceId: asEntityId(data?.entityId),
          cardId: asEntityId(data?.cardId),
          label: event.player === viewer ? "单位接入" : "敌方单位接入",
        });
        break;
      case "attack":
        effects.push({
          ...base,
          ...target,
          kind: "attack",
          sourceId: asEntityId(data?.attackerId),
          targetSide:
            target.targetSide ??
            (target.targetKind === "unit" ? opposingSide(side) : undefined),
          label: event.player === viewer ? "突击" : "敌方突击",
        });
        break;
      case "damage":
      case "fatigue":
        effects.push({
          ...base,
          ...target,
          kind: "damage",
          targetKind: event.type === "fatigue" ? "hero" : target.targetKind,
          targetSide:
            event.type === "fatigue"
              ? side
              : target.targetSide ??
                (target.targetKind === "unit" ? opposingSide(side) : undefined),
          amount: asAmount(data?.amount),
          label: event.type === "fatigue" ? "疲劳损伤" : "命中",
        });
        break;
      case "healing":
        effects.push({
          ...base,
          ...target,
          kind: "heal",
          targetSide:
            target.targetSide ??
            (target.targetKind === "unit" ? side : undefined),
          amount: asAmount(data?.amount),
          label: "生命修复",
        });
        break;
      case "unit-buffed":
        effects.push({
          ...base,
          ...target,
          kind: "buff",
          targetSide: target.targetSide ?? side,
          label: data?.upgrade === true ? "二星升阶" : "战力增幅",
        });
        break;
      case "unit-silenced":
        effects.push({
          ...base,
          kind: "card",
          targetKind: "unit",
          targetId: asEntityId(data?.entityId),
          cardId: asEntityId(data?.cardId),
          targetSide: opposingSide(side),
          label: "沉默解除",
        });
        break;
      case "unit-transformed":
        effects.push({
          ...base,
          kind: "transform",
          targetKind: "unit",
          targetId: asEntityId(data?.entityId),
          cardId: asEntityId(data?.cardId),
          label: "单位变形",
        });
        break;
      case "shield-broken":
        effects.push({
          ...base,
          ...target,
          kind: "shield",
          targetSide: target.targetSide ?? side,
          label: "护盾破裂",
        });
        break;
      case "unit-died":
        effects.push({
          ...base,
          ...target,
          kind: "destroy",
          targetSide: target.targetSide ?? side,
          label: event.player === viewer ? "我方单位离线" : "敌方单位离线",
        });
        break;
      case "turn-started":
        effects.push({
          ...base,
          kind: "turn",
          targetSide: side,
          label: event.player === viewer ? "你的回合" : "敌方回合",
        });
        break;
      case "match-ended": {
        const winner = data?.winner;
        const won = winner === viewer || event.player === viewer;
        effects.push({
          ...base,
          kind: won ? "win" : "loss",
          targetSide: won ? "ai" : "player",
          label: won ? "演算胜利" : "核心失守",
        });
        break;
      }
      default:
        break;
    }
  }

  return effects;
}
