import { knowledgeImageMayRetry } from "@shared/knowledgeImageRetry";
/** 本次页面内只等待已经分配的图片任务；刷新后由保存的 jobId 继续查询。 */
export function knowledgeIllustrationRun(ids: readonly string[]) {
  const slots = new Map(ids.map(id => {
    let resolve!: () => void, reject!: (error: Error) => void;
    const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    // 文字可能先失败，仍要吸收未被等待的图片错误，避免悬空 rejection。
    void promise.catch(() => undefined);
    return [id, { promise, resolve, reject }] as const;
  }));
  return {
    wait: async (selected: string[]) => { await Promise.all(selected.map(id => {
      const slot = slots.get(id);
      if (!slot) throw new Error("同步配图身份不匹配");
      return slot.promise;
    })); },
    done: (id: string) => slots.get(id)?.resolve(),
    stop: () => { for (const slot of Array.from(slots.values())) slot.reject(new Error("配图未全部完成，文字和已完成图片均已保留；请恢复原任务后继续整理")); },
  };
}

/** 与服务端knowledgeCardPageJobId同一编码；请求号仍由页面取消账本登记。 */
export async function knowledgeIllustrationJobId(owner: string, requestId: string): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([owner, "platform_composite_sheet_progress", requestId.toLowerCase()]));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return "kc_" + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("").slice(0, 56);
}

/** 补图前对账：成功恢复、在途等待；仅明确失败或本页证实从未提交才可购买。 */
export async function inspectKnowledgeIllustrationRetry(
  jobId: string,
  knownUnsubmitted: boolean,
  read: (id: string) => Promise<{ status: string; input?: unknown; output?: unknown }>,
): Promise<string | null> {
  try {
    const job = await read(jobId);
    if (job.status === "succeeded") {
      const output = job.output as { compositeImageUrl?: string; imageUrl?: string } | null;
      const url = output?.compositeImageUrl || output?.imageUrl;
      if (!url) throw new Error("原配图已成功但缺少图片回执，请先核对原任务；没有重新扣费");
      return url;
    }
    if (job.status === "failed") {
      if (knowledgeImageMayRetry(job)) return null;
      throw new Error("原配图失败，但上游结果或退款尚未确认；请保留原任务等待核对，不能重新购买");
    }
    throw new Error("原配图仍在执行或结果待核实，请等待原任务；没有重新购买图片");
  } catch (error) {
    if (knownUnsubmitted && /\(404\)|Job not found/i.test(String((error as Error).message))) return null;
    throw error;
  }
}
