/**
 * Local Groth16 proof generation with snarkjs (Circom 2.x, BN128).
 * The proving key (.zkey) and WASM are downloaded at setup into circuits/
 * (see scripts/download-circuits.mjs) and are never committed.
 */
import { existsSync } from "node:fs";
import * as snarkjs from "snarkjs";
import type { CircuitInput } from "./circuit-inputs.js";
import { resolveCircuitFiles } from "./circuits.js";

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
  // Resolution (incl. lazy download when the artifacts are missing, e.g.
  // Vercel legacy-server function) runs INSIDE the raced promise, so a
  // slow download still cannot eat the response deadline.
  const proofPromise = (async () => {
    const resolved = await resolveCircuitFiles(wasmPath, zkeyPath);
    if (!existsSync(resolved.wasmPath)) {
      throw new Error(`Circuit WASM not found: ${wasmPath} (run npm run setup)`);
    }
    if (!existsSync(resolved.zkeyPath)) {
      throw new Error(`Circuit zkey not found: ${zkeyPath} (run npm run setup)`);
    }
    return snarkjs.groth16.fullProve(input, resolved.wasmPath, resolved.zkeyPath);
  })();
  const timeout = new Promise<never>((_resolve, reject) =>
    setTimeout(() => reject(new Error("Proof generation timed out")), timeoutMs),
  );
  const { proof, publicSignals } = await Promise.race([proofPromise, timeout]);
  return { proof, publicSignals: publicSignals.map(String) };
}
