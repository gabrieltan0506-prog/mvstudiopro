import { patchJobRunningProgress } from "./repository.js";

/**
 * 2×4 / 小紅書寬幅合成：TRPC 長請求期間把 flowLog 每則 append 節流寫入 DB，供前端 GET /api/jobs/:id 輪詢。
 * detach() 時再做一次同步 flush 並還原 push。
 */
export function attachCompositeSheetFlowLogLiveSync(flowLog: string[], jobId: string): () => void {
  const jid = String(jobId || "").trim();
  if (!jid) return () => {};

  const origPush = flowLog.push.bind(flowLog);
  let timer: ReturnType<typeof setTimeout> | null = null;

  const scheduleFlush = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void patchJobRunningProgress(jid, {
        imageGenFlowLog: [...flowLog],
        compositeSheetProgress: true,
      });
    }, 120);
  };

  flowLog.push = (...items: string[]) => {
    const n = origPush(...items);
    scheduleFlush();
    return n;
  };

  return () => {
    flowLog.push = origPush;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    void patchJobRunningProgress(jid, {
      imageGenFlowLog: [...flowLog],
      compositeSheetProgress: true,
    });
  };
}
