import { randomUUID } from "node:crypto";
import { readGcsPrefixRevision } from "./gcs.js";

/** 每个进程共用一个轻量目录监听器；有人打开入口时才检查 GCS 对象版本。 */
export function createTemplateCatalogEvents(readRevision: () => Promise<string>, intervalMs = 10_000) {
  let revision = randomUUID();
  let storedRevision: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let checking = false;
  const listeners = new Set<(revision: string) => void>();
  const publish = () => {
    revision = randomUUID();
    for (const listener of Array.from(listeners)) {
      try { listener(revision); } catch { listeners.delete(listener); }
    }
  };
  const check = async () => {
    if (checking || !listeners.size) return;
    checking = true;
    try {
      const next = await readRevision();
      if (listeners.size && next !== storedRevision) {
        storedRevision = next;
        publish();
      }
    } catch {
      // 保留上一版，下一次检查继续；存储故障不广播“空目录”。
    } finally {
      checking = false;
      if (listeners.size) {
        timer = setTimeout(() => { timer = undefined; void check(); }, intervalMs);
        timer.unref?.();
      }
    }
  };
  return {
    revision: () => revision,
    publish,
    subscribe(listener: (revision: string) => void) {
      listeners.add(listener);
      if (!timer && !checking) void check();
      return () => {
        listeners.delete(listener);
        if (!listeners.size && timer) { clearTimeout(timer); timer = undefined; }
      };
    },
  };
}

const catalog = createTemplateCatalogEvents(() => readGcsPrefixRevision("manhua-template-learn/approved/"));
export const templateCatalogRevision = catalog.revision;
export const subscribeTemplateCatalog = catalog.subscribe;
/** 本进程批准后立即通知；其他进程或 CLI 入库由 GCS 版本检查补齐。 */
export const publishTemplateCatalogChanged = catalog.publish;
