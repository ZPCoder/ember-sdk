import type { CardDefinition, CardSetId } from "./types.js";

export const TRIAL_CARD_ACCESS_DAYS = 7;
export const TRIAL_CARD_ACCESS_MS = TRIAL_CARD_ACCESS_DAYS * 24 * 60 * 60 * 1_000;
export const TRIAL_CARD_SETS: readonly CardSetId[] = Object.freeze([
  "raptor-2025",
  "scarab-2026",
]);

export type TrialCardAccess = {
  activatedAt: string | null;
  expiresAt: string | null;
};

export function trialCardsAreActive(
  access: TrialCardAccess | null | undefined,
  now: number | Date = Date.now(),
): boolean {
  if (!access?.activatedAt || !access.expiresAt) return false;
  const activatedAt = Date.parse(access.activatedAt);
  const expiresAt = Date.parse(access.expiresAt);
  const timestamp = now instanceof Date ? now.getTime() : now;
  return Number.isFinite(activatedAt)
    && Number.isFinite(expiresAt)
    && expiresAt > activatedAt
    && timestamp >= activatedAt
    && timestamp < expiresAt;
}

export function collectionWithTrialCards(
  collection: Readonly<Record<string, number>>,
  access: TrialCardAccess | null | undefined,
  catalog: readonly Pick<CardDefinition, "id" | "rarity" | "set" | "collectible">[],
  now: number | Date = Date.now(),
): Record<string, number> {
  if (!trialCardsAreActive(access, now)) return { ...collection };
  const effective = { ...collection };
  for (const card of catalog) {
    if (card.collectible === false || !card.set || !TRIAL_CARD_SETS.includes(card.set)) continue;
    effective[card.id] = Math.max(effective[card.id] ?? 0, card.rarity === "传说" ? 1 : 2);
  }
  return effective;
}
