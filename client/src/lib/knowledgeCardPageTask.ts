import { KNOWLEDGE_CARD_PAGE_ACTIONS, KNOWLEDGE_CARD_REQUEST_ID, type KnowledgeCardPageAction } from "../../../shared/knowledgeCardPageTask";

type PendingRequest = { requestId: string; action: KnowledgeCardPageAction };
const documentRequests = new Set<string>();

/** Only this tab's requests are recorded. No book text, credentials, or finished output is stored. */
export class KnowledgeCardPageTasks {
  private readonly key: string;
  private active = new Map<string, PendingRequest>();
  private leaving = false;
  constructor(userId: string) { this.key = `mvs-knowledge-card-page-requests.v1:${userId}`; }

  private read(): PendingRequest[] {
    try {
      const rows = JSON.parse(sessionStorage.getItem(this.key) || "[]");
      return Array.isArray(rows) ? rows.filter((r) => r && KNOWLEDGE_CARD_REQUEST_ID.test(r.requestId) && KNOWLEDGE_CARD_PAGE_ACTIONS.includes(r.action)) : [];
    } catch { return []; }
  }
  private write(rows: PendingRequest[]): void {
    // If durable intent cannot be written, reject before submission instead of leaving an untracked job.
    sessionStorage.setItem(this.key, JSON.stringify(rows));
  }
  assertLive(): void {
    if (this.leaving) throw new Error("页面已离开，已停止本次任务");
  }
  begin(action: KnowledgeCardPageAction): string {
    this.assertLive();
    const record = { requestId: crypto.randomUUID(), action };
    this.write([...this.read(), record]);
    this.active.set(record.requestId, record);
    documentRequests.add(record.requestId);
    return record.requestId;
  }
  finish(requestId: string): void {
    this.active.delete(requestId);
    documentRequests.delete(requestId);
    try { this.write(this.read().filter(r => r.requestId !== requestId)); } catch { /* harmless extra cancel on next reload */ }
  }
  private url(r: PendingRequest): string {
    return `/api/jobs/knowledge-card/request/${encodeURIComponent(r.requestId)}/cancel?action=${r.action}`;
  }
  private async cancel(r: PendingRequest): Promise<void> {
    const response = await fetch(this.url(r), { method: "POST", credentials: "include", keepalive: true });
    if (!response.ok) throw new Error("上次任务的停止状态暂未确认，请保持联网后重试刷新");
    const receipt = await response.json();
    if (!receipt.cancelled && receipt.status !== "succeeded" && receipt.status !== "failed") {
      throw new Error("上次任务正在保存结果，请稍后核对任务状态");
    }
    this.finish(r.requestId);
  }
  attach(onLeave: () => void, onError: (message: string) => void): () => void {
    // New tabs can inherit an opener's sessionStorage. Discard inherited identities without cancelling them.
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (navigation?.type === "navigate") {
      try { this.write(this.read().filter(r => documentRequests.has(r.requestId))); } catch { /* begin will fail closed */ }
    }
    const sendStops = () => {
      this.leaving = true;
      onLeave();
      for (const r of Array.from(this.active.values())) {
        // Beacon survives document teardown. Retain the record until the new page confirms receipt.
        let sent = false;
        try { sent = navigator.sendBeacon(this.url(r)); } catch { /* use keepalive */ }
        if (!sent) void this.cancel(r).catch(() => {});
      }
    };
    let disposed = false;
    let recovering = false;
    const recover = async () => {
      if (recovering || disposed) return;
      // Reload/back preserve sessionStorage. A newly opened tab may receive a copy; do not cancel its source tab.
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      if (nav?.type !== "reload" && nav?.type !== "back_forward") return;
      recovering = true;
      try {
        for (const r of this.read()) {
          if (documentRequests.has(r.requestId) || disposed) continue;
          try { await this.cancel(r); } catch (err) { if (!disposed) onError((err as Error).message); }
        }
      } finally { recovering = false; }
    };
    // Hiding a tab is not a cancellation. Only a real document departure stops it.
    const resume = (event: PageTransitionEvent) => { if (event.persisted) window.location.reload(); };
    window.addEventListener("pageshow", resume);
    window.addEventListener("pagehide", sendStops);
    window.addEventListener("online", recover);
    void recover();
    return () => { disposed = true; window.removeEventListener("pageshow", resume); window.removeEventListener("pagehide", sendStops); window.removeEventListener("online", recover); };
  }
}
