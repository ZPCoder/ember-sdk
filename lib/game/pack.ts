import { CARD_CATALOG } from "./catalog.ts";

export type PackCard = { cardId: string; count: number };

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
): PackCard[] {
  if (CARD_CATALOG.length === 0) return [];

  const random = randomValues
    ? Uint32Array.from(Array.from({ length: 5 }, (_, index) => randomValues[index] ?? 0))
    : (() => {
        const values = new Uint32Array(5);
        crypto.getRandomValues(values);
        return values;
      })();
  const eligible = CARD_CATALOG.filter(
    (card) => (collection[card.id] ?? 0) < copyLimit(card),
  );
  const normalPool = eligible.length > 0 ? eligible : CARD_CATALOG;
  const rarePool = normalPool.filter((card) => card.rarity !== "普通");
  const guaranteedRarePool =
    rarePool.length > 0
      ? rarePool
      : CARD_CATALOG.filter((card) => card.rarity !== "普通");
  const drawn = new Map<string, number>();
  const counts = new Map<string, number>();

  for (const [slot, value] of random.entries()) {
    const available = normalPool.filter(
      (card) =>
        (collection[card.id] ?? 0) + (drawn.get(card.id) ?? 0) < copyLimit(card),
    );
    const pool =
      slot === 0
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
