/** 只有供应商确认仍在执行才续期；网络错误、空状态与未知状态都不算心跳。 */
export function isTaskHeartbeatStatus(status: string): boolean {
  return /^(created|queued|pending|running|processing|in_progress|in_queue|starting|submitted|generating|rendering|waiting)$/i.test(status.trim());
}

/** 兼容旧任务：没有成功心跳记录时，沿用原创建时间。 */
export function taskHeartbeatTime(task: { lastHeartbeatAt?: string; createdAt: string }): number {
  const value = Date.parse(task.lastHeartbeatAt || task.createdAt);
  return Number.isFinite(value) ? value : 0;
}
