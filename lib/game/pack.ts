import { CARD_CATALOG } from "./catalog.ts";
import { CARD_SET_DEFINITIONS, cardAvailableInRankedFormat } from "./formats.ts";
import type { CardSetId } from "./types.ts";

export type PackCard = { cardId: string; count: number };

export const BULK_PACK_MIN_COUNT = 5;
export const BULK_PACK_MAX_COUNT = 40;
export const PACK_LEGENDARY_PITY_LIMIT = 40;
export const PACK_RARITY_ROLL_BASIS = 10_000;
export const PACK_RARITY_WEIGHTS = Object.freeze({
  "传说": 100,
  "史诗": 400,
  "稀有": 2_000,
  "普通": 7_500,
} as const);

export const EXPANSION_PACK_SET_IDS = Object.freeze([
  "pegasus-2024",
  "raptor-2025",
  "scarab-2026",
] as const satisfies readonly Exclude<CardSetId, "core">[]);
export type ExpansionPackSetId = (typeof EXPANSION_PACK_SET_IDS)[number];
export type PackType = "standard" | ExpansionPackSetId;
export const PACK_TYPES = Object.freeze(["standard", ...EXPANSION_PACK_SET_IDS] as const);

export function isPackType(value: unknown): value is PackType {
  return typeof value === "string" && (PACK_TYPES as readonly string[]).includes(value);
}

export function packTypeLabel(packType: PackType): string {
  return packType === "standard" ? "标准卡包" : `${CARD_SET_DEFINITIONS[packType].label}卡包`;
}

export function packTypeAvailable(
  packType: PackType,
  at: Date | string | number = new Date(),
): boolean {
  const catalog = CARD_CATALOG.filter((card) =>
    card.collectible !== false
    && (packType === "standard" ? true : card.set === packType)
    && cardAvailableInRankedFormat(card, packType === "standard" ? "standard" : "wild", at));
  return (Object.keys(PACK_RARITY_WEIGHTS) as Array<keyof typeof PACK_RARITY_WEIGHTS>)
    .every((rarity) => catalog.some((card) => card.rarity === rarity));
}

export type PackDrawOptions = {
  /** Force the first slot to be legendary when the account pity timer fires. */
  guaranteeLegendary?: boolean;
  /** Resolve the live Standard card pool at this instant. Mainly used by deterministic tests. */
  at?: Date | string | number;
  /** Lifetime acquisitions used by duplicate protection even after disenchanting. */
  duplicateProtectionCollection?: Readonly<Record<string, number>>;
  /** Standard uses the rotating pool; expansion packs only draw released cards from that set. */
  packType?: PackType;
};

export type PackBatchResult = {
  openedCards: PackCard[];
  collection: Record<string, number>;
  packsOpened: number;
  packsSinceLegendary: number;
};

export function packGuaranteesLegendary(
  pity: Readonly<{ packsOpened: number; packsSinceLegendary: number }>,
): boolean {
  const packsOpened = Math.max(0, Math.floor(pity.packsOpened));
  const packsSinceLegendary = Math.max(0, Math.floor(pity.packsSinceLegendary));
  const hasNeverOpenedLegendary = packsOpened === packsSinceLegendary;
  return packsSinceLegendary >= PACK_LEGENDARY_PITY_LIMIT - 1
    || (hasNeverOpenedLegendary && packsOpened >= 9);
}

export function packRarityForRoll(value: number): keyof typeof PACK_RARITY_WEIGHTS {
  const roll = Math.abs(Math.floor(Number.isFinite(value) ? value : 0)) % PACK_RARITY_ROLL_BASIS;
  if (roll < PACK_RARITY_WEIGHTS["传说"]) return "传说";
  if (roll < PACK_RARITY_WEIGHTS["传说"] + PACK_RARITY_WEIGHTS["史诗"]) return "史诗";
  if (roll < PACK_RARITY_WEIGHTS["传说"] + PACK_RARITY_WEIGHTS["史诗"] + PACK_RARITY_WEIGHTS["稀有"]) return "稀有";
  return "普通";
}

function copyLimit(card: (typeof CARD_CATALOG)[number]): number {
  return card.rarity === "传说" ? 1 : 2;
}

/**
 * Open one five-card pack with Hearthstone-style collection protection:
 * normal collection caps prevent avoidable duplicates and the first slot is
 * guaranteed to be rare or better. If the whole collection is complete, the
 * function falls back to the full catalogue so opening a pack still works.
 *
 * The optional randomValues argument is only for deterministic tests; the
 * production path always uses the platform CSPRNG.
 */
