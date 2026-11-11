/**
 * 图文手册进程内短时缓存（1111 衔接提速）。
 *
 * 用途：同一稿件版本（云稿 generation）在报价、排版输入、整册预览、导出之间反复读取整库、解析 34 张配图任务、
 * 读审校回执并核验——1110 实测 bookLayoutPreview 一次 22 秒、bookLayoutInput 8.5 秒。结果只取决于
 * 「账号 + 稿件 + generation」，generation 一变键即不同，旧值自然失效。
 *
 * 约束：
 * - 键必须含账号 id；绝不缓存跨用户数据。
 * - 容量与过期双上限；只缓存成功结果，失败的加载立即移除，下次重新读取。
 * - 同键并发读取合并为一次加载。
 * - 取出时由调用方决定是否克隆（会被就地修改的对象必须克隆）。
 */
export class KnowledgeTtlCache<V> {
  private entries = new Map<string, { at: number; value: Promise<V> }>();
  constructor(readonly maxEntries: number, readonly ttlMs: number, private now: () => number = Date.now) {}

  private fresh(key: string) {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (this.now() - hit.at > this.ttlMs) { this.entries.delete(key); return undefined; }
    // 最近使用移到末尾，淘汰从最旧开始。
    this.entries.delete(key);
    this.entries.set(key, hit);
    return hit;
  }

  has(key: string) { return Boolean(this.fresh(key)); }

  /** 只取未过期的已有值，不触发加载。 */
  peek(key: string): Promise<V> | undefined { return this.fresh(key)?.value; }

  async get(key: string, load: () => Promise<V>): Promise<V> {
    const hit = this.fresh(key);
    if (hit) return hit.value;
    const value = load();
    this.store(key, value);
    value.catch(() => { if (this.entries.get(key)?.value === value) this.entries.delete(key); });
    return value;
  }

  set(key: string, value: V) { this.store(key, Promise.resolve(value)); }

  private store(key: string, value: Promise<V>) {
    this.entries.delete(key);
    this.entries.set(key, { at: this.now(), value });
    while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value!);
  }

  /** 按前缀失效（例如某账号某稿件全部版本）。 */
  deletePrefix(prefix: string) {
    for (const key of Array.from(this.entries.keys())) if (key.startsWith(prefix)) this.entries.delete(key);
  }

  clear() { this.entries.clear(); }
  get size() { return this.entries.size; }
}

/** 接口耗时日志：只记接口名、耗时与少量计数，不含正文、地址或稿件内容。 */
export function knowledgeTimingLog(label: string, startedAt: number, fields: Record<string, string | number | boolean | undefined> = {}) {
  const extra = Object.entries(fields).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${v}`).join(" ");
  console.info(`[knowledgeTiming] ${label} ms=${Date.now() - startedAt}${extra ? ` ${extra}` : ""}`);
}
