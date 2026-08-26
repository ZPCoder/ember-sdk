import {
  ETERNAL_SCARAB_CARD_BACK_NAME,
  eternalScarabCardBackEarned,
  type RankedRewardState,
} from "./ranked-rewards.ts";

export const DEFAULT_CARD_BACK_ID = "ember-core";
export const ETERNAL_SCARAB_CARD_BACK_ID = "eternal-scarab";
export const RANDOM_OWNED_CARD_BACK_ID = "random-owned";

export type CardBackKind = "default" | "season" | "legend" | "random";

export type CardBackDefinition = {
  id: string;
  name: string;
  description: string;
  kind: CardBackKind;
};

const SEASON_CARD_BACK_PATTERN = /^ranked-(\d{4})-(0[1-9]|1[0-2])$/;

export function seasonCardBackId(seasonKey: string): string {
  return `ranked-${seasonKey}`;
}

export function cardBackSeasonKey(cardBackId: string): string | null {
  const match = SEASON_CARD_BACK_PATTERN.exec(cardBackId);
  return match ? `${match[1]}-${match[2]}` : null;
}

export function isCardBackId(value: unknown): value is string {
  return value === DEFAULT_CARD_BACK_ID
    || value === ETERNAL_SCARAB_CARD_BACK_ID
    || value === RANDOM_OWNED_CARD_BACK_ID
    || (typeof value === "string" && SEASON_CARD_BACK_PATTERN.test(value));
}

export function cardBackDefinition(cardBackId: string): CardBackDefinition {
  if (cardBackId === RANDOM_OWNED_CARD_BACK_ID) {
    return {
      id: cardBackId,
      name: "随机收藏卡背",
      description: "每局开始时，从当前已拥有的实体卡背中确定性随机选择一个。",
      kind: "random",
    };
  }
  if (cardBackId === ETERNAL_SCARAB_CARD_BACK_ID) {
    return {
      id: cardBackId,
      name: ETERNAL_SCARAB_CARD_BACK_NAME,
      description: "在圣甲虫之年六个不同赛季登上传说后永久解锁。",
      kind: "legend",
    };
  }
  const seasonKey = cardBackSeasonKey(cardBackId);
  if (seasonKey) {
    return {
      id: cardBackId,
      name: `${seasonKey.replace("-", ".")} 赛季荣光`,
      description: `在 ${seasonKey} 赛季赢得五场天梯对局后永久解锁。`,
      kind: "season",
    };
  }
  return {
    id: DEFAULT_CARD_BACK_ID,
    name: "余烬核心",
    description: "所有指挥官默认拥有的经典卡背。",
    kind: "default",
  };
}

export function unlockedCardBacks(rewards: RankedRewardState): CardBackDefinition[] {
  const result = [
    cardBackDefinition(DEFAULT_CARD_BACK_ID),
    cardBackDefinition(RANDOM_OWNED_CARD_BACK_ID),
  ];
  for (const seasonKey of rewards.earnedCardBackSeasons) {
    result.push(cardBackDefinition(seasonCardBackId(seasonKey)));
  }
  if (eternalScarabCardBackEarned(rewards)) {
    result.push(cardBackDefinition(ETERNAL_SCARAB_CARD_BACK_ID));
  }
  return result;
}

export function cardBackIsUnlocked(cardBackId: string, rewards: RankedRewardState): boolean {
  if (cardBackId === DEFAULT_CARD_BACK_ID || cardBackId === RANDOM_OWNED_CARD_BACK_ID) return true;
  if (cardBackId === ETERNAL_SCARAB_CARD_BACK_ID) return eternalScarabCardBackEarned(rewards);
  const seasonKey = cardBackSeasonKey(cardBackId);
  return seasonKey !== null && rewards.earnedCardBackSeasons.includes(seasonKey);
}

export function normalizeOwnedCardBackId(value: unknown, rewards: RankedRewardState): string {
  return typeof value === "string" && isCardBackId(value) && cardBackIsUnlocked(value, rewards)
    ? value
    : DEFAULT_CARD_BACK_ID;
}

export function resolveCardBackSelection(
  selectionId: string,
  rewards: RankedRewardState,
  seed: number,
  salt = 0,
): string {
  const normalized = normalizeOwnedCardBackId(selectionId, rewards);
  if (normalized !== RANDOM_OWNED_CARD_BACK_ID) return normalized;
  const owned = unlockedCardBacks(rewards)
    .map((cardBack) => cardBack.id)
    .filter((cardBackId) => cardBackId !== RANDOM_OWNED_CARD_BACK_ID);
  let hash = (Number.isSafeInteger(seed) ? seed : 0) ^ Math.imul(salt + 1, 0x9e3779b1);
  for (const seasonKey of rewards.earnedCardBackSeasons) {
    for (let index = 0; index < seasonKey.length; index += 1) {
      hash = Math.imul(hash ^ seasonKey.charCodeAt(index), 0x45d9f3b);
    }
  }
  return owned[(hash >>> 0) % owned.length] ?? DEFAULT_CARD_BACK_ID;
}
