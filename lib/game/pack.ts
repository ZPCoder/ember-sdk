import { CARD_CATALOG } from "./catalog.ts";
import { cardAvailableInRankedFormat } from "./formats.ts";

export type PackCard = { cardId: string; count: number };

export type PackDrawOptions = {
  /** Force the first slot to be legendary when the account pity timer fires. */
  guaranteeLegendary?: boolean;
  /** Resolve the live Standard card pool at this instant. Mainly used by deterministic tests. */
  at?: Date | string | number;
};

function copyLimit(card: (typeof CARD_CATALOG)[number]): number {
  return card.rarity === "传说" ? 1 : 2;
}

/**
 * Open one five-card Standard pack with Hearthstone-style collection protection:
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
  const standardCatalog = CARD_CATALOG.filter((card) =>
    card.collectible !== false && cardAvailableInRankedFormat(card, "standard", options.at));
  if (standardCatalog.length === 0) return [];

  const random = randomValues
    ? Uint32Array.from(Array.from({ length: 5 }, (_, index) => randomValues[index] ?? 0))
    : (() => {
        const values = new Uint32Array(5);
        crypto.getRandomValues(values);
        return values;
      })();
  const eligible = standardCatalog.filter(
    (card) => (collection[card.id] ?? 0) < copyLimit(card),
  );
  const normalPool = eligible.length > 0 ? eligible : standardCatalog;
  const rarePool = normalPool.filter((card) => card.rarity !== "普通");
  const legendaryPool = normalPool.filter((card) => card.rarity === "传说");
  const guaranteedRarePool =
    rarePool.length > 0
      ? rarePool
      : standardCatalog.filter((card) => card.rarity !== "普通");
  const drawn = new Map<string, number>();
  const counts = new Map<string, number>();

  for (const [slot, value] of random.entries()) {
    const available = normalPool.filter(
      (card) =>
        (collection[card.id] ?? 0) + (drawn.get(card.id) ?? 0) < copyLimit(card),
    );
    const pool =
      slot === 0 && options.guaranteeLegendary && legendaryPool.length > 0
        ? legendaryPool
        : slot === 0
          ? guaranteedRarePool
        : available.length > 0
          ? available
          : normalPool;
    const card = pool[value % pool.length] ?? normalPool[value % normalPool.length];
    if (!card) continue;
    drawn.set(card.id, (drawn.get(card.id) ?? 0) + 1);
    counts.set(card.id, (counts.get(card.id) ?? 0) + 1);
  }

  return [...counts.entries()].map(([cardId, count]) => ({ cardId, count }));
}
