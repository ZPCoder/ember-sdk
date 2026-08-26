import type { BattleEvent, PlayerId } from "./types.ts";

export type BattleEffectKind =
  | "start"
  | "draw"
  | "trade"
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
  const targetPlayer = data?.targetPlayer;
  const explicitTargetSide =
    targetPlayer === 0
      ? "player"
      : targetPlayer === 1
        ? "ai"
        : data?.targetSide === "player" || data?.targetSide === "ai"
          ? data.targetSide
          : undefined;
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
      targetSide:
        target.player === 0
          ? "player"
          : target.player === 1
            ? "ai"
            : explicitTargetSide,
    };
  }
  const entityId = asEntityId(data?.entityId);
  return entityId
    ? { targetKind: "unit", targetId: entityId, targetSide: explicitTargetSide }
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
      case "card-burned":
        if (event.player === viewer) {
          effects.push({
            ...base,
            kind: "destroy",
            cardId: asEntityId(data?.cardId),
            label: "手牌燃毁",
          });
        }
        break;
      case "card-traded":
        effects.push({
          ...base,
          kind: "trade",
          cardId: asEntityId(data?.cardId),
          label: event.player === viewer ? "可交易循环" : "敌方交易",
        });
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
        // `secret-triggered` announces which secret opened the reaction
        // window. The engine emits the concrete damage/healing/draw/buff event
        // immediately afterwards, so this aggregate event must not replay the
        // same numerical effect a second time.
        if (secretEffect?.kind === "damage-attacker" && data?.attackerId) {
          effects.push({
            ...base,
            kind: "card",
            cardId: asEntityId(data?.cardId),
            targetKind: "unit",
            targetId: asEntityId(data.attackerId),
            targetSide: triggerSide,
            label: "奥秘反制",
          });
        } else if (
          secretEffect?.kind === "damage-attacker" &&
          (data?.attackerPlayer === 0 || data?.attackerPlayer === 1)
        ) {
          effects.push({
            ...base,
            kind: "card",
            cardId: asEntityId(data?.cardId),
            targetKind: "hero",
            targetSide: data.attackerPlayer === 0 ? "player" : "ai",
            label: "奥秘反制",
          });
        } else if (secretEffect?.kind === "damage-enemy-hero") {
          effects.push({
            ...base,
            kind: "card",
            cardId: asEntityId(data?.cardId),
            targetKind: "hero",
            targetSide: triggerSide,
            label: "奥秘反制",
          });
        } else if (secretEffect?.kind === "heal-friendly-hero") {
          effects.push({
            ...base,
            kind: "card",
            cardId: asEntityId(data?.cardId),
            targetKind: "hero",
            targetSide: side,
            label: "奥秘修复",
          });
        } else if (secretEffect?.kind === "armor") {
          effects.push({
            ...base,
            kind: "card",
            cardId: asEntityId(data?.cardId),
            targetKind: "hero",
            targetSide: side,
            label: "奥秘护甲",
          });
        } else if (secretEffect?.kind === "counterspell") {
          effects.push({
            ...base,
            kind: "card",
            cardId: asEntityId(data?.cardId),
            targetSide: triggerSide,
            label: "奥秘反制",
          });
        } else {
          effects.push({
            ...base,
            kind: "card",
            cardId: asEntityId(data?.cardId),
            targetSide: side,
            label: secretEffect?.kind === "draw" ? "奥秘抽牌" : "奥秘触发",
          });
        }
        break;
      }
      case "spell-countered":
        effects.push({
          ...base,
          kind: "destroy",
          cardId: asEntityId(data?.cardId),
          targetSide:
            data?.triggeringPlayer === 0
              ? "player"
              : data?.triggeringPlayer === 1
                ? "ai"
                : opposingSide(side),
          label: "法术被反制",
        });
        break;
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
          if (data?.coin === true) {
            effects.push({
              ...base,
              kind: "card",
              amount: asAmount(data?.bonusMana) ?? 0,
              label: data?.overloadAbsorbed
                ? "幸运币抵扣过载"
                : "幸运币",
            });
            break;
          }
          const heroPowerEffect = asRecord(data?.heroPowerEffect);
          const heroPowerName =
            typeof data?.heroPowerName === "string" ? data.heroPowerName : "核心脉冲";
          const effectKind = heroPowerEffect?.kind;
          const aggregateTarget = effectKind === "damage-enemy-hero"
            ? { targetKind: "hero" as const, targetSide: opposingSide(side) }
            : effectKind === "heal-friendly-hero" || effectKind === "armor"
              ? { targetKind: "hero" as const, targetSide: side }
              : effectKind === "summon" || effectKind === "draw"
                ? { targetSide: side }
                : target;
          // As with secrets, the hero-power event is the activation banner;
          // damage, healing, summoning, drawing and armor changes each have a
          // following authoritative event that owns the visible value change.
          effects.push({
            ...base,
            ...aggregateTarget,
            kind: "card",
            label: heroPowerName,
          });
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
        {
          const attackerName = asEntityId(data?.attackerName);
          const targetName = asEntityId(data?.targetName);
          const readableTargetName = targetName?.includes("核心")
            ? target.targetSide === sideFor(viewer)
              ? "我方核心"
              : "敌方核心"
            : targetName;
          const fallbackLabel = event.player === viewer ? "突击" : "敌方突击";
          effects.push({
            ...base,
            ...target,
            kind: "attack",
            sourceId: asEntityId(data?.attackerId),
            targetSide:
              target.targetSide ??
              (target.targetKind === "unit" ? opposingSide(side) : undefined),
            label: attackerName && readableTargetName
              ? `${attackerName} → ${readableTargetName}`
              : fallbackLabel,
          });
        }
        break;
      case "damage":
      case "fatigue":
        {
          const amount = asAmount(data?.amount);
          const armorAbsorbed = asAmount(data?.armorAbsorbed);
          if (armorAbsorbed !== undefined && armorAbsorbed > 0) {
            effects.push({
              ...base,
              ...target,
              kind: "shield",
              targetKind: "hero",
              targetSide: event.type === "fatigue" ? side : target.targetSide,
              amount: armorAbsorbed,
              label: "护甲吸收",
            });
          }
          const healthDamage = event.type === "fatigue"
            ? asAmount(data?.healthDamage) ?? amount
            : amount;
          if (healthDamage === undefined || healthDamage <= 0) break;
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
            amount: healthDamage,
            label: event.type === "fatigue" ? "疲劳损伤" : "命中",
          });
        }
        break;
      case "healing":
        {
          const amount = asAmount(data?.amount);
          if (amount === undefined || amount <= 0) break;
          effects.push({
            ...base,
            ...target,
            kind: "heal",
            targetSide:
              target.targetSide ??
              (target.targetKind === "unit" ? side : undefined),
            amount,
            label: "生命修复",
          });
        }
        break;
      case "unit-buffed":
        effects.push({
          ...base,
          ...target,
          kind: "buff",
          targetSide: target.targetSide ?? side,
          label: data?.temporary === true ? "临时战力" : data?.upgrade === true ? "二星升阶" : "战力增幅",
        });
        break;
      case "turn-triggered":
        effects.push({
          ...base,
          kind: "buff",
          targetKind: "unit",
          targetId: asEntityId(data?.entityId),
          label: data?.timing === "start" ? "回合开始触发" : "回合结束触发",
        });
        break;
      case "card-triggered":
        effects.push({
          ...base,
          kind: "buff",
          targetKind: "unit",
          targetId: asEntityId(data?.entityId),
          label: "战术触发",
        });
        break;
      case "temporary-expired":
        effects.push({
          ...base,
          kind: "destroy",
          targetKind: "unit",
          targetId: asEntityId(data?.entityId),
          label: "临时增益结束",
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
      case "turn-ended":
      case "turn-timed-out":
        effects.push({
          ...base,
          kind: "turn",
          targetSide: side,
          label: event.type === "turn-timed-out"
            ? event.player === viewer ? "行动超时，自动结束" : "敌方行动超时"
            : event.player === viewer ? "回合结束" : "敌方回合结束",
        });
        break;
      case "match-ended": {
        const winner = data?.winner;
        const isDraw = data?.reason === "draw" || winner === null;
        if (isDraw) {
          effects.push({
            ...base,
            kind: "draw",
            label: "演算平局",
          });
          break;
        }
        const resolvedWinner = winner === 0 || winner === 1
          ? winner
          : event.player === 0 || event.player === 1
            ? event.player
            : undefined;
        if (resolvedWinner === undefined) break;
        const won = resolvedWinner === viewer;
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
