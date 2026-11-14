/**
 * Steal the VFY — turn handling and the public-inputs hash.
 *
 * Actions: HOLD (free), FORTIFY (cost 2, blocks up to 6 incoming
 * extraction), EXTRACT N (N <= 10, free; a fortified opponent cuts the
 * gain by 6). Start 100 VFY each, 20 turns, 5 Swiss rounds, 5 min/turn.
 *
 * publicInputsHash — EXACT field order, keccak256 of ABI-packed 32-byte
 * big-endian fields:
 *   [commitmentHash, matchId (0x-hex, dashes stripped, as BigInt), turn,
 *    selfBalance, opponentBalance, actionCode (HOLD 0, FORTIFY 1,
 *    EXTRACT 2), amount (0 for HOLD/FORTIFY), circuitVersion "v1" -> 1]
 * The platform independently recomputes this hash from the game state it
 * knows and rejects any proof where the hashes diverge, so it is computed
 * BEFORE submitting anything to zkVerify.
 */
import { concat, keccak256, numberToHex } from "viem";

export const ACTION_CODE = { HOLD: 0, FORTIFY: 1, EXTRACT: 2 } as const;

export type VfyActionType = keyof typeof ACTION_CODE;

export interface VfyAction {
  type: VfyActionType;
  /** Present ONLY for EXTRACT (1..10). MUST be omitted for HOLD/FORTIFY. */
  amount?: number;
}

export interface VfyState {
  selfBalance: string;
  opponentBalance: string;
  selfFortifiedUntilTurn: number | null;
  opponentFortifiedUntilTurn: number | null;
}

export interface VfyTurnEnvelope {
  protocolVersion: string;
  eventId: string;
  mode?: string;
  matchId: string;
  turn: number;
  issuedAt?: string;
  deadlineAt?: string;
  state: VfyState;
  strategyCommitment: { hash: string };
  resolverVersion?: string;
  nonce?: string;
}

/** Parse a match id (0x-hex or dash-separated hex, e.g. a UUID) as a BigInt. */
export function matchIdToBigInt(matchId: string): bigint {
  const cleaned = matchId.replace(/^0x/i, "").replace(/-/g, "");
  if (!/^[0-9a-fA-F]+$/.test(cleaned)) {
    throw new Error(`matchId is not hex: ${matchId}`);
  }
  return BigInt(`0x${cleaned}`);
}

function toBytes32(value: bigint | number | string): `0x${string}` {
  if (typeof value === "string") {
    const hex = value.startsWith("0x") ? value : `0x${value}`;
    const body = hex.slice(2);
    if (!/^[0-9a-fA-F]*$/.test(body) || body.length > 64) {
      throw new Error(`Value is not a 32-byte hex string: ${value}`);
    }
    return `0x${body.padStart(64, "0")}` as `0x${string}`;
  }
  return numberToHex(BigInt(value), { size: 32 });
}

export function computePublicInputsHash(opts: {
  commitmentHash: string;
  matchId: string;
  turn: number;
  selfBalance: string | number;
  opponentBalance: string | number;
  action: VfyAction;
  circuitVersion?: string;
}): string {
  const actionCode = ACTION_CODE[opts.action.type];
  const amount = opts.action.type === "EXTRACT" ? (opts.action.amount ?? 0) : 0;
  const circuitVersion =
    opts.circuitVersion === undefined ? 1 : opts.circuitVersion === "v1" ? 1 : Number(opts.circuitVersion);
  if (!Number.isInteger(circuitVersion) || circuitVersion < 0) {
    throw new Error(`Unsupported circuitVersion: ${opts.circuitVersion}`);
  }
  const packed = concat([
    toBytes32(opts.commitmentHash),
    toBytes32(matchIdToBigInt(opts.matchId)),
    toBytes32(opts.turn),
    toBytes32(BigInt(opts.selfBalance)),
    toBytes32(BigInt(opts.opponentBalance)),
    toBytes32(actionCode),
    toBytes32(amount),
    toBytes32(circuitVersion),
  ]);
  return keccak256(packed);
}
