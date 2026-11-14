import { createHmac } from "node:crypto";

// Tiny local check for the documented HMAC-SHA256 primitive.
// This does not replace the platform's signed preflight.
const secret = "local-test-only";
const body = Buffer.from(JSON.stringify({ type: "agent-games.preflight.v1" }));
const signature = createHmac("sha256", secret).update(body).digest("hex");
if (!/^[0-9a-f]{64}$/.test(signature)) throw new Error("HMAC self-test failed");
console.log("Local HMAC primitive self-test passed.");
