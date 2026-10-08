/** 每个网页只接收自己选定的学习任务，刷新复用同一回执，不接管其他网页。 */
const KEY = "mvs-manhua-learn-page-job-v1";
const fallback = new Map<string, string>();
export function readManhuaLearnPageJobId(userKey: string): string {
  if (!userKey) return "";
  try { return String(sessionStorage.getItem(`${KEY}:${encodeURIComponent(userKey)}`) || "").trim(); }
  catch { return fallback.get(userKey) || ""; }
}
export function writeManhuaLearnPageJobId(userKey: string, jobId: string): void {
  if (!userKey) return;
  const value = String(jobId || "").trim();
  fallback.set(userKey, value);
  try {
    const key = `${KEY}:${encodeURIComponent(userKey)}`;
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch { /* 页面内仍可按任务身份接收回执。 */ }
}
export function filterManhuaLearnPageJobs<T extends { jobId: string }>(items: T[], jobId: string): T[] {
  return jobId ? items.filter(item => item.jobId === jobId) : [];
}

const TAB_KEY = "mvs-manhua-learn-page-owner-v1";
const claims = new WeakMap<Storage, Map<string, Promise<void>>>();
function clearCopiedManhuaLearnPage(storage: Storage, userKey: string): void {
  const suffix = `:${encodeURIComponent(userKey)}`;
  for (const base of [KEY, "mv-manhua-learn-focus-series-v1", "mvs-manhua-learn-active-job-v1",
    "mvs-manhua-learn-result-v1", "mvs-manhua-learn-basket-v1", "mvs-manhua-learn-missing-dismissed-v1",
    "mvs-manhua-learn-continuation-v1"]) storage.removeItem(base + suffix);
  fallback.delete(userKey);
}
/** 复制标签页会复制 sessionStorage；存活网页握手让副本清本页缓存，刷新仍保留原任务。 */
export function ensureManhuaLearnPageOwnership(userKey: string): Promise<void> {
  if (!userKey) return Promise.resolve();
  let storage: Storage;
  try { storage = sessionStorage; } catch { return Promise.resolve(); }
  let scopedClaims = claims.get(storage);
  if (!scopedClaims) { scopedClaims = new Map(); claims.set(storage, scopedClaims); }
  const previous = scopedClaims.get(userKey);
  if (previous) return previous;
  const claim = new Promise<void>(resolve => {
    const ownerKey = `${TAB_KEY}:${encodeURIComponent(userKey)}`;
    const inheritedOwner = storage.getItem(ownerKey);
    const navigation = typeof performance !== "undefined"
      ? performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined : undefined;
    // 新导航继承的缓存属于上一个网页；刷新/前后返回才恢复原任务。
    // 不依赖后台网页及时回应握手，避免后台限流造成复制页误接管。
    const freshNavigation = inheritedOwner && navigation?.type === "navigate";
    if (freshNavigation) clearCopiedManhuaLearnPage(storage, userKey);
    let tabId = !freshNavigation && inheritedOwner || crypto.randomUUID();
    storage.setItem(ownerKey, tabId);
    if (typeof BroadcastChannel === "undefined") { resolve(); return; }
    const requestId = crypto.randomUUID();
    const channel = new BroadcastChannel("mvs-manhua-learn-page-owner");
    let probing = true;
    let duplicated = false;
    channel.onmessage = event => {
      const message = event.data as { type?: string; tabId?: string; requestId?: string; userKey?: string };
      if (!message || message.userKey !== userKey || message.tabId !== tabId) return;
      if (message.type === "probe" && message.requestId !== requestId
        && (!probing || requestId < String(message.requestId))) {
        channel.postMessage({ type: "occupied", tabId, userKey, requestId: message.requestId });
      }
      if (probing && message.type === "occupied" && message.requestId === requestId) duplicated = true;
    };
    channel.postMessage({ type: "probe", tabId, userKey, requestId });
    setTimeout(() => {
      if (duplicated) {
        clearCopiedManhuaLearnPage(storage, userKey);
        tabId = crypto.randomUUID(); storage.setItem(ownerKey, tabId);
      }
      probing = false;
      resolve();
    }, 150);
    if (typeof window !== "undefined") window.addEventListener("pagehide", () => {
      channel.close(); scopedClaims!.delete(userKey);
    }, { once: true });
  });
  scopedClaims.set(userKey, claim);
  return claim;
}
