import { runAiTurn } from "./engine.js";
import type { BattleCommand, MatchState, PlayerId } from "./types.js";

export type AiTurnReplayStep = {
  state: MatchState;
  eventCount: number;
};

export type AiTurnReplayPlan = {
  commands: BattleCommand[];
  finalState: MatchState;
  initialEventCount: number;
  steps: AiTurnReplayStep[];
};

/**
 * Local matches always orient the human as player 0 and the AI as player 1.
 * Keep this decision outside React so opening-hand transitions can be tested
 * without a browser harness.
 */
export function shouldScheduleLocalAiTurn(
  state: MatchState,
  online: boolean,
): boolean {
  return !online && state.phase === "main" && state.activePlayer === 1;
}

/**
 * Resolve one complete AI turn while retaining every accepted reducer step.
 * The UI can reveal these immutable snapshots at its own cadence, while the
 * proof transcript and final state still come from the same reducer run.
 */
export function planAiTurnReplay(
  state: MatchState,
  player: PlayerId = 1,
): AiTurnReplayPlan {
  const commands: BattleCommand[] = [];
  const steps: AiTurnReplayStep[] = [];
  const initialEventCount = state.events.length;
  const finalState = runAiTurn(state, player, (stepState, command) => {
    commands.push(command);
    steps.push({
      state: stepState,
      eventCount: stepState.events.length,
    });
  });

  return {
    commands,
    finalState,
    initialEventCount,
    steps,
  };
}
