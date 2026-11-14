# HayzenXcr — zkVerify Agent Games starter

This is a TypeScript/Node.js starter for the Agent Games `/agent` endpoint.

## Included

- `GET /health` — basic health check.
- `GET /api/circuit-info` — publishes the two official circuit VK hashes shown by the Agent Games build guide.
- `POST /agent` — captures raw JSON bytes, verifies `x-agent-games-signature` using HMAC-SHA256 before parsing, and signs JSON responses.
- Signed preflight response.
- Conservative Proof Gatekeeper checks.
- `.env.example` and `.gitignore`.

## Important: not competition-ready yet

This repository is an honest starter scaffold, not a completed competition agent.

**Proof Gatekeeper:** it deliberately has no APPROVE path yet. Before competition use, implement the official `gatekeeper.wasm` / `gatekeeper_final.zkey` Groth16 proof generation, proof-reference reuse protection, Kurier or zkVerifyJS submission, and wait for `Finalized`. The platform independently verifies the proof. A matching set of visible JSON fields alone is not enough to approve a payment.

**Steal the VFY:** it deliberately does not invent a policy proof or submit a fake action. Implement the official `vfy-policy.wasm` / `vfy-policy_final.zkey`, strategy commitment, documented public-input hash, Groth16 proof generation, and submission before enabling this track.

The official guide says the endpoint path must include `/agent`, requests must be signed, and every response must include `x-agent-games-signature` over the exact raw response body. The platform-generated secret is available once from Dashboard → My Agents → Rotate Secret.

## Run locally

1. Install Node.js 20 or newer.
2. Copy `.env.example` to `.env`.
3. Set `AGENT_GAMES_HMAC_SECRET` to a local test secret for local development. Do not use a placeholder for platform preflight.
4. Run:

   ```bash
   npm install
   npm test
   npm run dev
   ```

5. Open `http://localhost:3000/health`.

## Deploy

Deploy to a Node.js host that provides a public HTTPS URL. Set `AGENT_GAMES_HMAC_SECRET` and `PORT` as host environment variables; do not commit `.env`. Register the full endpoint URL, for example:

`https://YOUR-HOST.example/agent`

After deployment, use the dashboard's Rotate Secret flow, set the actual generated secret in the hosting environment, restart, and run signed preflight.

## GitHub upload

Create a **public repository on your personal GitHub account** (not an organization-owned repo), then upload these files or push this folder. Paste the repository URL into Agent Registry.

## Official references

- Build guide: https://agentgames.zkverify.io/build
- Proof Gatekeeper: https://agentgames.zkverify.io/events/proof-gatekeeper
- Steal the VFY: https://agentgames.zkverify.io/events/steal-the-vfy

Never share your HMAC secret, Kurier API key, wallet seed phrase, or private key in chat or commit them to GitHub.
