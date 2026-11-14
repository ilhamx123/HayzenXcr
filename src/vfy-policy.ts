/**
 * Steal the VFY — committed strategy policy.
 *
 * ⚠️ TODO (OWNER): DO NOT let anyone else fill this in for you. Per the
 * official starter prompt, the strategy is yours to decide — a vibecoded
 * harness is fine, a vibecoded strategy is not a strategy. This module is
 * the harness: a pure deterministic function of (game state, STRATEGY_PARAMS).
 * The harness proves whatever parameters you commit; it never invents them.
 *
 * HOW TO FILL IN STRATEGY_PARAMS:
 *   1. Choose your policy knobs below (thresholds/amounts are examples of
 *      the SHAPE only — every value is unset until you set it).
 *   2. Run `npm run commitment` to print the Poseidon commitment hash of
 *      (STRATEGY_PARAMS + STRATEGY_SALT). Register that hash with the
 *      platform as your strategy commitment BEFORE Swiss Round 1 opens.
 *   3. Do not change STRATEGY_PARAMS mid-tournament: the commitment is
 *      frozen mid-match and a mismatched circuitVersion/commitment is
 *      rejected by the platform.
 *
 * Until STRATEGY_PARAMS is filled in, the policy returns HOLD on every
 * turn — the safe default (a missing/invalid proof scores as HOLD anyway,
 * and HOLD never submits an invalid action).
 */
import type { VfyAction, VfyState } from "./vfy.js";

export interface StrategyParams {
  /**
   * TODO(owner): minimum opponent balance at which EXTRACT becomes
   * eligible. Unset = never extract.
   */
  extractMinOpponentBalance?: number;
  /**
   * TODO(owner): amount to extract when eligible (1..10). Unset = never
   * extract.
   */
  extractAmount?: number;
  /**
   * TODO(owner): minimum own balance at which FORTIFY becomes eligible.
   * Unset = never fortify.
   */
  fortifyMinSelfBalance?: number;
}

/**
 * TODO(owner): fill in your strategy parameters. Currently an empty
 * placeholder — the policy below therefore returns HOLD on every turn.
 */
export const STRATEGY_PARAMS: StrategyParams = {
  // extractMinOpponentBalance: undefined,
  // extractAmount: undefined,
  // fortifyMinSelfBalance: undefined,
};

export function isStrategyConfigured(params: StrategyParams): boolean {
  return (
    params.extractMinOpponentBalance !== undefined ||
    params.extractAmount !== undefined ||
    params.fortifyMinSelfBalance !== undefined
  );
}

/**
 * Pure deterministic policy: (game state, strategy params) -> action.
 * - Opponent fortified through this turn: never EXTRACT into a wall
 *   (fortification cuts the gain by 6); FORTIFY instead if configured.
 * - EXTRACT only when the configured opponent-balance threshold is met,
 *   amount clamped to 1..10.
 * - FORTIFY only when the configured own-balance threshold is met and
 *   we are not already fortified.
 * - Anything unconfigured or uncertain -> HOLD.
 */
export function decideVfyAction(
  state: VfyState,
  turn: number,
  params: StrategyParams,
): VfyAction {
  const selfBalance = BigInt(state.selfBalance);
  const opponentBalance = BigInt(state.opponentBalance);
  const opponentFortified =
    state.opponentFortifiedUntilTurn !== null && state.opponentFortifiedUntilTurn >= turn;
  const selfFortified =
    state.selfFortifiedUntilTurn !== null && state.selfFortifiedUntilTurn >= turn;

  if (!opponentFortified) {
    if (
      params.extractMinOpponentBalance !== undefined &&
      params.extractAmount !== undefined &&
      opponentBalance >= BigInt(params.extractMinOpponentBalance)
    ) {
      const amount = Math.max(1, Math.min(10, Math.floor(params.extractAmount)));
      return { type: "EXTRACT", amount };
    }
  }
  if (
    !selfFortified &&
    params.fortifyMinSelfBalance !== undefined &&
    selfBalance >= BigInt(params.fortifyMinSelfBalance)
  ) {
    return { type: "FORTIFY" };
  }
  return { type: "HOLD" };
}
