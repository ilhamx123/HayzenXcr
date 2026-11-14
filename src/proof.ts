/**
 * Local Groth16 proof generation with snarkjs (Circom 2.x, BN128).
 * The proving key (.zkey) and WASM are downloaded at setup into circuits/
 * (see scripts/download-circuits.mjs) and are never committed.
 */
import { existsSync } from "node:fs";
import * as snarkjs from "snarkjs";
import type { CircuitInput } from "./circuit-inputs.js";

export interface GeneratedProof {
  proof: unknown;
  publicSignals: string[];
}

export async function generateProof(
  input: CircuitInput,
  wasmPath: string,
  zkeyPath: string,
  timeoutMs = 45_000,
): Promise<GeneratedProof> {
  if (!existsSync(wasmPath)) {
    throw new Error(`Circuit WASM not found: ${wasmPath} (run npm run setup)`);
  }
  if (!existsSync(zkeyPath)) {
    throw new Error(`Circuit zkey not found: ${zkeyPath} (run npm run setup)`);
  }
  const proofPromise = snarkjs.groth16.fullProve(input, wasmPath, zkeyPath);
  const timeout = new Promise<never>((_resolve, reject) =>
    setTimeout(() => reject(new Error("Proof generation timed out")), timeoutMs),
  );
  const { proof, publicSignals } = await Promise.race([proofPromise, timeout]);
  return { proof, publicSignals: publicSignals.map(String) };
}
