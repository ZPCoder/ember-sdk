import { applyCommand } from "./game/engine.js";
import type { BattleCommand, MatchState } from "./game/types.js";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

export function canonicalState(state: MatchState): string {
  return JSON.stringify(canonicalize(state));
}

/** Portable FNV-1a digest used by React, Cocos, local AI, and server replay parity gates. */
export function stateDigest(state: MatchState): string {
  const bytes = new TextEncoder().encode(canonicalState(state));
  let hash = 0xcbf29ce484222325n;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

export function replayCommands(initial: MatchState, commands: readonly BattleCommand[]): MatchState {
  let state = initial;
  for (const command of commands) {
    const result = applyCommand(state, command);
    if (!result.accepted) {
      throw new Error(`Replay rejected ${command.type}: ${result.error?.code ?? "unknown"}`);
    }
    state = result.state;
  }
  return state;
}
