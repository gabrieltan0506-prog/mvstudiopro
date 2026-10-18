/** 读取失败时保留原始字节，不能把临时空稿当成用户的备份。 */
export function digitalHumanDraftExport(raw: string | null, draft: unknown, unreadable: boolean): string {
  if (unreadable) {
    if (raw === null) throw new Error("原始草稿不可用，未导出空稿");
    return raw;
  }
  return JSON.stringify(draft, null, 2);
}

/** 不将校验器JSON或内部字段名直接展示给创作者。 */
export function digitalHumanDraftReadError(error: unknown): string {
  const issues = (error as { issues?: Array<{ path?: unknown[]; code?: string; maximum?: number }> } | null)?.issues;
  const direction = issues?.find(item => item.path?.includes("direction") && item.code === "too_big");
  if (direction) {
    const hint = direction.maximum === 1500
      ? "当前页面仍使用旧版导演说明限制。请先导出原始草稿，再刷新页面载入新版。"
      : "导演说明超过当前容量，请先导出原始草稿，再分段整理；原文未截断。";
    return `原草稿已保留，暂时停止提交。${hint}`;
  }
  return "原草稿暂时无法读取，原始内容已保留且未覆盖云端。请先导出原始草稿，再刷新页面重试；若仍失败，请保留文件用于恢复。";
}
