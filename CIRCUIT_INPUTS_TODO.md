# Circuit Inputs TODO — read before the first scored round

Status (14 Nov 2026): **the exact Circom input signal names for both
competition circuits have not been published in the Agent Games build guide**
(https://agentgames.zkverify.io/build). What IS published and confirmed:

- Circuit artifacts + vkHashes (`/api/circuit-info`):
  - Gatekeeper: `gatekeeper.wasm` + `gatekeeper_final.zkey`,
    vkHash `0x6b79c6012a6d8651f3e13bc4d2a20370280ab49700c90c5316d4168bfbad77b0`
  - Steal-the-VFY policy: `vfy-policy.wasm` + `vfy-policy_final.zkey`,
    vkHash `0x6c56509f1c56fd1fd4e9737f906d2220f4b95f1d507f1adf6899085bd74be047`
- Both circuits are Groth16 / BN128, compiled with Circom 2.x.
- Verified from the artifacts themselves (14 Nov 2026, `snarkjs zKey.exportVerificationKey`): Gatekeeper vk has **nPublic = 13** public signals; vfy-policy vk has **nPublic = 9**. The vfy-policy top-level template is `VfyPolicyProof_154`. Signal *names* are not recoverable from the `.wasm`/`.zkey` (Circom ships no symbol table), so the counts above bound the mapping but do not reveal it.
- Proof generation itself (snarkjs `groth16.fullProve`) is implemented in
  `src/proof.ts`; Kurier submission is implemented in `src/kurier.ts`.

## What is missing

The mapping from a platform task/turn onto the circuit's named input
signals. For example, the Gatekeeper circuit presumably takes signals for
the decision and the checked fields, and the vfy-policy circuit takes
signals for the committed strategy and the game state — but the exact
signal names, types, and which values are public vs private are not
documented on the build page yet.

## What this repo does about it

- `src/circuit-inputs.ts` is the SINGLE place that maps tasks to circuit
  inputs. Both mapping functions currently throw `CircuitInputsTodoError`.
  Nothing else in the repo is affected: decision logic, HMAC, response
  schemas, the VFY `publicInputsHash`, and Kurier submission are all fully
  implemented.
- When the mapping is unconfirmed, the server still answers every task on
  time (decision + reason, no proof fields). A provable task answered
  without a valid proof costs −2; a timeout also costs −2 — so answering
  without a proof is never worse than timing out, and the decision itself
  is still scored.
- `proofReference` for Steal-the-VFY is currently the keccak256 content
  hash of the generated proof (or the Kurier tx hash when Kurier
  finalizes). If Practice Mode shows the platform expects a different
  format, that is a one-line change in `src/server.ts`.

## How to resolve (before the first scored round)

1. Run the agent in **Practice Mode** (build guide: practice tasks are
   available before the first scored round) and/or inspect the circuit
   artifacts: `npx snarkjs zkey export verificationkey` shows the public
   signals; the `.wasm` witness generator + a sample input from the
   practice task reveal the expected signal names.
2. Fill in `gatekeeperCircuitInput()` and `vfyCircuitInput()` in
   `src/circuit-inputs.ts` — and only there.
3. Run `npm run test:harness` — it exercises the full loop including
   proof generation once the mapping exists (remove the "proof skipped"
   expectation if the harness is updated to require proofs).
4. Confirm a practice proof verifies end-to-end (Kurier job reaches
   `Finalized`) before Round 1 counts.

## Steal-the-VFY strategy commitment

Separately, `STRATEGY_PARAMS` in `src/vfy-policy.ts` is an intentionally
empty placeholder: the official starter prompt says the strategy is the
owner's to decide and must not be vibecoded. Fill it in, run
`npm run commitment`, and register the printed Poseidon hash as your
strategy commitment BEFORE Swiss Round 1 opens. The commitment layout
(Poseidon over salt + sorted parameter values) is this repo's convention
and must likewise be confirmed against Practice Mode.
