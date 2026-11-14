/**
 * HayzenXcr — Agent Games agent endpoint.
 *
 * node:http only (no web framework). One process, one port.
 *
 * Routes:
 *   GET  /health  -> {"ok":true,...} (unsigned; used by the platform + Render)
 *   GET  /        -> service info (unsigned)
 *   POST /agent   -> signed task endpoint (HMAC verified BEFORE parsing)
 *     - {"type":"agent-games.preflight.v1",...}            -> {ok, protocolVersion}
 *     - {"type":"agent-games.proof-gatekeeper.v1",...}     -> decision + proof
 *     - {"eventId":"steal-the-vfy",...}                    -> turn action + policy proof
 *
 * Fail-closed everywhere: any timeout, error or uncertainty in the
 * Gatekeeper path returns REJECT; in the Steal-the-VFY path it returns
 * HOLD. A decision is always computed synchronously first, so a slow
 * proof step can never eat the response deadline.
 */
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { keccak256 } from "viem";
import {
  GATEKEEPER_DEADLINE_MS,
  GATEKEEPER_VK_HASH,
  GATEKEEPER_WASM,
  GATEKEEPER_ZKEY,
  PROTOCOL_VERSION,
  RESPONSE_MARGIN_MS,
  VFY_POLICY_VK_HASH,
  VFY_WASM,
  VFY_ZKEY,
  circuitPath,
  loadConfig,
  type Config,
} from "./config.js";
import { CircuitInputsTodoError, gatekeeperCircuitInput, vfyCircuitInput } from "./circuit-inputs.js";
import { decideGatekeeper, type GatekeeperTask } from "./gatekeeper.js";
import { SIGNATURE_HEADER, signBody, verifySignature } from "./hmac.js";
import { submitProofToKurier } from "./kurier.js";
import { generateProof } from "./proof.js";
import { SeenStore } from "./seen-store.js";
import { decideVfyAction, STRATEGY_PARAMS } from "./vfy-policy.js";
import { computePublicInputsHash, type VfyAction, type VfyTurnEnvelope } from "./vfy.js";

const MAX_BODY_BYTES = 1_000_000;

function log(...args: unknown[]): void {
  console.log(new Date().toISOString(), ...args);
}

function logWarn(...args: unknown[]): void {
  console.warn(new Date().toISOString(), ...args);
}

interface Ctx {
  config: Config;
  seen: SeenStore;
}

type Json = Record<string, unknown>;

function sendJson(res: ServerResponse, status: number, body: Json, secret?: string): void {
  const raw = Buffer.from(JSON.stringify(body), "utf8");
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret) headers[SIGNATURE_HEADER] = signBody(raw, secret);
  res.writeHead(status, headers);
  res.end(raw);
}

function readRawBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        req.destroy();
        reject(new Error("Request body read timed out"));
      }
    }, 30_000);
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          req.destroy();
          reject(new Error("Request body too large"));
        }
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(Buffer.concat(chunks));
    });
    req.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
  });
}

/** Budget (ms) left for proof work: min(60 s, platform deadline) minus margin. */
function proofBudgetMs(deadlineAt?: string): number {
  const fallback = GATEKEEPER_DEADLINE_MS - RESPONSE_MARGIN_MS;
  if (!deadlineAt) return fallback;
  const deadline = Date.parse(deadlineAt);
  if (Number.isNaN(deadline)) return fallback;
  const remaining = deadline - Date.now() - RESPONSE_MARGIN_MS;
  return Math.max(1_000, Math.min(fallback, remaining));
}

