import { parseNativeDeepReadJobConfirmation, type NativeDeepReadJobConfirmation } from "./manhuaNativeDeepReadJob.js";

/** 只允许复用本人已经终止的同源任务，避免模型切换与旧任务并发计费。 */
export function assertNativeStructuringPreviousJob(input: {
  confirmation: NativeDeepReadJobConfirmation;
  userId: string;
  previousJob: { userId?: unknown; status?: unknown; input?: unknown; output?: unknown } | null;
  extraSourceHosts?: readonly string[];
}): void {
  const current = input.confirmation;
  if (!current.structuringOnly) return;
  const previous = input.previousJob;
  if (!previous || String(previous.userId) !== input.userId
    || !["failed", "succeeded", "cancelled", "canceled"].includes(String(previous.status))) {
    throw new Error("请先等待原学习任务停止，再切换模型重新整形");
  }
  const oldInput = previous.input as { action?: unknown; params?: Record<string, unknown> } | undefined;
  if (oldInput?.action !== "manhua_template_learn" || !oldInput.params) throw new Error("原任务不是学习任务");
  const output = previous.output as { nativeModelReceipts?: Array<{ episodeIndexes?: number[] }> } | undefined;
  if (!output?.nativeModelReceipts?.some(receipt => receipt.episodeIndexes?.includes(current.structuringEpisodeIndex!))) {
    throw new Error("原任务没有该集读片回执，禁止改用其他集的证据");
  }
  const old = parseNativeDeepReadJobConfirmation(oldInput.params, { extraSourceHosts: input.extraSourceHosts });
  if (current.url !== old.url || current.readModel !== old.readModel
    || current.segmentSeconds !== old.segmentSeconds || current.videoFps !== old.videoFps
    || current.standaloneSource !== old.standaloneSource || current.learnLlm !== old.learnLlm
    || (old.structuringOnly && current.structuringEpisodeIndex !== old.structuringEpisodeIndex)
    || current.structuringModel === old.structuringModel) {
    throw new Error("重新整形必须使用原任务同源同集的读片参数，并切换另一整形模型");
  }
}
