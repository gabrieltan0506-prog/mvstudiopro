/**
 * 知识卡任务的活动心跳：runner 在任务作用域里放一个 touch 函数，每一次模型调用（含换网关重试）都 touch 一次，
 * 长书统稿几十分钟不出「进度」也不会被 withTimeout 误判卡死（0910 审查 P0）。
 * 单独成模块，避免 distill ↔ pageTriage 互相 import。
 */
import { AsyncLocalStorage } from "node:async_hooks";

export const knowledgeCardDistillActivity = new AsyncLocalStorage<() => void>();

export function touchKnowledgeCardDistillActivity(): void {
  try {
    knowledgeCardDistillActivity.getStore()?.();
  } catch {
    /* 心跳失败不影响主流程 */
  }
}