async function handleGatekeeper(task: GatekeeperTask, ctx: Ctx): Promise<Json> {
  const input = task.input;
  if (!input || typeof input !== "object") throw new Error("Gatekeeper task missing input");
  const required = [
    "registered_vk",
    "proof_vk",
    "minimum",
    "public_balance",
    "expiry_block",
    "current_block",
    "recipient",
    "condition_recipient",
    "amount",
    "max_transfer",
    "proof_tx",
  ] as const;
  for (const key of required) {
    if (input[key] === undefined || input[key] === null) {
      throw new Error(`Gatekeeper task input missing field: ${key}`);
    }
  }

  // Decision first (pure + synchronous): a slow proof step can never eat it.
  const outcome = decideGatekeeper(input, (tx) => ctx.seen.has(tx));
  // Record every proof_tx seen, so a replay is caught as PROOF_REUSED.
  ctx.seen.add(input.proof_tx);
  log(`[gatekeeper] ${task.task_id} -> ${outcome.decision} ${outcome.reason_code}`);

  const response: Json = {
    decision: outcome.decision,
    reason_code: outcome.reason_code,
    proof_tx: input.proof_tx,
  };

  const budget = proofBudgetMs(task.deadline_at);
  try {
    const circuitInput = gatekeeperCircuitInput(input, outcome.decision, outcome.reason_code);
    const { proof, publicSignals } = await generateProof(
      circuitInput,
      circuitPath(ctx.config.circuitsDir, GATEKEEPER_WASM),
      circuitPath(ctx.config.circuitsDir, GATEKEEPER_ZKEY),
      budget,
    );
    response.proof = proof as Json;
    response.public_signals = publicSignals;
    // Kurier: bounded, non-fatal. Never miss the deadline waiting for it.
    const kurierBudget = Math.min(15_000, Math.max(0, budget - 1_000));
    if (kurierBudget > 0) {
      const result = await submitProofToKurier({
        proof,
        publicSignals,
        vkHash: GATEKEEPER_VK_HASH,
        apiKey: ctx.config.kurierApiKey,
        timeoutMs: kurierBudget,
      });
      if (result?.status === "Finalized") {
        log(`[gatekeeper] ${task.task_id} Kurier finalized job=${result.jobId} tx=${result.txHash ?? "-"}`);
      }
    }
  } catch (err) {
    if (err instanceof CircuitInputsTodoError) {
      logWarn(`[gatekeeper] ${task.task_id} proof skipped: ${err.message}`);
    } else {
      logWarn(`[gatekeeper] ${task.task_id} proof failed: ${err instanceof Error ? err.message : err}`);
    }
    // No proof attached: the decision still goes out on time. A provable
    // task answered without a valid proof costs -2, but a timeout also
    // costs -2 and a wrong decision costs more — the decision stands.
  }
  return response;
}

async function handleVfy(envelope: VfyTurnEnvelope, ctx: Ctx): Promise<Json> {
  const { matchId, turn, state, strategyCommitment } = envelope;
  if (!matchId || typeof turn !== "number" || !state || !strategyCommitment?.hash) {
    throw new Error("Steal-the-VFY envelope missing matchId/turn/state/strategyCommitment");
  }
  const action: VfyAction = decideVfyAction(state, turn, STRATEGY_PARAMS);
  log(`[vfy] ${matchId} turn=${turn} -> ${action.type}${action.type === "EXTRACT" ? ` ${action.amount}` : ""}`);

  const response: Json = {
    matchId,
    turn,
    action:
      action.type === "EXTRACT"
        ? { type: "EXTRACT", amount: action.amount }
        : { type: action.type },
    agentTimestamp: new Date().toISOString(),
    idempotencyKey: randomUUID(),
  };
  // action.amount MUST be omitted entirely for HOLD/FORTIFY (the schema
  // rejects the field even when it is 0) — enforced by construction above.

  const budget = proofBudgetMs(envelope.deadlineAt);
  try {
    const publicInputsHash = computePublicInputsHash({
      commitmentHash: strategyCommitment.hash,
      matchId,
      turn,
      selfBalance: state.selfBalance,
      opponentBalance: state.opponentBalance,
      action,
      circuitVersion: "v1",
    });
    const policyProof: Json = { circuitVersion: "v1", publicInputsHash };
    response.policyProof = policyProof;
    const circuitInput = vfyCircuitInput(state, action, strategyCommitment.hash, publicInputsHash);
    const { proof, publicSignals } = await generateProof(
      circuitInput,
      circuitPath(ctx.config.circuitsDir, VFY_WASM),
      circuitPath(ctx.config.circuitsDir, VFY_ZKEY),
      budget,
    );
    response.proof = proof as Json;
    response.public_signals = publicSignals;
    // proofReference: deterministic content hash of the proof, unless Kurier
    // finalizes and yields an on-chain reference (see CIRCUIT_INPUTS_TODO.md).
    policyProof.proofReference = keccak256(
      Buffer.from(JSON.stringify(proof), "utf8"),
    );
    const kurierBudget = Math.min(15_000, Math.max(0, budget - 1_000));
    if (kurierBudget > 0) {
      const result = await submitProofToKurier({
        proof,
        publicSignals,
        vkHash: VFY_POLICY_VK_HASH,
        apiKey: ctx.config.kurierApiKey,
        timeoutMs: kurierBudget,
      });
      if (result?.status === "Finalized" && result.txHash) {
        policyProof.proofReference = result.txHash;
        log(`[vfy] ${matchId} turn=${turn} Kurier finalized tx=${result.txHash}`);
      }
    }
  } catch (err) {
    if (err instanceof CircuitInputsTodoError) {
      logWarn(`[vfy] ${matchId} turn=${turn} proof skipped: ${err.message}`);
    } else {
      logWarn(`[vfy] ${matchId} turn=${turn} proof failed: ${err instanceof Error ? err.message : err}`);
    }
    // No proof attached: the turn still scores as HOLD with no proof
    // rather than an invalid submission (-2) or a timeout (-1).
    if (action.type !== "HOLD") {
      response.action = { type: "HOLD" };
      // Recompute the hash for the downgraded HOLD action so the attached
      // policyProof stays consistent with what we actually return.
      try {
        (response.policyProof as Json).publicInputsHash = computePublicInputsHash({
          commitmentHash: strategyCommitment.hash,
          matchId,
          turn,
          selfBalance: state.selfBalance,
          opponentBalance: state.opponentBalance,
          action: { type: "HOLD" },
          circuitVersion: "v1",
        });
      } catch {
        delete response.policyProof;
      }
    }
  }
  return response;
}

