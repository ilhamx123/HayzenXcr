/**
 * HMAC-SHA256 signing used by the Agent Games platform.
 * - Inbound: header `x-agent-games-signature` over the RAW request body.
 * - Outbound: same scheme, header `x-agent-games-signature` over the raw
 *   response body.
 * Verification happens BEFORE any JSON parsing. Comparison is constant-time.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_HEADER = "x-agent-games-signature";

export function signBody(rawBody: Buffer | string, secret: string): string {
  const body = typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody;
  return createHmac("sha256", secret).update(body).digest("hex");
}

export function verifySignature(
  rawBody: Buffer | string,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature || !secret) return false;
  const expected = signBody(rawBody, secret);
  const sigBuf = Buffer.from(signature.trim(), "utf8");
  const expBuf = Buffer.from(expected, "utf8");
  if (sigBuf.length !== expBuf.length) return false;
  try {
    return timingSafeEqual(sigBuf, expBuf);
  } catch {
    return false;
  }
}
