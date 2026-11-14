import test from "node:test";
import assert from "node:assert/strict";
import { computePublicInputsHash, matchIdToBigInt, ACTION_CODE } from "../dist/vfy.js";

const commitmentHash = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";

test("hash is deterministic", () => {
  const opts = {
    commitmentHash,
    matchId: "123e4567-e89b-12d3-a456-426614174000",
    turn: 3,
    selfBalance: "95",
    opponentBalance: "105",
    action: { type: "HOLD" },
  };
  assert.equal(computePublicInputsHash(opts), computePublicInputsHash(opts));
});

test("hash is 32 bytes (0x + 64 hex chars)", () => {
  const h = computePublicInputsHash({
    commitmentHash,
    matchId: "123e4567-e89b-12d3-a456-426614174000",
    turn: 3,
    selfBalance: "95",
    opponentBalance: "105",
    action: { type: "HOLD" },
  });
  assert.match(h, /^0x[0-9a-f]{64}$/);
});

test("changing the amount changes the hash (EXTRACT 5 vs 6)", () => {
  const base = {
    commitmentHash,
    matchId: "123e4567-e89b-12d3-a456-426614174000",
    turn: 3,
    selfBalance: "95",
    opponentBalance: "105",
  };
  const h5 = computePublicInputsHash({ ...base, action: { type: "EXTRACT", amount: 5 } });
  const h6 = computePublicInputsHash({ ...base, action: { type: "EXTRACT", amount: 6 } });
  assert.notEqual(h5, h6);
});

test("HOLD and EXTRACT with amount 0 differ (action code is hashed)", () => {
  const base = {
    commitmentHash,
    matchId: "123e4567-e89b-12d3-a456-426614174000",
    turn: 3,
    selfBalance: "95",
    opponentBalance: "105",
  };
  assert.notEqual(
    computePublicInputsHash({ ...base, action: { type: "HOLD" } }),
    computePublicInputsHash({ ...base, action: { type: "EXTRACT", amount: 0 } }),
  );
});

test("turn is part of the hash", () => {
  const base = {
    commitmentHash,
    matchId: "123e4567-e89b-12d3-a456-426614174000",
    selfBalance: "95",
    opponentBalance: "105",
    action: { type: "HOLD" },
  };
  assert.notEqual(
    computePublicInputsHash({ ...base, turn: 3 }),
    computePublicInputsHash({ ...base, turn: 4 }),
  );
});

test("matchId UUID and its dash-stripped hex give the same hash", () => {
  const base = {
    commitmentHash,
    turn: 3,
    selfBalance: "95",
    opponentBalance: "105",
    action: { type: "HOLD" },
  };
  assert.equal(
    computePublicInputsHash({ ...base, matchId: "123e4567-e89b-12d3-a456-426614174000" }),
    computePublicInputsHash({ ...base, matchId: "0x123e4567e89b12d3a456426614174000" }),
  );
});

test("matchIdToBigInt rejects non-hex", () => {
  assert.throws(() => matchIdToBigInt("not-a-match-id"), /not hex/);
});

test("action codes are HOLD 0, FORTIFY 1, EXTRACT 2", () => {
  assert.deepEqual(ACTION_CODE, { HOLD: 0, FORTIFY: 1, EXTRACT: 2 });
});