async function handleAgent(rawBody: Buffer, ctx: Ctx): Promise<{ status: number; body: Json }> {
  let envelope: Json;
  try {
    envelope = JSON.parse(rawBody.toString("utf8")) as Json;
  } catch {
    return { status: 400, body: { error: "invalid JSON" } };
  }
  if (!envelope || typeof envelope !== "object") {
    return { status: 400, body: { error: "envelope must be a JSON object" } };
  }
  try {
    if (envelope.type === "agent-games.preflight.v1") {
      return { status: 200, body: { ok: true, protocolVersion: PROTOCOL_VERSION } };
    }
    if (envelope.type === "agent-games.proof-gatekeeper.v1") {
      const body = await handleGatekeeper(envelope as unknown as GatekeeperTask, ctx);
      return { status: 200, body };
    }
    if (envelope.eventId === "steal-the-vfy") {
      const body = await handleVfy(envelope as unknown as VfyTurnEnvelope, ctx);
      return { status: 200, body };
    }
    return { status: 400, body: { error: "unknown envelope type" } };
  } catch (err) {
    // Fail closed, but stay responsive: a malformed task is a 400, an
    // internal failure returns a safe default per event (the decision was
    // already attempted inside the handler; this is the last resort).
    logWarn(`[agent] handler error: ${err instanceof Error ? err.message : err}`);
    return { status: 400, body: { error: "task could not be processed" } };
  }
}

export function createAgentServer(ctx: Ctx) {
  const server = createServer(async (req, res) => {
    const url = req.url ?? "/";
    try {
      if (req.method === "GET" && url === "/health") {
        sendJson(res, 200, { ok: true, service: "hayzenxcr-agent-games", protocolVersion: PROTOCOL_VERSION });
        return;
      }
      if (req.method === "GET" && url === "/") {
        sendJson(res, 200, {
          service: "hayzenxcr-agent-games",
          protocolVersion: PROTOCOL_VERSION,
          events: ["proof-gatekeeper", "steal-the-vfy"],
          endpoint: "POST /agent",
        });
        return;
      }
      if (req.method === "POST" && url === "/agent") {
        const rawBody = await readRawBody(req);
        const sigHeader = req.headers[SIGNATURE_HEADER];
        const signature = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;
        if (!verifySignature(rawBody, signature, ctx.config.hmacSecret)) {
          logWarn("[agent] rejected: invalid HMAC signature");
          sendJson(res, 401, { error: "invalid signature" }, ctx.config.hmacSecret);
          return;
        }
        const { status, body } = await handleAgent(rawBody, ctx);
        sendJson(res, status, body, ctx.config.hmacSecret);
        return;
      }
      sendJson(res, 404, { error: "not found" });
    } catch (err) {
      logWarn(`[server] ${err instanceof Error ? err.message : err}`);
      if (!res.headersSent) sendJson(res, 500, { error: "internal error" }, ctx.config.hmacSecret);
    }
  });
  return server;
}

function main(): void {
  const config = loadConfig();
  const ctx: Ctx = { config, seen: new SeenStore(config.dataDir) };
  const server = createAgentServer(ctx);
  server.listen(config.port, "0.0.0.0", () => {
    log(`HayzenXcr Agent Games endpoint listening on 0.0.0.0:${config.port} (POST /agent, GET /health)`);
  });
}

main();
