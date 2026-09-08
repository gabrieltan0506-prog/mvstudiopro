/** 候选列表按已保存任务补齐，不以账号最近一页作为全部历史。 */
export async function loadCanvasMusicHistory<T extends { jobId: string }>(input: {
  ids: string[];
  recent: () => Promise<T[]>;
  get: (id: string) => Promise<T>;
}): Promise<{ rows: T[]; failed: boolean }> {
  const rows = new Map<string, T>();
  let failed = false;
  try { for (const row of await input.recent()) rows.set(row.jobId, row); } catch { failed = true; }
  const missing = Array.from(new Set(input.ids)).filter(id => !rows.has(id));
  // 同时最多四条只读查询；任一旧单暂不可用不删除其持久身份。
  for (let index = 0; index < missing.length; index += 4) {
    await Promise.all(missing.slice(index, index + 4).map(async id => {
      try { const row = await input.get(id); rows.set(row.jobId, row); } catch { failed = true; }
    }));
  }
  return { rows: Array.from(rows.values()), failed };
}

/** 预览签名固定长度，不把全部对白嵌套复制到任务与草稿字段。 */
export async function canvasAudioPreviewKey(serialized: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(serialized));
  return `sha256:${Array.from(new Uint8Array(hash)).map(byte => byte.toString(16).padStart(2, "0")).join("")}`;
}
