import { knowledgeBatchRequestId } from "@shared/knowledgePublication";
import type { KnowledgeReadingPreparation, KnowledgeReadingProgress } from "@shared/knowledgeReadingPreparation";

export type ReadingDraft = { index: number; pages: Array<{ headline: string; body: string }> };
export type ReadingPreparationState = KnowledgeReadingPreparation & {
  status: string; ready: number[]; completed: number[]; failed: number[];
  drafts?: ReadingDraft[];
  paidUnit: number; maxCredits: number; estimatedCredits: number;
};
type ReadingReceipt = { creditsCharged: number; replayed?: boolean };
type ReadingRecovery = ReadingReceipt | { failed: string } | undefined;

/** 两路首次提交；不明回执只查询原事务，网络恢复不会再 execute 同一分段。 */
export function createKnowledgeReadingController(deps: {
  state: (jobId: string) => Promise<ReadingPreparationState>;
  confirm: (state: ReadingPreparationState) => Promise<boolean>;
  execute: (link: KnowledgeReadingPreparation, index: number, requestId: string, paidUnit: number) => Promise<ReadingReceipt>;
  recover?: (link: KnowledgeReadingPreparation, index: number, requestId: string) => Promise<ReadingRecovery>;
  progress: (message: string) => void;
  content?: (drafts: ReadingDraft[]) => void;
}) {
  let link: KnowledgeReadingPreparation | undefined;
  let state: ReadingPreparationState | undefined;
  let accepted: boolean | undefined;
  let stopped = false, terminalFailure: Error | undefined;
  let checking: Promise<void> | undefined;
  let authorized = 0, charged = 0, authorizedBatches = 0;
  let latestValue: KnowledgeReadingProgress | undefined, latestSignature = "";
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  const completed = new Set<number>(), uncertain = new Set<number>();
  const running = new Map<number, Promise<void>>(), drafts = new Map<number, ReadingDraft>();

  const publish = (incoming: ReadingDraft[]) => {
    if (stopped) return;
    incoming.forEach(draft => drafts.set(draft.index, draft));
    deps.content?.(Array.from(drafts.values()).sort((a, b) => a.index - b.index));
  };
  const scheduleRecovery = () => {
    if (stopped || terminalFailure || retryTimer || !latestValue) return;
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      if (!stopped && latestValue) void update(latestValue).catch(() => {
        if (!stopped) deps.progress("顾问结果暂未取回，正在恢复原任务；不会重复提交");
        scheduleRecovery();
      });
    }, 5000);
  };
  const pump = () => {
    if (!accepted || stopped || terminalFailure || uncertain.size || !state || !link) return;
    for (const index of state.ready) {
      if (running.size >= 2) break;
      if (completed.has(index) || running.has(index)) continue;
      const identity = { ...link }, paidUnit = state.paidUnit;
      const requestId = knowledgeBatchRequestId(identity.documentId, index, 0);
      deps.progress("读档顾问正在整理已读取的内容，整理结果将自动显示在下方…");
      // 先登记占位，再执行：同步拒绝也不会留下已经结束的 running 项。
      const work = Promise.resolve().then(async () => {
        if (stopped) return;
        let result: ReadingReceipt;
        try { result = await deps.execute(identity, index, requestId, paidUnit); }
        catch (error) {
          if ((error as {advisorRejected?: boolean})?.advisorRejected) {
            terminalFailure = error instanceof Error ? error : new Error(String(error));
            if (!stopped) deps.progress("顾问明确返回失败，已停止后续整理，原内容保留");
            return;
          }
          uncertain.add(index);
          if (!stopped) deps.progress("顾问回执暂未确认，正在查询原任务；已完成内容保留，不重复提交");
          if (deps.recover) scheduleRecovery();
          else terminalFailure = error instanceof Error ? error : new Error(String(error));
          return;
        }
        if (!result.replayed) charged += result.creditsCharged;
        if (charged > authorized) {
          terminalFailure = Error("读档顾问费用超出确认范围，已停止后续请求");
          if (!stopped) deps.progress(terminalFailure.message);
          return;
        }
        completed.add(index);
        if (stopped) return;
        try {
          const saved = await deps.state(identity.jobId);
          publish(saved.drafts || []);
          if (!stopped) deps.progress(drafts.has(index) ? "整理结果已保存并显示在下方，后续内容将自动更新" : "顾问已返回，正在读取已保存的整理内容");
        } catch {
          if (!stopped) deps.progress("已保存整理结果，正在恢复内容；不会重复提交");
        }
        if (deps.content && !drafts.has(index)) scheduleRecovery();
      }).finally(() => { running.delete(index); pump(); });
      running.set(index, work);
    }
  };
  const update = async (value: KnowledgeReadingProgress) => {
    if (stopped) return;
    if (latestValue && latestValue.jobId !== value.jobId) throw Error("读档顾问不能混入另一份文件");
    latestValue = value;
    const signature = JSON.stringify(value);
    const settled = () => signature === latestSignature && !uncertain.size && (!deps.content || Array.from(completed).every(i => drafts.has(i)));
    if (settled()) return;
    while (checking) { await checking; if (stopped || settled()) return; }
    checking = (async () => {
      state = await deps.state(value.jobId);
      if (stopped) return;
      if (state.jobId !== value.jobId || state.documentId !== value.documentId) throw Error("顾问回执不属于当前原稿");
      link = { jobId: state.jobId, documentId: state.documentId, batches: state.batches };
      publish(state.drafts || []);
      state.completed.forEach(i => { completed.add(i); uncertain.delete(i); });
      if (state.status === "failed" || state.status === "cancelled") {
        stopped = true;
        if (retryTimer) clearTimeout(retryTimer);
        deps.progress("原读档已停止，已有整理内容保留");
        return;
      }
      if (state.failed.length) terminalFailure = Error("部分原文没有读取成功，不能把缺段资料当完整稿交给顾问");
      if (terminalFailure) return;
      if (accepted === undefined || (accepted && state.batches > authorizedBatches)) {
        accepted = await deps.confirm(state);
        if (accepted) { authorized = Math.max(authorized, charged + state.maxCredits); authorizedBatches = state.batches; }
      }
      if (stopped) return;
      if (deps.recover) for (const index of Array.from(uncertain)) {
        let receipt: ReadingRecovery;
        try { receipt = await deps.recover(link, index, knowledgeBatchRequestId(link.documentId, index, 0)); }
        catch { continue; }
        if (stopped) return;
        if (receipt && "failed" in receipt) {
          terminalFailure = Error(receipt.failed);
          deps.progress("顾问任务已返回失败，已停止后续整理；原结果保留，未重新提交");
          break;
        }
        if (receipt) { completed.add(index); uncertain.delete(index); }
      }
      latestSignature = signature;
      if (uncertain.size || (deps.content && Array.from(completed).some(i => !drafts.has(i)))) scheduleRecovery();
      if (accepted) pump();
      else deps.progress("本次未启用读档同步顾问；完整原稿继续读取，出图前仍可整理");
    })();
    try { await checking; }
    catch (error) { scheduleRecovery(); throw error; }
    finally { checking = undefined; }
  };
  return {
    update,
    stop() { stopped = true; if (retryTimer) clearTimeout(retryTimer); },
    link() { return accepted && !stopped ? link : undefined; },
    async wait() {
      for (;;) {
        if (checking) {
          try { await checking; }
          catch { /* 状态查询失败不等于顾问任务失败，下面只恢复原状态。 */ }
        }
        if (running.size) await Promise.all(Array.from(running.values()));
        if (stopped) throw Error("读档同步顾问已停止，未开始后续审校");
        if (terminalFailure) throw terminalFailure;
        if (accepted === false) return;
        if (accepted === undefined && latestValue) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          try { await update(latestValue); } catch { /* 网络恢复前保留原身份。 */ }
          continue;
        }
        if (!accepted) return;
        const missingContent = Boolean(deps.content && Array.from(completed).some(i => !drafts.has(i)));
        if (!uncertain.size && !missingContent) break;
        if ((!deps.recover && uncertain.size) || !latestValue) throw Error("顾问回执尚未确认，未重新提交");
        await new Promise(resolve => setTimeout(resolve, 1000));
        try { await update(latestValue); } catch { /* 网络恢复前保留原身份。 */ }
      }
      if (!link || completed.size !== link.batches) throw Error("读档顾问仍有未整理分段，请恢复原任务；不会重新购买已完成部分");
    },
  };
}
