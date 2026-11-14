/**
 * Runtime configuration. All secrets come from environment variables only —
 * nothing secret is ever hardcoded or committed.
 */
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export const GATEKEEPER_VK_HASH =
  "0x6b79c6012a6d8651f3e13bc4d2a20370280ab49700c90c5316d4168bfbad77b0";
export const VFY_POLICY_VK_HASH =
  "0x6c56509f1c56fd1fd4e9737f906d2220f4b95f1d507f1adf6899085bd74be047";

export const GATEKEEPER_WASM = "gatekeeper.wasm";
export const GATEKEEPER_ZKEY = "gatekeeper_final.zkey";
export const VFY_WASM = "vfy-policy.wasm";
export const VFY_ZKEY = "vfy-policy_final.zkey";

export const PROTOCOL_VERSION = "v1";

/** Hard response deadline for Proof Gatekeeper tasks (platform: 60 s). */
export const GATEKEEPER_DEADLINE_MS = 60_000;
/** Safety margin: we answer at most this long before the platform deadline. */
export const RESPONSE_MARGIN_MS = 5_000;

export interface Config {
  port: number;
  hmacSecret: string;
  kurierApiKey: string;
  strategySalt: string;
  circuitsDir: string;
  dataDir: string;
}

function env(name: string, fallback = ""): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

/**
 * Create a directory when it does not exist. Fail-soft: on a serverless
 * filesystem (read-only outside /tmp) creation can fail — the caller must
 * tolerate a missing directory (SeenStore fails soft; circuit reads fail
 * with a clear error if the artifacts are absent).
 */
function ensureDir(dir: string): void {
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  } catch (err) {
    console.warn(
      `[config] could not create directory ${dir}: ${err instanceof Error ? err.message : err}`,
    );
  }
}

export function loadConfig(): Config {
  const hmacSecret = env("AGENT_GAMES_HMAC_SECRET");
  if (!hmacSecret) {
    throw new Error(
      "AGENT_GAMES_HMAC_SECRET is not set. Copy .env.example to .env and " +
        "paste the one-time secret from the Agent Games dashboard (Rotate Secret).",
    );
  }
  const circuitsDir = env("CIRCUITS_DIR", "./circuits");
  // On Vercel the filesystem is read-only outside /tmp, so the seen-store
  // defaults there (per warm instance, ephemeral). Anywhere else: ./data.
  const dataDir = env(
    "DATA_DIR",
    process.env.VERCEL === "1" ? "/tmp/agent-games-data" : "./data",
  );
  for (const dir of [circuitsDir, dataDir]) ensureDir(dir);
  return {
    port: Number(env("PORT", "8080")),
    hmacSecret,
    kurierApiKey: env("KURIER_API_KEY"),
    strategySalt: env("STRATEGY_SALT"),
    circuitsDir,
    dataDir,
  };
}

export function circuitPath(circuitsDir: string, file: string): string {
  return join(circuitsDir, file);
}
