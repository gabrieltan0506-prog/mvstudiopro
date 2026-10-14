import { createHash, randomUUID } from "node:crypto";

/** 原文先入任务记录，再解析；原文与解析对象分别带摘要，不写访问凭证。 */
export type PlatformExpandEvidence = {
  pickId: string;
  gateway: string;
  attempt: number;
  stage: "raw" | "parsed" | "rejected" | "accepted";
  value: unknown;
};

export class ExpandEvidencePersistenceError extends Error {
  constructor() {
    super("扩写回执未能保存，已停止本轮后续模型调用");
    this.name = "ExpandEvidencePersistenceError";
  }
}

export function createPlatformExpandEvidenceJournal(
  previous: unknown,
  persist: (entries: unknown[]) => Promise<void>,
) {
  const entries: unknown[] = Array.isArray(previous) ? [...previous] : [];
  const runId = randomUUID();
  return {
    entries,
    async record(event: PlatformExpandEvidence) {
      const text = JSON.stringify(event.value);
      const entry = {
        ...event, runId, recordedAt: new Date().toISOString(),
        bytes: Buffer.byteLength(text), sha256: createHash("sha256").update(text).digest("hex"),
      };
      const next = [...entries, entry];
      try { await persist(next); } catch { throw new ExpandEvidencePersistenceError(); }
      entries.push(entry);
    },
  };
}
