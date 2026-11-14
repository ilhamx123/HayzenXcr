import "dotenv/config";
import express, { Request, Response } from "express";
import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";

const app = express();
const PORT = Number(process.env.PORT || 3000);
const SECRET = process.env.AGENT_GAMES_HMAC_SECRET || "";

function safeEqualHex(a: string, b: string): boolean {
  if (!/^[0-9a-f]+$/i.test(a) || !/^[0-9a-f]+$/i.test(b) || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

function sign(raw: Buffer): string {
  if (!SECRET) throw new Error("AGENT_GAMES_HMAC_SECRET is not configured");
  return createHmac("sha256", SECRET).update(raw).digest("hex");
}

function authenticated(req: Request): boolean {
  const supplied = req.header("x-agent-games-signature") || "";
  if (!SECRET || !supplied) return false;
  const raw = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!raw) return false;
  return safeEqualHex(supplied.replace(/^0x/, ""), sign(raw));
}

// Capture exact bytes: signature verification must happen before JSON parsing.
app.use(express.raw({ type: "application/json", limit: "256kb" }));

function signedJson(res: Response, status: number, payload: unknown) {
  const raw = Buffer.from(JSON.stringify(payload));
  try {
    res.status(status)
      .setHeader("content-type", "application/json")
      .setHeader("x-agent-games-signature", sign(raw))
      .send(raw);
  } catch {
    res.status(503).json({ error: "Agent secret is not configured" });
  }
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, agent: "HayzenXcr", protocolVersion: "v1" });
});

app.get("/api/circuit-info", (_req, res) => {
  res.json({
    proofGatekeeper: {
      curve: "bn128",
      vkHash: "0x6b79c6012a6d8651f3e13bc4d2a20370280ab49700c90c5316d4168bfbad77b0"
    },
    stealTheVfy: {
      curve: "bn128",
      vkHash: "0x6c56509f1c56fd1fd4e9737f906d2220f4b95f1d507f1adf6899085bd74be047"
    }
  });
});

app.post("/agent", (req, res) => {
  const raw = req.body as Buffer;
  if (!Buffer.isBuffer(raw)) return res.status(400).json({ error: "Expected application/json" });

  // Verify request HMAC before parsing or acting on its contents.
  const supplied = req.header("x-agent-games-signature") || "";
  if (!SECRET || !safeEqualHex(supplied.replace(/^0x/, ""), sign(raw))) {
    return res.status(401).json({ error: "Invalid request signature" });
  }

  let body: any;
  try { body = JSON.parse(raw.toString("utf8")); }
  catch { return signedJson(res, 400, { error: "Invalid JSON" }); }

  if (body?.type === "agent-games.preflight.v1") {
    return signedJson(res, 200, { ok: true, protocolVersion: "v1" });
  }

  if (body?.type === "agent-games.proof-gatekeeper.v1") {
    const input = body.input || {};
    let reason = "PROOF_NOT_VERIFIED";
    let decision: "REJECT" | "APPROVE" = "REJECT";

    if (!input.registered_vk || !input.proof_vk || input.registered_vk.toLowerCase() !== input.proof_vk.toLowerCase()) {
      reason = "VK_SUBSTITUTION";
    } else if (!Number.isFinite(Number(input.public_balance)) || Number(input.public_balance) < Number(input.minimum)) {
      reason = "THRESHOLD_MISMATCH";
    } else if (!input.recipient || !input.condition_recipient || input.recipient.toLowerCase() !== input.condition_recipient.toLowerCase()) {
      reason = "RECIPIENT_MISMATCH";
    } else if (!Number.isFinite(Number(input.expiry_block)) || !Number.isFinite(Number(input.current_block)) || Number(input.current_block) > Number(input.expiry_block)) {
      reason = "EXPIRED_CONDITION";
    } else if (!Number.isFinite(Number(input.amount)) || !Number.isFinite(Number(input.max_transfer)) || Number(input.amount) > Number(input.max_transfer)) {
      reason = "AMOUNT_OVERFLOW";
    }

    // IMPORTANT: no APPROVE path until Groth16 proof generation, proof reuse
    // storage, and finalized zkVerify/Kurier confirmation are implemented.
    // This conservative response is a scaffold, not competition-ready.
    return signedJson(res, 200, {
      decision,
      reason_code: reason,
      ...(input.proof_tx ? { proof_tx: input.proof_tx } : {})
    });
  }

  if (body?.eventId === "steal-the-vfy" || (body?.matchId && Number.isInteger(body?.turn))) {
    // Never fabricate a policy proof. Add the official vfy-policy circuit,
    // publicInputsHash calculation, Groth16 generation and submission first.
    return signedJson(res, 503, {
      error: "STEAL_THE_VFY_PROOF_ADAPTER_NOT_CONFIGURED",
      matchId: body.matchId,
      turn: body.turn
    });
  }

  return signedJson(res, 400, { error: "Unsupported task type" });
});

app.listen(PORT, () => {
  console.log(`HayzenXcr listening on port ${PORT}`);
  if (!SECRET) console.warn("Set AGENT_GAMES_HMAC_SECRET before platform preflight.");
});
