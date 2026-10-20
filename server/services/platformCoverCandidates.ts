import { COVER_DESIGNS, type CoverCandidateSet, type CoverCandidate, type CoverGradeStyle } from "../../shared/platformCoverCandidates.js";

export type CoverCandidateDeps = {
  save: (set: CoverCandidateSet) => Promise<void>;
  generate: (direction: string) => Promise<string>;
  grade: (url: string, style: CoverGradeStyle) => Promise<{ originalUrl: string; imageUrl: string; receiptUrl: string }>;
  charge: (id: string) => Promise<void>;
  refund: (id: string) => Promise<void>;
};

/** 每项先落提交意图，再扣费/生图；恢复只续后期，未知供应商结果绝不重投。 */
export async function runCoverCandidates(saved: CoverCandidateSet, deps: CoverCandidateDeps): Promise<CoverCandidateSet> {
  const set = structuredClone(saved);
  const save = () => deps.save(structuredClone(set));
  const refund = async (c: CoverCandidate) => {
    c.billing = "refund_pending";
    await save();
    try { await deps.refund(c.id); c.billing = "refunded"; }
    catch { c.error = "该张未交付，积分退还待恢复"; }
    await save();
    return c.billing === "refunded";
  };
  for (const design of COVER_DESIGNS) {
    const c = set.candidates.find(row => row.id === design.id)!;
    if (c.billing === "refund_pending") {
      if (!await refund(c)) continue;
    }
    if (c.status === "ready") continue;
    if (c.status === "generating") {
      c.status = "uncertain";
      c.error = "上次出图回执不完整，已停止重复生成";
      await save();
    }
    if (c.status === "failed" || c.status === "uncertain") {
      if (c.billing !== "refunded" && c.billing !== "pending") await refund(c);
      continue;
    }
    if (c.status === "pending") {
      // 意图持久化失败则不扣费、不请求供应商。
      c.status = "generating";
      c.billing = "charged";
      await save();
      try {
        await deps.charge(c.id);
        const url = await deps.generate(design.direction);
        if (!url || !/^(https?:\/\/|gs:\/\/)/.test(url)) throw new Error("无有效图片");
        c.originalUrl = url;
        c.status = "grading";
        await save();
      } catch {
        c.status = "failed";
        c.error = "该张未完成出图，保留其他候选";
        await refund(c);
        continue;
      }
    }
    try {
      if (!c.originalUrl) throw new Error("缺少原图，不能执行独立后期");
      Object.assign(c, await deps.grade(c.originalUrl, design.grade));
      c.status = "ready";
      if (c.billing !== "refunded") c.billing = "settled";
      delete c.error;
    } catch {
      // 原图保留；只允许零模型调用的后期恢复，不把未调色图冒充成品。
      c.status = "grading";
      c.error = "原图已保存，独立调色未完成，可仅恢复后期";
      if (c.billing !== "refunded") await refund(c);
    }
    await save();
  }
  return set;
}
