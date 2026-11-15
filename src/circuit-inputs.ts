/**
 * Circuit input mapping — SINGLE POINT OF PATCH (see CIRCUIT_INPUTS_TODO.md).
 *
 * GATEKEEPER — CONFIRMED 15 Nov 2026 against the platform's own circuit
 * artifacts + a live Practice Mode task: signal names recovered by probing
 * the wasm's getInputSignalSize, encodings verified by groth16.verify
 * against the real verification key (REJECT dec=0 and APPROVE dec=1 both
 * verify; a REJECT on an all-pass vector asserts in the circuit, proving
 * the circuit enforces the decision). See CIRCUIT_INPUTS_TODO.md.
 *
 * VFY-POLICY — still TODO (Steal-the-VFY entry is closed; STRATEGY_PARAMS
 * also still unfilled). vfyCircuitInput still throws CircuitInputsTodoError.
 */
import { keccak256, toHex } from "viem";
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

/** BN128 scalar field prime (snarkjs normalizes inputs mod this prime). */
const FIELD_PRIME =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/** task_id -> field element: UUID (128-bit) as a number; else keccak256 mod p. */
function taskIdToField(taskId: string): string {
  const stripped = taskId.replace(/-/g, "");
  if (/^[0-9a-fA-F]+$/.test(stripped) && stripped.length > 0) {
    return BigInt(`0x${stripped}`).toString();
  }
  return (BigInt(keccak256(toHex(taskId))) % FIELD_PRIME).toString();
}

/**
 * Map a Proof Gatekeeper task + its decision onto the gatekeeper circuit's
 * input signals (template GatekeeperEvaluation_79). CONFIRMED 15 Nov 2026:
 * all 13 signals recovered from the wasm (inputSize 13 = nPublic 13) and
 * verified end-to-end with snarkjs groth16.verify against the real vk.
 *
 * Encodings: *_hash / addresses are hex -> BigInt decimal (witness calc
 * reduces mod p); numbers are decimal strings; decision APPROVE=1,
 * REJECT=0; taskId is the UUID as a 128-bit number; salt is a private
 * input, 0 (accepted by the circuit; not in public signals).
 * Note: reason_code and proof_tx are NOT circuit inputs.
 */
export function gatekeeperCircuitInput(
  task: GatekeeperInput,
  decision: "APPROVE" | "REJECT",
  _reasonCode: string,
  taskId: string,
): CircuitInput {
  return {
    registeredVkHash: BigInt(task.registered_vk).toString(),
    proofVkHash: BigInt(task.proof_vk).toString(),
    minimum: String(task.minimum),
    publicBalance: String(task.public_balance),
    expiryBlock: String(task.expiry_block),
    currentBlock: String(task.current_block),
    recipient: BigInt(task.recipient).toString(),
    conditionRecipient: BigInt(task.condition_recipient).toString(),
    amount: String(task.amount),
    maxTransfer: String(task.max_transfer),
    decision: decision === "APPROVE" ? "1" : "0",
    taskId: taskIdToField(taskId),
    salt: "0",
  };
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
