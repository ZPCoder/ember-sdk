export type PvpSettlementResult = "win" | "loss" | "draw";

export type PvpSettlementDerivation =
  | {
      ok: true;
      player: 0 | 1;
      result: PvpSettlementResult;
      opponentIdentity: string;
    }
  | {
      ok: false;
      reason:
        | "not-participant"
        | "ambiguous-participant"
        | "not-finished"
        | "invalid-result";
    };

/**
 * Derive a participant's result exclusively from the authoritative room
 * snapshot and identity binding. Client-supplied seat/result values are never
 * inputs to this function.
 */
export function derivePvpSettlement(input: {
  identity: string;
  hostIdentity: string;
  guestIdentity: string;
  phase?: string;
  winner?: number | null;
  reason?: string;
}): PvpSettlementDerivation {
  const isHost = input.hostIdentity === input.identity;
  const isGuest = input.guestIdentity === input.identity;
  if (isHost && isGuest) return { ok: false, reason: "ambiguous-participant" };
  if (!isHost && !isGuest) return { ok: false, reason: "not-participant" };
  if (input.phase !== "game-over") return { ok: false, reason: "not-finished" };

  const player = isHost ? 0 : 1;
  const opponentIdentity = isHost ? input.guestIdentity : input.hostIdentity;
  if (input.winner === null && input.reason === "draw") {
    return { ok: true, player, result: "draw", opponentIdentity };
  }
  if (input.winner !== 0 && input.winner !== 1) {
    return { ok: false, reason: "invalid-result" };
  }
  return {
    ok: true,
    player,
    result: input.winner === player ? "win" : "loss",
    opponentIdentity,
  };
}
