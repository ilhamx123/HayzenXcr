/**
 * Kurier (REST) submission of a Groth16 proof to zkVerify mainnet.
 * Recommended path per the Agent Games build guide. The caller must NEVER
 * block a task response on Kurier: submit with a bounded timeout and treat
 * any failure as non-fatal — the locally generated proof is still returned
 * in the task response for the platform to verify independently.
 *
 * API: POST https://api.kurier.xyz/api/v1/submit-proof/<KURIER_API_KEY>
 * Body: { proofType: "groth16", vkRegistered: true,
 *         proofOptions: { library: "snarkjs", curve: "bn128" },
 *         proofData: { proof, publicSignals, vk } }
 * The response carries a job id; poll GET .../jobs/<id> (or the status URL
 * returned) until status === "Finalized".
 */
import { GATEKEEPER_VK_HASH } from "./config.js";

const KURIER_BASE = "https://api.kurier.xyz/api/v1";

export interface KurierResult {
  jobId: string;
  status: string;
  txHash?: string;
}

interface KurierSubmitResponse {
  jobId?: string;
  job_id?: string;
  id?: string;
  status?: string;
  [key: string]: unknown;
}

function jobIdOf(body: KurierSubmitResponse): string | undefined {
  return body.jobId ?? body.job_id ?? body.id;
}

export async function submitProofToKurier(opts: {
  proof: unknown;
  publicSignals: string[];
  vkHash?: string;
  apiKey: string;
  /** Total budget for submit + polling. Default 20 s. */
  timeoutMs?: number;
  /** Delay between status polls. Default 2 s. */
  pollIntervalMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<KurierResult | null> {
  const {
    proof,
    publicSignals,
    vkHash = GATEKEEPER_VK_HASH,
    apiKey,
    timeoutMs = 20_000,
    pollIntervalMs = 2_000,
    fetchImpl = fetch,
  } = opts;
  if (!apiKey) {
    console.warn("[kurier] KURIER_API_KEY not set — skipping Kurier submission");
    return null;
  }
  const deadline = Date.now() + timeoutMs;
  const submitUrl = `${KURIER_BASE}/submit-proof/${apiKey}`;
  let submitRes: Response;
  try {
    submitRes = await fetchImpl(submitUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        proofType: "groth16",
        vkRegistered: true,
        proofOptions: { library: "snarkjs", curve: "bn128" },
        proofData: { proof, publicSignals, vk: vkHash },
      }),
      signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
    });
  } catch (err) {
    console.warn(`[kurier] submit failed: ${err instanceof Error ? err.message : err}`);
    return null;
  }
  if (!submitRes.ok) {
    console.warn(`[kurier] submit HTTP ${submitRes.status}`);
    return null;
  }
  let submitBody: KurierSubmitResponse;
  try {
    submitBody = (await submitRes.json()) as KurierSubmitResponse;
  } catch {
    console.warn("[kurier] submit response was not JSON");
    return null;
  }
  const jobId = jobIdOf(submitBody);
  if (!jobId) {
    console.warn("[kurier] submit response had no job id");
    return null;
  }
  // Poll until Finalized (or timeout). Statuses per the build guide:
  // Submitted -> IncludedInBlock -> Finalized.
  while (Date.now() < deadline) {
    const waitMs = Math.min(pollIntervalMs, Math.max(0, deadline - Date.now()));
    if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
    if (Date.now() >= deadline) break;
    let statusRes: Response;
    try {
      statusRes = await fetchImpl(`${KURIER_BASE}/jobs/${jobId}`, {
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
      });
    } catch {
      break;
    }
    if (!statusRes.ok) break;
    let statusBody: { status?: string; txHash?: string; tx_hash?: string } = {};
    try {
      statusBody = (await statusRes.json()) as typeof statusBody;
    } catch {
      break;
    }
    const status = statusBody.status ?? "";
    if (status === "Finalized") {
      return { jobId, status, txHash: statusBody.txHash ?? statusBody.tx_hash };
    }
    if (status === "Failed" || status === "Error") {
      console.warn(`[kurier] job ${jobId} ended with status ${status}`);
      return null;
    }
  }
  console.warn(`[kurier] job ${jobId} did not finalize within budget`);
  return { jobId, status: "Pending" };
}
