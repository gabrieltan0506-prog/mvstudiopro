/**
 * 规划函数的模块内小缓存：前端每次渲染、服务端每个逐页出图请求都会对同一份数 MB 的稿件反复规划。
 * 按入参字符串相等命中（最近使用优先，容量小，避免长稿占内存）；命中时由调用方返回浅拷贝，防止就地修改污染缓存。
 */
export function knowledgePlanCache<T>(capacity = 5) {
  const entries: { key: string; value: T }[] = [];
  let computed = 0;
  return {
    get(key: string, compute: () => T): T {
      const at = entries.findIndex(e => e.key === key);
      if (at >= 0) { const [hit] = entries.splice(at, 1); entries.unshift(hit!); return hit!.value; }
      computed++;
      const value = compute();
      entries.unshift({ key, value });
      if (entries.length > capacity) entries.length = capacity;
      return value;
    },
    /** 测试用：实际计算次数。 */
    get computed() { return computed; },
    clear() { entries.length = 0; computed = 0; },
  };
}
