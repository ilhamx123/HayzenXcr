import test from "node:test";
import assert from "node:assert/strict";
import { signBody, verifySignature } from "../dist/hmac.js";

const SECRET = "test-secret";
const OTHER = "different-secret";

test("sign then verify round-trips", () => {
  const raw = Buffer.from(JSON.stringify({ hello: "world" }), "utf8");
  const sig = signBody(raw, SECRET);
  assert.equal(verifySignature(raw, sig, SECRET), true);
});

test("tampered body fails verification", () => {
  const raw = Buffer.from(JSON.stringify({ hello: "world" }), "utf8");
  const sig = signBody(raw, SECRET);
  const tampered = Buffer.from(JSON.stringify({ hello: "mars" }), "utf8");
  assert.equal(verifySignature(tampered, sig, SECRET), false);
});

test("wrong secret fails verification", () => {
  const raw = Buffer.from("abc", "utf8");
  assert.equal(verifySignature(raw, signBody(raw, SECRET), OTHER), false);
});

test("missing signature fails verification", () => {
  assert.equal(verifySignature(Buffer.from("abc"), undefined, SECRET), false);
});

test("signature is lowercase hex sha256 (64 chars)", () => {
  assert.match(signBody("abc", SECRET), /^[0-9a-f]{64}$/);
});
