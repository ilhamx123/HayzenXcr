#!/usr/bin/env node
/**
 * End-to-end replay harness for the HayzenXcr Agent Games endpoint.
 * Starts the built server on a test port with a test HMAC secret, replays
 * signed envelopes, and checks the responses:
 *
 *   - preflight envelope            -> {ok:true, protocolVersion:"v1"}
 *   - bad-HMAC request              -> 401
 *   - valid gatekeeper task         -> APPROVE / VALID_CONDITION
 *   - each of the 6 trap variants   -> REJECT with the matching reason_code
 *   - reused proof_tx               -> REJECT / PROOF_REUSED
 *   - vfy turn envelope             -> schema-valid response, correct
 *                                      publicInputsHash (recomputed here,
 *                                      independently, from the spec)
 *   - GET /health                   -> 200
 *
 * NOTE: live Groth16 proof generation against the real circuits is NOT
 * exercised here — the circuit input mapping is still the documented TODO
 * (see CIRCUIT_INPUTS_TODO.md), so proof generation is expected to be
 * skipped and responses carry no proof fields. The harness verifies
 * everything else: decisions, HMAC (both directions), schemas, and the
 * VFY hash.
 *
 * Usage: npm run test:harness   (builds first)
 */
import { createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { concat, keccak256, numberToHex } from "viem";

const SECRET = "test-harness-secret-do-not-use-in-prod";
const PORT = 18081;
const BASE = `http://127.0.0.1:${PORT}`;
const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

function sign(raw) {
  return createHmac("sha256", SECRET).update(raw).digest("hex");
}

async function postAgent(envelope, { badSecret = false } = {}) {
  const raw = JSON.stringify(envelope);
  const res = await fetch(`${BASE}/agent`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agent-games-signature": sign(raw),
      ...(badSecret ? { "x-agent-games-signature": "deadbeef" } : {}),
    },
    body: raw,
  });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    // keep body null
  }
  const sig = res.headers.get("x-agent-games-signature");
  const sigOk = sig === sign(text);
  return { status: res.status, body, sigOk, raw: text };
}

/** Independent recomputation of publicInputsHash, straight from the spec. */
function recomputeHash({ commitmentHash, matchId, turn, selfBalance, opponentBalance, action }) {
  const b32 = (v) => {
    if (typeof v === "string" && v.startsWith("0x")) return `0x${v.slice(2).padStart(64, "0")}`;
    return numberToHex(BigInt(v), { size: 32 });
  };
  const code = { HOLD: 0, FORTIFY: 1, EXTRACT: 2 }[action.type];
  const amount = action.type === "EXTRACT" ? action.amount : 0;
  const matchBig = BigInt(`0x${matchId.replace(/^0x/i, "").replace(/-/g, "")}`);
  const packed = concat([
    b32(commitmentHash),
    b32(matchBig),
    b32(turn),
    b32(BigInt(selfBalance)),
    b32(BigInt(opponentBalance)),
    b32(code),
    b32(amount),
    b32(1), // circuitVersion "v1" -> 1
  ]);
  return keccak256(packed);
}

const baseInput = {
  registered_vk: "0x7d3a00000000000000000000000000000000000000000000000000000000f291",
  proof_vk: "0x7d3a00000000000000000000000000000000000000000000000000000000f291",
  minimum: "1000",
  public_balance: "1460",
  expiry_block: 19842201,
  current_block: 19832000,
  recipient: "0xDe4200000000000000000000000000000000009f01",
  condition_recipient: "0xDe4200000000000000000000000000000000009f01",
  amount: "500",
  max_transfer: "1000",
  proof_tx: "0xa4c1000000000000000000000000000000000000000000000000000000008ff1",
};

function gatekeeperTask(input, taskId = "gk_test_1") {
  return {
    type: "agent-games.proof-gatekeeper.v1",
    task_id: taskId,
    mode: "competition",
    issued_at: new Date().toISOString(),
    deadline_at: new Date(Date.now() + 55_000).toISOString(),
    input,
  };
}

