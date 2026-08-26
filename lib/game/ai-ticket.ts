import type { RankedFormat } from "./types.ts";

export type AiMatchTicketParameters = {
  token: string;
  seed: number;
  startingPlayer: 0 | 1;
  rankedFormat: RankedFormat;
  playerDeck: readonly string[];
  opponentArchetypeId: string;
};

export type AiMatchProofParameters = {
  ticketToken: string;
  seed: number;
  startingPlayer: 0 | 1;
  rankedFormat: RankedFormat;
  playerDeck: readonly string[];
  opponentArchetypeId: string;
};

/**
 * The server signs AI match parameters by persisting them under an opaque
 * one-use token. Settlement must compare every replay-affecting field,
 * including deck order, so a client cannot use a valid token with a more
 * favourable seed, first player, opponent, or draw order.
 */
export function aiMatchTicketMatchesProof(
  ticket: AiMatchTicketParameters,
  proof: AiMatchProofParameters,
): boolean {
  return (
    ticket.token === proof.ticketToken &&
    ticket.seed === proof.seed &&
    ticket.startingPlayer === proof.startingPlayer &&
    ticket.rankedFormat === proof.rankedFormat &&
    ticket.opponentArchetypeId === proof.opponentArchetypeId &&
    ticket.playerDeck.length === proof.playerDeck.length &&
    ticket.playerDeck.every((cardId, index) => cardId === proof.playerDeck[index])
  );
}
