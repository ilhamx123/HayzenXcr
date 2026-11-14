#!/usr/bin/env node
/**
 * Download the Agent Games circuit artifacts into ./circuits/
 * (gitignored — binaries are never committed).
 *
 *   gatekeeper.wasm / gatekeeper_final.zkey   (vkHash 0x6b79c6...)
 *   vfy-policy.wasm / vfy-policy_final.zkey   (vkHash 0x6c5650...)
 *
 * Usage: npm run setup
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "https://agentgames.zkverify.io/circuits";
const FILES = [
  "gatekeeper.wasm",
  "gatekeeper_final.zkey",
  "vfy-policy.wasm",
  "vfy-policy_final.zkey",
];

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const circuitsDir = join(root, "circuits");
mkdirSync(circuitsDir, { recursive: true });

let failed = false;
for (const file of FILES) {
  const dest = join(circuitsDir, file);
  if (existsSync(dest)) {
    console.log(`skip (exists): ${file}`);
    continue;
  }
  console.log(`downloading ${file} ...`);
  const res = await fetch(`${BASE}/${file}`);
  if (!res.ok) {
    console.error(`FAILED ${file}: HTTP ${res.status}`);
    failed = true;
    continue;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(dest, buf);
  console.log(`saved ${file} (${buf.length} bytes)`);
}
if (failed) process.exit(1);
console.log("Circuits ready in ./circuits/");
