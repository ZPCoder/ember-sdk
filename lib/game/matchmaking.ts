export const HIDDEN_MMR_START = 1500;
export const HIDDEN_MMR_MIN = 400;
export const HIDDEN_MMR_MAX = 2800;
export const MATCHMAKING_WINDOW_INITIAL = 120;
export const MATCHMAKING_WINDOW_STEP = 80;
export const MATCHMAKING_WINDOW_STEP_MS = 10_000;
export const MATCHMAKING_WINDOW_MAX = 720;

export type HiddenMmrResult = "win" | "loss" | "draw";
export type MatchQuality = "ideal" | "close" | "expanded";

export type HiddenMmrSnapshot = {
  rating: number;
  games: number;
};

export function normalizeHiddenMmr(value: number): number {
  if (!Number.isFinite(value)) return HIDDEN_MMR_START;
  return Math.min(HIDDEN_MMR_MAX, Math.max(HIDDEN_MMR_MIN, Math.round(value)));
}

/** Bootstrap legacy accounts without turning their visible rank into MMR. */
export function initialHiddenMmrForVisibleRating(visibleRating: number): number {
  const safeVisible = Number.isFinite(visibleRating) ? Math.max(0, Math.floor(visibleRating)) : 1000;
  return normalizeHiddenMmr(HIDDEN_MMR_START + Math.round((safeVisible - 1000) * 0.55));
}

export function hiddenMmrExpectedScore(rating: number, opponentRating: number): number {
  const difference = normalizeHiddenMmr(opponentRating) - normalizeHiddenMmr(rating);
  return 1 / (1 + 10 ** (difference / 400));
}

function hiddenMmrKFactor(games: number): number {
  if (games < 10) return 48;
  if (games < 30) return 32;
  return 24;
}

export function updateHiddenMmr(
  snapshot: HiddenMmrSnapshot,
  opponentRating: number,
  result: HiddenMmrResult,
): HiddenMmrSnapshot {
  const rating = normalizeHiddenMmr(snapshot.rating);
  const games = Number.isFinite(snapshot.games) ? Math.max(0, Math.floor(snapshot.games)) : 0;
  const score = result === "win" ? 1 : result === "loss" ? 0 : 0.5;
  const expected = hiddenMmrExpectedScore(rating, opponentRating);
  return {
    rating: normalizeHiddenMmr(rating + hiddenMmrKFactor(games) * (score - expected)),
    games: games + 1,
  };
}

export function updateHiddenMmrPair(
  host: HiddenMmrSnapshot,
  guest: HiddenMmrSnapshot,
  winner: 0 | 1 | null,
): [HiddenMmrSnapshot, HiddenMmrSnapshot] {
  const hostResult: HiddenMmrResult = winner === null ? "draw" : winner === 0 ? "win" : "loss";
  const guestResult: HiddenMmrResult = winner === null ? "draw" : winner === 1 ? "win" : "loss";
  return [
    updateHiddenMmr(host, guest.rating, hostResult),
    updateHiddenMmr(guest, host.rating, guestResult),
  ];
}

/** Tight first, then deliberately widen so fairness does not create endless queues. */
export function matchmakingSearchWindow(waitMs: number): number {
  const safeWait = Number.isFinite(waitMs) ? Math.max(0, Math.floor(waitMs)) : 0;
  return Math.min(
    MATCHMAKING_WINDOW_MAX,
    MATCHMAKING_WINDOW_INITIAL + Math.floor(safeWait / MATCHMAKING_WINDOW_STEP_MS) * MATCHMAKING_WINDOW_STEP,
  );
}

export function matchQualityForGap(gap: number): MatchQuality {
  const safeGap = Number.isFinite(gap) ? Math.max(0, Math.floor(gap)) : Number.POSITIVE_INFINITY;
  if (safeGap <= 80) return "ideal";
  if (safeGap <= 200) return "close";
  return "expanded";
}
