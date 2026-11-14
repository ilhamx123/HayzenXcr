/**
 * Circuit input mapping — SINGLE POINT OF PATCH (see CIRCUIT_INPUTS_TODO.md).
 *
 * ⚠️ TODO (UNCONFIRMED): the exact input signal names the platform's
 * Circom circuits expect have NOT been published in the build guide as of
 * 14 Nov 2026. These two functions are the ONLY place that maps a platform
 * task/turn onto snarkjs circuit inputs. Until the mapping is confirmed
 * against Practice Mode, both functions throw CircuitInputsTodoError.
 *
 * Everything else — decision logic, HMAC, response schemas, Kurier
 * submission, publicInputsHash — is fully implemented and unaffected.
 * Once the mapping is confirmed, fill in these two functions (and only
 * these) and re-run `npm run test:harness`.
 */
import type { GatekeeperInput } from "./gatekeeper.js";
import type { VfyAction, VfyState } from "./vfy.js";

export class CircuitInputsTodoError extends Error {
  constructor(circuit: string) {
    super(
      `CIRCUIT_INPUT_MAPPING_TODO (${circuit}): the exact Circom input signal ` +
        `names are not yet confirmed. Confirm them against Practice Mode, then ` +
        `fill in the mapping in src/circuit-inputs.ts (see CIRCUIT_INPUTS_TODO.md).`,
    );
    this.name = "CircuitInputsTodoError";
  }
}

/** Input object passed to snarkjs groth16.fullProve for the gatekeeper circuit. */
export type CircuitInput = Record<string, unknown>;

/**
 * Map a Proof Gatekeeper task + its decision onto the gatekeeper circuit's
 * input signals. TODO: fill in once the signal names are confirmed.
 */
export function gatekeeperCircuitInput(
  _task: GatekeeperInput,
  _decision: "APPROVE" | "REJECT",
  _reasonCode: string,
): CircuitInput {
  throw new CircuitInputsTodoError("gatekeeper");
}

/**
 * Map a Steal-the-VFY turn + chosen action onto the vfy-policy circuit's
 * input signals. TODO: fill in once the signal names are confirmed.
 */
export function vfyCircuitInput(
  _state: VfyState,
  _action: VfyAction,
  _commitmentHash: string,
  _publicInputsHash: string,
): CircuitInput {
  throw new CircuitInputsTodoError("vfy-policy");
}