export function drawPack(
  collection: Readonly<Record<string, number>> = {},
  randomValues?: readonly number[],
  options: PackDrawOptions = {},
): PackCard[] {
  const packType = options.packType ?? "standard";
  const packCatalog = CARD_CATALOG.filter((card) =>
    card.collectible !== false
    && (packType === "standard" ? true : card.set === packType)
    && cardAvailableInRankedFormat(card, packType === "standard" ? "standard" : "wild", options.at));
  if (packCatalog.length === 0) return [];

  const random = randomValues
    ? Uint32Array.from(Array.from({ length: 10 }, (_, index) => randomValues[index] ?? 0))
    : (() => {
        const values = new Uint32Array(10);
        crypto.getRandomValues(values);
        return values;
      })();
  const rolledRarities = Array.from({ length: 5 }, (_, slot) => packRarityForRoll(random[slot * 2] ?? 0));
  if (options.guaranteeLegendary) {
    rolledRarities[0] = "传说";
  } else if (rolledRarities.every((rarity) => rarity === "普通")) {
    rolledRarities[0] = "稀有";
  }
  const protectionCollection = options.duplicateProtectionCollection ?? collection;
  const drawn = new Map<string, number>();
  const counts = new Map<string, number>();

  for (const [slot, rarity] of rolledRarities.entries()) {
    const rarityCatalog = packCatalog.filter((card) => card.rarity === rarity);
    const protectedPool = rarityCatalog.filter(
      (card) => (protectionCollection[card.id] ?? collection[card.id] ?? 0) < copyLimit(card),
    );
    const basePool = protectedPool.length > 0 ? protectedPool : rarityCatalog;
    const available = basePool.filter(
      (card) => {
        const protectedCount = protectionCollection[card.id] ?? collection[card.id] ?? 0;
        const existingCount = protectedPool.length > 0
          ? Math.max(collection[card.id] ?? 0, protectedCount)
          : 0;
        return existingCount + (drawn.get(card.id) ?? 0) < copyLimit(card);
      },
    );
    const pool = available.length > 0 ? available : basePool;
    const selectionValue = random[slot * 2 + 1] ?? 0;
    const card = pool[selectionValue % pool.length] ?? rarityCatalog[selectionValue % rarityCatalog.length];
    if (!card) continue;
    drawn.set(card.id, (drawn.get(card.id) ?? 0) + 1);
    counts.set(card.id, (counts.get(card.id) ?? 0) + 1);
  }

  return [...counts.entries()].map(([cardId, count]) => ({ cardId, count }));
}

/**
 * Draw a sequence of packs against the collection produced by every
 * preceding pack. This preserves duplicate protection and the legendary pity
 * timer across a mass-open request instead of treating each pack in isolation.
 */
export function drawPackBatch(
  collection: Readonly<Record<string, number>>,
  pity: Readonly<{ packsOpened: number; packsSinceLegendary: number }>,
  count: number,
  options: {
    at?: Date | string | number;
    randomValuesByPack?: readonly (readonly number[])[];
    duplicateProtectionCollection?: Readonly<Record<string, number>>;
    packType?: PackType;
  } = {},
): PackBatchResult {
  if (!Number.isInteger(count) || count < 1 || count > BULK_PACK_MAX_COUNT) {
    throw new RangeError(`卡包数量必须是 1–${BULK_PACK_MAX_COUNT} 的整数。`);
  }
  const nextCollection = { ...collection };
  const nextProtectionCollection = { ...(options.duplicateProtectionCollection ?? collection) };
  const totals = new Map<string, number>();
  let packsOpened = Math.max(0, Math.floor(pity.packsOpened));
  let packsSinceLegendary = Math.max(0, Math.floor(pity.packsSinceLegendary));

  for (let index = 0; index < count; index += 1) {
    const opened = drawPack(nextCollection, options.randomValuesByPack?.[index], {
      at: options.at,
      guaranteeLegendary: packGuaranteesLegendary({ packsOpened, packsSinceLegendary }),
      duplicateProtectionCollection: nextProtectionCollection,
      packType: options.packType,
    });
    const openedLegendary = opened.some((entry) =>
      CARD_CATALOG.find((card) => card.id === entry.cardId)?.rarity === "传说");
    for (const entry of opened) {
      nextCollection[entry.cardId] = (nextCollection[entry.cardId] ?? 0) + entry.count;
      nextProtectionCollection[entry.cardId] = (nextProtectionCollection[entry.cardId] ?? 0) + entry.count;
      totals.set(entry.cardId, (totals.get(entry.cardId) ?? 0) + entry.count);
    }
    packsOpened += 1;
    packsSinceLegendary = openedLegendary ? 0 : packsSinceLegendary + 1;
  }

  return {
    openedCards: [...totals.entries()].map(([cardId, cardCount]) => ({ cardId, count: cardCount })),
    collection: nextCollection,
    packsOpened,
    packsSinceLegendary,
  };
}
