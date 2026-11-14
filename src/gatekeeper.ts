/**
 * Proof Gatekeeper — deterministic decision logic. NO LLM, NO heuristics.
 * APPROVE only if every check passes; otherwise REJECT with the matching
 * reason_code. Checks run in the platform's priority order (each task
 * carries a single trap):
 *   1. proof_vk === registered_vk            else VK_SUBSTITUTION
 *   2. BigInt(public_balance) >= BigInt(minimum) else THRESHOLD_MISMATCH
 *   3. proof_tx not seen before              else PROOF_REUSED
 *   4. current_block <= expiry_block         else EXPIRED_CONDITION
 *   5. recipient === condition_recipient     else RECIPIENT_MISMATCH
 *   6. BigInt(amount) <= BigInt(max_transfer) else AMOUNT_OVERFLOW
 * All pass -> APPROVE / VALID_CONDITION.
 */

export interface GatekeeperInput {
  registered_vk: string;
  proof_vk: string;
  minimum: string;
  public_balance: string;
  expiry_block: number;
  current_block: number;
  recipient: string;
  condition_recipient: string;
  amount: string;
  max_transfer: string;
  proof_tx: string;
}

export interface GatekeeperTask {
  type: string;
  task_id: string;
  mode?: string;
  issued_at?: string;
  deadline_at?: string;
  input: GatekeeperInput;
}

export type GatekeeperDecision = "APPROVE" | "REJECT";

export type GatekeeperReasonCode =
  | "VALID_CONDITION"
  | "VK_SUBSTITUTION"
  | "THRESHOLD_MISMATCH"
  | "PROOF_REUSED"
  | "EXPIRED_CONDITION"
  | "RECIPIENT_MISMATCH"
  | "AMOUNT_OVERFLOW";

export interface GatekeeperOutcome {
  decision: GatekeeperDecision;
  reason_code: GatekeeperReasonCode;
}

export function decideGatekeeper(
  input: GatekeeperInput,
  isProofReused: (proofTx: string) => boolean,
): GatekeeperOutcome {
  // (1) Verification key substitution: the proof verifies on-chain, but its
  // VK does not match the registered condition VK.
  if (input.proof_vk.toLowerCase() !== input.registered_vk.toLowerCase()) {
    return { decision: "REJECT", reason_code: "VK_SUBSTITUTION" };
  }
  // (2) Threshold mismatch: disclosed public balance below the minimum.
  if (BigInt(input.public_balance) < BigInt(input.minimum)) {
    return { decision: "REJECT", reason_code: "THRESHOLD_MISMATCH" };
  }
  // (3) Proof reused: the reference was already accepted in a previous task.
  if (isProofReused(input.proof_tx)) {
    return { decision: "REJECT", reason_code: "PROOF_REUSED" };
  }
  // (4) Expired condition: block-height expiry has passed.
  if (input.current_block > input.expiry_block) {
    return { decision: "REJECT", reason_code: "EXPIRED_CONDITION" };
  }
  // (5) Recipient mismatch: proof recipient differs from the condition.
  if (input.recipient.toLowerCase() !== input.condition_recipient.toLowerCase()) {
    return { decision: "REJECT", reason_code: "RECIPIENT_MISMATCH" };
  }
  // (6) Amount overflow: requested amount exceeds the single-transfer cap.
  if (BigInt(input.amount) > BigInt(input.max_transfer)) {
    return { decision: "REJECT", reason_code: "AMOUNT_OVERFLOW" };
  }
  return { decision: "APPROVE", reason_code: "VALID_CONDITION" };
}
