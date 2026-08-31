import assert from "node:assert/strict";
import test from "node:test";
import { createMatch } from "../src/game/engine.js";
import type { BattleCommand } from "../src/game/types.js";
import { replayCommands, stateDigest } from "../src/replay.js";

test("fixed seed and command sequence produce a cross-client state digest", () => {
  const commands: BattleCommand[] = [
    { type: "mulligan", player: 0, cardIndexes: [], commandId: "p0-mulligan" },
    { type: "mulligan", player: 1, cardIndexes: [], commandId: "p1-mulligan" },
  ];
  const first = replayCommands(createMatch({ seed: 20260831, matchId: "parity-fixture" }), commands);
  const second = replayCommands(createMatch({ seed: 20260831, matchId: "parity-fixture" }), commands);
  assert.equal(stateDigest(first), stateDigest(second));
  assert.match(stateDigest(first), /^[0-9a-f]{16}$/);
});

test("replay fails closed when a command is rejected", () => {
  assert.throws(
    () => replayCommands(createMatch({ seed: 1 }), [{ type: "end-turn", player: 0 }]),
    /Replay rejected/,
  );
});