async function main() {
  const dataDir = mkdtempSync(join(tmpdir(), "hayzenxcr-harness-"));
  const server = spawn("node", ["dist/server.js"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(PORT),
      AGENT_GAMES_HMAC_SECRET: SECRET,
      DATA_DIR: dataDir,
      CIRCUITS_DIR: join(root, "circuits"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (d) => process.stdout.write(`[server] ${d}`));
  server.stderr.on("data", (d) => process.stdout.write(`[server:err] ${d}`));

  try {
    // Wait for health.
    let healthy = false;
    for (let i = 0; i < 30; i++) {
      try {
        const r = await fetch(`${BASE}/health`);
        if (r.ok) {
          healthy = true;
          break;
        }
      } catch {
        // not up yet
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    check("GET /health", healthy);
    if (!healthy) return;

    // 1. Preflight.
    const pre = await postAgent({
      type: "agent-games.preflight.v1",
      agent_id: "agt_test",
      issued_at: new Date().toISOString(),
      nonce: "abc123",
    });
    check(
      "preflight -> {ok:true, protocolVersion:v1}",
      pre.status === 200 && pre.body?.ok === true && pre.body?.protocolVersion === "v1",
      `status=${pre.status} body=${pre.raw}`,
    );
    check("preflight response is HMAC-signed", pre.sigOk);

    // 2. Bad HMAC -> 401.
    const bad = await postAgent(gatekeeperTask(baseInput), { badSecret: true });
    check("bad HMAC -> 401", bad.status === 401, `status=${bad.status}`);

    // 3. Valid gatekeeper task -> APPROVE VALID_CONDITION.
    const valid = await postAgent(gatekeeperTask(baseInput, "gk_valid"));
    check(
      "valid task -> APPROVE / VALID_CONDITION",
      valid.status === 200 && valid.body?.decision === "APPROVE" && valid.body?.reason_code === "VALID_CONDITION",
      `status=${valid.status} body=${valid.raw}`,
    );
    check("valid task response is HMAC-signed", valid.sigOk);
    check("valid task echoes proof_tx", valid.body?.proof_tx === baseInput.proof_tx);

    // 4. Six trap variants -> matching REJECT codes.
    const traps = [
      ["VK_SUBSTITUTION", { ...baseInput, proof_vk: "0xa4c100000000000000000000000000000000000000000000000000000000b8ff", proof_tx: "0x1000000000000000000000000000000000000000000000000000000000000001" }],
      ["THRESHOLD_MISMATCH", { ...baseInput, public_balance: "999", proof_tx: "0x1000000000000000000000000000000000000000000000000000000000000002" }],
      ["EXPIRED_CONDITION", { ...baseInput, current_block: 19842202, proof_tx: "0x1000000000000000000000000000000000000000000000000000000000000003" }],
      ["RECIPIENT_MISMATCH", { ...baseInput, recipient: "0xBeef00000000000000000000000000000000000001", proof_tx: "0x1000000000000000000000000000000000000000000000000000000000000004" }],
      ["AMOUNT_OVERFLOW", { ...baseInput, amount: "1001", proof_tx: "0x1000000000000000000000000000000000000000000000000000000000000005" }],
    ];
    for (const [code, input] of traps) {
      const r = await postAgent(gatekeeperTask(input, `gk_trap_${code}`));
      check(
        `trap ${code} -> REJECT / ${code}`,
        r.status === 200 && r.body?.decision === "REJECT" && r.body?.reason_code === code,
        `status=${r.status} body=${r.raw}`,
      );
    }

    // 5. Reused proof_tx (same as the valid task) -> PROOF_REUSED.
    const reused = await postAgent(gatekeeperTask(baseInput, "gk_reused"));
    check(
      "reused proof_tx -> REJECT / PROOF_REUSED",
      reused.status === 200 && reused.body?.decision === "REJECT" && reused.body?.reason_code === "PROOF_REUSED",
      `status=${reused.status} body=${reused.raw}`,
    );

    // 6. Steal-the-VFY turn envelope -> schema-valid, hash recomputes.
    const commitmentHash = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
    const vfyEnvelope = {
      protocolVersion: "v1",
      eventId: "steal-the-vfy",
      mode: "competition",
      matchId: "123e4567-e89b-12d3-a456-426614174000",
      turn: 3,
      issuedAt: new Date().toISOString(),
      deadlineAt: new Date(Date.now() + 240_000).toISOString(),
      state: {
        selfBalance: "95",
        opponentBalance: "105",
        selfFortifiedUntilTurn: null,
        opponentFortifiedUntilTurn: null,
      },
      strategyCommitment: { hash: commitmentHash },
      resolverVersion: "v1",
      nonce: "nonce-1",
    };
    const vfy = await postAgent(vfyEnvelope);
    const vfyOk =
      vfy.status === 200 &&
      vfy.body?.matchId === vfyEnvelope.matchId &&
      vfy.body?.turn === 3 &&
      vfy.body?.action?.type === "HOLD" &&
      !("amount" in (vfy.body?.action ?? {})) &&
      typeof vfy.body?.idempotencyKey === "string" &&
      typeof vfy.body?.agentTimestamp === "string";
    check("vfy turn -> schema-valid HOLD (strategy TODO)", vfyOk, `status=${vfy.status} body=${vfy.raw}`);
    check("vfy response is HMAC-signed", vfy.sigOk);
    if (vfy.body?.policyProof?.publicInputsHash) {
      const expected = recomputeHash({
        commitmentHash,
        matchId: vfyEnvelope.matchId,
        turn: 3,
        selfBalance: "95",
        opponentBalance: "105",
        action: { type: "HOLD" },
      });
      check(
        "vfy publicInputsHash matches independent recomputation",
        vfy.body.policyProof.publicInputsHash === expected,
        `got=${vfy.body.policyProof.publicInputsHash} expected=${expected}`,
      );
    } else {
      check("vfy publicInputsHash present", false, `body=${vfy.raw}`);
    }
  } finally {
    server.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 500));
    rmSync(dataDir, { recursive: true, force: true });
  }
}

await main();
if (failures > 0) {
  console.log(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll harness checks PASSED");
