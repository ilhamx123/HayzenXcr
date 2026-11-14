/**
 * Circuit artifact resolution for runtimes where the build-time
 * circuits/ directory is not present at runtime.
 *
 * Verified live 14 Nov 2026: on Vercel the project runs as a legacy
 * server (root entrypoint dist/server.js) and vercel.json `includeFiles`
 * only covers api/index.ts, so the root server function has NO
 * ./circuits at runtime (runtime warning: "could not create directory
 * ./circuits: ENOENT"). Without this, generateProof() throws "Circuit
 * WASM not found" and every provable task is answered without a proof.
 *
 * Behavior:
 * - If the requested file already exists at the given path, use it
 *   unchanged. Back4app/Docker (local ./circuits) and the api/
 *   function (bundled ./circuits) are therefore unaffected.
 * - Otherwise download it by basename from the official public circuit
 *   host into /tmp/agent-games-circuits/ (writable on serverless) and
 *   use the downloaded copy. The download is verified against the
 *   known artifact sizes from the Vercel build log.
 * - Concurrent callers share one in-flight download per file. A failed
 *   download surfaces as the usual "not found" error, so the caller
 *   still answers the decision without a proof (fail-soft, same as
 *   today) — the decision path never depends on the download.
 */
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const CIRCUIT_BASE_URL = "https://agentgames.zkverify.io/circuits";

/** Writable scratch dir on serverless runtimes (per-instance, ephemeral). */
const CACHE_DIR = "/tmp/agent-games-circuits";

const DOWNLOAD_TIMEOUT_MS = 30_000;

/** Artifact sizes as confirmed by the Vercel build log (14 Nov 2026). */
const EXPECTED_SIZES: Record<string, number> = {
  "gatekeeper.wasm": 1755820,
  "gatekeeper_final.zkey": 309750,
  "vfy-policy.wasm": 2991212,
  "vfy-policy_final.zkey": 810586,
};

const inFlight = new Map<string, Promise<string>>();

function cachePath(file: string): string {
  return join(CACHE_DIR, file);
}

function basename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

async function downloadCircuit(file: string): Promise<string> {
  const dest = cachePath(file);
  if (existsSync(dest)) return dest;
  const existing = inFlight.get(file);
  if (existing) return existing;
  const job = (async (): Promise<string> => {
    mkdirSync(CACHE_DIR, { recursive: true });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    try {
      const res = await fetch(`${CIRCUIT_BASE_URL}/${file}`, {
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`Circuit download failed: ${file} HTTP ${res.status}`);
      }
      const bytes = Buffer.from(await res.arrayBuffer());
      const expected = EXPECTED_SIZES[file];
      if (expected !== undefined && bytes.length !== expected) {
        throw new Error(
          `Circuit download failed: ${file} size ${bytes.length} != expected ${expected}`,
        );
      }
      if (bytes.length === 0) {
        throw new Error(`Circuit download failed: ${file} is empty`);
      }
      const tmp = `${dest}.tmp-${process.pid}`;
      writeFileSync(tmp, bytes);
      renameSync(tmp, dest);
      return dest;
    } finally {
      clearTimeout(timer);
    }
  })();
  inFlight.set(file, job);
  try {
    return await job;
  } finally {
    inFlight.delete(file);
  }
}

/**
 * Resolve the usable path for each circuit file: the local path when it
 * exists, otherwise a lazily downloaded copy in /tmp. Throws when a file
 * is neither present nor downloadable (caller treats this as "proof
 * unavailable", decision still goes out).
 */
export async function resolveCircuitFiles(
  wasmPath: string,
  zkeyPath: string,
): Promise<{ wasmPath: string; zkeyPath: string }> {
  const resolved: { wasmPath: string; zkeyPath: string } = { wasmPath, zkeyPath };
  for (const key of ["wasmPath", "zkeyPath"] as const) {
    const p = resolved[key];
    if (!existsSync(p)) {
      resolved[key] = await downloadCircuit(basename(p));
    }
  }
  return resolved;
}
