#!/usr/bin/env node
/**
 * Print the Poseidon commitment hash of (STRATEGY_PARAMS + STRATEGY_SALT).
 *
 * Register the printed hash with the platform as your Steal-the-VFY
 * strategy commitment BEFORE Swiss Round 1 opens. The commitment is
 * frozen mid-match — do not change STRATEGY_PARAMS afterwards.
 *
 * SECURITY: this script prints ONLY the commitment hash. It never prints
 * the salt or the strategy parameters.
 *
 * Usage:
 *   npm run build
 *   STRATEGY_SALT=<your secret salt> npm run commitment
 */
import { buildPoseidon } from "circomlibjs";
import { STRATEGY_PARAMS, isStrategyConfigured } from "../dist/vfy-policy.js";

const saltRaw = process.env.STRATEGY_SALT;
if (!saltRaw) {
  console.error("STRATEGY_SALT is not set. Set it in .env (a random decimal or 0x-hex integer).");
  process.exit(1);
}
let salt;
try {
  salt = BigInt(saltRaw);
} catch {
  console.error("STRATEGY_SALT must be a decimal or 0x-hex integer.");
  process.exit(1);
}

const paramValues = Object.keys(STRATEGY_PARAMS)
  .sort()
  .map((k) => STRATEGY_PARAMS[k])
  .filter((v) => typeof v === "number")
  .map((v) => BigInt(Math.floor(v)));

if (!isStrategyConfigured(STRATEGY_PARAMS)) {
  console.error(
    "WARNING: STRATEGY_PARAMS is still the empty TODO placeholder " +
      "(src/vfy-policy.ts). This commitment commits to an all-HOLD policy. " +
      "Fill in your strategy parameters first, rebuild, then re-run.",
  );
}

const poseidon = await buildPoseidon();
const hash = poseidon([salt, ...paramValues]);
const hex = `0x${BigInt(poseidon.F.toString(hash)).toString(16).padStart(64, "0")}`;
console.log(hex);
