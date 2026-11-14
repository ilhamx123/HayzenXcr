import test from "node:test";
import assert from "node:assert/strict";
import { decideGatekeeper } from "../dist/gatekeeper.js";

const base = {
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

const neverReused = () => false;

test("valid condition -> APPROVE / VALID_CONDITION", () => {
  assert.deepEqual(decideGatekeeper(base, neverReused), {
    decision: "APPROVE",
    reason_code: "VALID_CONDITION",
  });
});

test("boundary values approve: balance == minimum, amount == cap, block == expiry", () => {
  assert.deepEqual(
    decideGatekeeper(
      { ...base, public_balance: "1000", amount: "1000", current_block: 19842201 },
      neverReused,
    ),
    { decision: "APPROVE", reason_code: "VALID_CONDITION" },
  );
});

test("VK substitution -> REJECT / VK_SUBSTITUTION", () => {
  assert.deepEqual(
    decideGatekeeper({ ...base, proof_vk: "0xa4c100000000000000000000000000000000000000000000000000000000b8ff" }, neverReused),
    { decision: "REJECT", reason_code: "VK_SUBSTITUTION" },
  );
});

test("threshold mismatch -> REJECT / THRESHOLD_MISMATCH", () => {
  assert.deepEqual(
    decideGatekeeper({ ...base, public_balance: "999" }, neverReused),
    { decision: "REJECT", reason_code: "THRESHOLD_MISMATCH" },
  );
});

test("proof reused -> REJECT / PROOF_REUSED", () => {
  assert.deepEqual(decideGatekeeper(base, () => true), {
    decision: "REJECT",
    reason_code: "PROOF_REUSED",
  });
});

test("expired condition -> REJECT / EXPIRED_CONDITION", () => {
  assert.deepEqual(
    decideGatekeeper({ ...base, current_block: 19842202 }, neverReused),
    { decision: "REJECT", reason_code: "EXPIRED_CONDITION" },
  );
});

test("recipient mismatch -> REJECT / RECIPIENT_MISMATCH", () => {
  assert.deepEqual(
    decideGatekeeper({ ...base, recipient: "0xBeef00000000000000000000000000000000000001" }, neverReused),
    { decision: "REJECT", reason_code: "RECIPIENT_MISMATCH" },
  );
});

test("amount overflow -> REJECT / AMOUNT_OVERFLOW", () => {
  assert.deepEqual(
    decideGatekeeper({ ...base, amount: "1001" }, neverReused),
    { decision: "REJECT", reason_code: "AMOUNT_OVERFLOW" },
  );
});

test("check priority: VK substitution beats threshold mismatch", () => {
  assert.deepEqual(
    decideGatekeeper(
      { ...base, proof_vk: "0x0000000000000000000000000000000000000000000000000000000000000001", public_balance: "1" },
      () => true,
    ),
    { decision: "REJECT", reason_code: "VK_SUBSTITUTION" },
  );
});

test("recipient comparison is case-insensitive", () => {
  assert.deepEqual(
    decideGatekeeper(
      { ...base, recipient: "0xde4200000000000000000000000000000000009f01" },
      neverReused,
    ),
    { decision: "APPROVE", reason_code: "VALID_CONDITION" },
  );
});

test("big balances handled with BigInt (no float precision loss)", () => {
  assert.deepEqual(
    decideGatekeeper(
      { ...base, minimum: "9007199254740993", public_balance: "9007199254740992" },
      neverReused,
    ),
    { decision: "REJECT", reason_code: "THRESHOLD_MISMATCH" },
  );
});
