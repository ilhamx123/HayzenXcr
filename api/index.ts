/**
 * Vercel Serverless Function entrypoint (Node.js runtime).
 *
 * The same request handler as the persistent server (src/handler.ts) runs
 * here; only the transport differs. Vercel rewrites /, /health and /agent
 * to this function (see vercel.json). The raw request body is read as a
 * stream, so HMAC verification over the exact bytes still works.
 *
 * The HMAC secret must be set as AGENT_GAMES_HMAC_SECRET in the Vercel
 * project settings (Environment Variables). GET /health answers even
 * without it; POST /agent returns 500 until it is set.
 *
 * Rewrite note: whether Vercel hands this function the ORIGINAL path
 * (/health, /agent) or the REWRITTEN path (/api/index) is not documented
 * precisely, so both are handled. When the path is /api/index (or /api),
 * the route is derived from the method instead: POST -> /agent,
 * GET -> /health.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { createLazyRequestHandler } from "../dist/handler.js";

const handle = createLazyRequestHandler();

function effectivePath(req: IncomingMessage): string {
  let pathname = "/";
  try {
    pathname = new URL(req.url ?? "/", "http://localhost").pathname;
  } catch {
    pathname = req.url ?? "/";
  }
  if (pathname === "/api/index" || pathname === "/api/index.ts" || pathname === "/api") {
    return req.method === "POST" ? "/agent" : "/health";
  }
  return pathname;
}

export default function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  return handle(req, res, effectivePath(req));
}
