/**
 * Persistent seen-set for Proof Gatekeeper proof references.
 * Every proof_tx the agent has seen is recorded in data/seen.json so a
 * re-submitted proof is detected as PROOF_REUSED, even across restarts.
 * The file lives under data/ (gitignored) and is written atomically.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MAX_ENTRIES = 10_000;

export class SeenStore {
  private readonly filePath: string;
  private readonly seen = new Set<string>();
  private saveFailedWarned = false;

  constructor(dataDir: string) {
    try {
      if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
    } catch {
      // Read-only filesystem (serverless): keep the in-memory set only.
      // save() below fails soft, so requests never die on persistence.
    }
    this.filePath = join(dataDir, "seen.json");
    this.load();
  }

  private load(): void {
    try {
      if (!existsSync(this.filePath)) return;
      const raw = JSON.parse(readFileSync(this.filePath, "utf8")) as unknown;
      if (Array.isArray(raw)) {
        for (const entry of raw) {
          if (typeof entry === "string") this.seen.add(entry.toLowerCase());
        }
      }
    } catch {
      // Corrupt state file: start empty rather than crashing the agent.
      this.seen.clear();
    }
  }

  private save(): void {
    try {
      const tmp = `${this.filePath}.tmp`;
      writeFileSync(tmp, JSON.stringify([...this.seen], null, 2), "utf8");
      renameSync(tmp, this.filePath);
    } catch (err) {
      // Fail soft: the in-memory set still dedupes within this process.
      // (Warn once per instance to avoid spamming the logs.)
      if (!this.saveFailedWarned) {
        this.saveFailedWarned = true;
        console.warn(
          `[seen-store] cannot persist ${this.filePath}: ${err instanceof Error ? err.message : err} (in-memory only)`,
        );
      }
    }
  }

  has(proofTx: string): boolean {
    return this.seen.has(proofTx.toLowerCase());
  }

  /** Record a proof_tx as seen. Returns true if it was new. */
  add(proofTx: string): boolean {
    const key = proofTx.toLowerCase();
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    if (this.seen.size > MAX_ENTRIES) {
      // FIFO trim: drop the oldest entries.
      const excess = this.seen.size - MAX_ENTRIES;
      const it = this.seen.values();
      for (let i = 0; i < excess; i++) {
        const first = it.next().value;
        if (first !== undefined) this.seen.delete(first);
      }
    }
    this.save();
    return true;
  }

  get size(): number {
    return this.seen.size;
  }
}
