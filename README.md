# HayzenXcr — zkVerify Agent Games Agent

Public HTTPS agent endpoint for **zkVerify Agent Games** (21 Oct – 21 Nov 2026),
entered as agent **HayzenXcr** in two tracks:

| Track | What the agent does |
|---|---|
| **Proof Gatekeeper** | Receives proof-backed payment tasks, verifies every field deterministically, returns APPROVE/REJECT + a Groth16 proof of the decision. |
| **Steal the VFY** | Plays head-to-head 20-turn matches from a committed strategy, returns each move with a policy proof. |

The platform never runs this code. This repo is the agent: a Node.js +
TypeScript HTTP server (no web framework) that the platform POSTs signed
tasks to. It answers within the 60-second Gatekeeper window and fails
closed on any uncertainty.

## How it works

```
platform --(signed JSON POST /agent)--> this server
  1. Verify HMAC over the RAW body (x-agent-games-signature) BEFORE parsing
  2. Dispatch: preflight / proof-gatekeeper / steal-the-vfy
  3. Gatekeeper: 6 deterministic checks in priority order (see below)
     VFY: deterministic policy from STRATEGY_PARAMS (owner-defined)
  4. Generate a local Groth16 proof with snarkjs, submit to zkVerify via
     Kurier (bounded, never blocks the response deadline)
  5. Respond signed (x-agent-games-signature over the raw response body)
```

### Proof Gatekeeper decision logic (deterministic, no LLM)

APPROVE only if **all** pass; otherwise REJECT with the matching code:

1. `proof_vk === registered_vk` — else `VK_SUBSTITUTION`
2. `BigInt(public_balance) >= BigInt(minimum)` — else `THRESHOLD_MISMATCH`
3. `proof_tx` not seen before (persisted in `data/seen.json`) — else `PROOF_REUSED`
4. `current_block <= expiry_block` — else `EXPIRED_CONDITION`
5. `recipient === condition_recipient` (case-insensitive) — else `RECIPIENT_MISMATCH`
6. `BigInt(amount) <= BigInt(max_transfer)` — else `AMOUNT_OVERFLOW`

All pass → `APPROVE` / `VALID_CONDITION`.

### Steal the VFY

- Start 100 VFY each, 20 turns, 5 Swiss rounds, 5 min/turn.
- Actions: `HOLD` (free), `FORTIFY` (cost 2, blocks up to 6 incoming
  extraction), `EXTRACT n` (n ≤ 10, free; a fortified opponent cuts the
  gain by 6).
- `publicInputsHash` is keccak256 of ABI-packed 32-byte big-endian fields
  in exact order: `[commitmentHash, matchId, turn, selfBalance,
  opponentBalance, actionCode (HOLD 0 / FORTIFY 1 / EXTRACT 2), amount,
  circuitVersion "v1" → 1]`, computed **before** submitting to zkVerify.
- The strategy itself is the owner's: fill in `STRATEGY_PARAMS` in
  `src/vfy-policy.ts`, then `npm run commitment` and register the printed
  Poseidon hash before Swiss Round 1 opens. Until then the policy returns
  HOLD on every turn (the safe default).

## Scoring (Proof Gatekeeper)

| Outcome | Points |
|---|---|
| Correct APPROVE / correct REJECT | +12 |
| Incorrect APPROVE | −6 |
| Incorrect REJECT | −3 |
| Delivery timeout | −2 |
| Missing / invalid proof | −2 |
| Reliability bonus (verified proofs) | +0 to +5 |

Rounds: **13–20 Nov 2026, 8 tasks/agent/day, 16:00–02:00 IST** (17:30–03:30 WIB).
Prizes: **100,000 VFY per track — 1st 50,000 / 2nd 30,000 / 3rd 20,000 VFY**.

## Setup

```bash
npm install
npm run setup        # downloads circuit artifacts into ./circuits/ (gitignored)
cp .env.example .env # fill in the three secrets below
npm run build
npm start            # listens on 0.0.0.0:$PORT (default 8080)
```

Environment variables (never hardcoded, never committed):

| Variable | Source |
|---|---|
| `AGENT_GAMES_HMAC_SECRET` | Agent Games dashboard → Rotate Secret (one-time plaintext) |
| `KURIER_API_KEY` | Kurier mainnet API key (https://kurier.xyz) |
| `STRATEGY_SALT` | Random decimal/0x-hex integer, kept secret; mixed into the strategy commitment |
| `PORT` | Set automatically by Render/Fly (default 8080) |

## Deploy

**Render (free)** — the repo ships `render.yaml`: connect the GitHub repo,
set the three secrets as environment variables, deploy. Health check:
`GET /health`.

**Fly.io** — `Dockerfile` is included (`node:20-slim`, builds, downloads
circuits, serves on 8080):

```bash
fly launch --no-deploy
fly secrets set AGENT_GAMES_HMAC_SECRET=... KURIER_API_KEY=... STRATEGY_SALT=...
fly deploy
```

**Docker** — `docker build -t hayzenxcr-agent . && docker run -p 8080:8080 --env-file .env hayzenxcr-agent`

## Register (after deploy)

1. Sign in at https://agentgames.zkverify.io (X / wallet).
2. **Register agent** with repo URL `https://github.com/ilhamx123/HayzenXcr`
   and your agent endpoint URL (`POST /agent`).
3. Dashboard → **Rotate Secret** → copy the one-time plaintext into
   `AGENT_GAMES_HMAC_SECRET` and redeploy.
4. Complete the **signed preflight** (`POST /agent` with
   `{"type":"agent-games.preflight.v1",...}` → `{"ok":true,"protocolVersion":"v1"}`).
5. Run at least one **practice task** / practice turn, confirm the proof
   verifies (Kurier job reaches `Finalized`).
6. Rounds open — the endpoint must stay up for the whole round window.

## Tests

```bash
npm test            # build + node:test unit tests (decisions, HMAC, VFY hash)
npm run test:harness  # end-to-end replay: preflight, bad-HMAC 401, valid task,
                      # all 6 traps, proof reuse, VFY turn + hash recomputation
```

## Honest TODOs (must resolve before the first scored round)

See [`CIRCUIT_INPUTS_TODO.md`](CIRCUIT_INPUTS_TODO.md):

1. **Circuit input mapping is unconfirmed.** The exact Circom input signal
   names for both circuits are not published in the build guide yet. The
   mapping lives in one place — `src/circuit-inputs.ts` — and currently
   throws a clear error. Until it is confirmed against Practice Mode, the
   server answers decisions on time but without proof fields (−2 on
   provable tasks, never a timeout). Fill in the two functions, then
   re-run `npm run test:harness`.
2. **Steal-the-VFY strategy parameters are an empty placeholder**
   (`src/vfy-policy.ts`). The strategy is the owner's decision; the
   harness proves whatever is committed. Fill it in and register the
   commitment before Swiss Round 1 opens.

## Security notes

- HMAC is verified over the raw body before any parsing; responses are
  signed the same way. A wrong secret fails closed (401).
- No secret is ever logged or printed. `scripts/commitment.mjs` prints
  only the commitment hash — never the salt or the parameters.
- The agent never holds funds, never signs transactions, and never moves
  money. Steal-the-VFY balances are simulated game state.

## License

MIT — see [LICENSE](LICENSE).
