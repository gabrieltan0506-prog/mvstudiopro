import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { conversionBilling, type FileConversionOutcome } from "../../shared/fileConversion";
import { deductCreditsAmount, refundChargeByKey } from "../credits";
import { executeFileConversion } from "../services/fileConversion";
import { readHeavyMediaResult, saveHeavyMediaResult } from "../services/heavyMediaEvidence";
import { withPostProdResources } from "../services/postProdResources";
import { withHeavyMediaContext } from "./heavyMediaContext";
import { resolveJobWorkerRole } from "./workerRole";
import { bindConversionSource, claimConversionJob, conversionRecoveryJobs, finishConversionJob, heartbeatConversion, markConversionSettled, recoverConversionTerminal, settleFreeConversion, type ConversionJob } from "./fileConversionRepository";

const owner = `${process.env.FLY_MACHINE_ID || "local"}/${randomUUID()}`;
const chargeKey = (id: string) => `fileConversion/${id}`;
let timer: ReturnType<typeof setInterval> | undefined;
let active: Promise<void> | undefined;
let controller: AbortController | undefined;
let stopped = true;
let mayClaim = () => true;
export function fileConversionsBusy() { return !!active; }
export async function settleConversionJob(job: ConversionJob) {
  if (job.lane === "free") await settleFreeConversion(job);
  else if (job.input.phase === "convert" && !(job.status === "succeeded" && job.output?.type === "converted")) {
    try {
      await refundChargeByKey({ userId: Number(job.userId), chargeKey: chargeKey(job.id),
        reason: "文件转换未完成，积分原路退回", actionForLog: "fileConversion", refundKey: `fileConversionRefund/${job.id}` });
    } catch (error) { await markConversionSettled(job, true); throw error; }
  }
  await markConversionSettled(job);
}
export async function chargeConversionJob(job: ConversionJob, billing: ReturnType<typeof conversionBilling>) {
  if (job.lane !== "paid" || job.input.phase !== "convert") return;
  if (!billing.available || !billing.credits || billing.credits !== job.input.quote?.credits || billing.pricingVersion !== job.input.quote.pricingVersion) throw new Error("转换报价已变化，请重新检查并确认；未扣积分");
  const result = await deductCreditsAmount(Number(job.userId), billing.credits, "fileConversion", `文件转换（${billing.credits}积分）`, { chargeKey: chargeKey(job.id) });
  if (!result.success) throw new Error("积分不足，请充值后重新确认");
}
async function recover(lane: "free" | "paid") {
  for (const job of await conversionRecoveryJobs(lane)) {
    if (job.status !== "running") { await settleConversionJob(job); continue; }
    // 只恢复同任务永久回执；没有回执则失败并释放额度/退款，绝不重做文件。
    const result = await readHeavyMediaResult(job.id, job.userId) as FileConversionOutcome | null;
    const settled = await recoverConversionTerminal(job, result);
    if (settled) await settleConversionJob(settled);
  }
}
export async function processFileConversionOnce() {
  const lane = resolveJobWorkerRole() === "rig" ? "paid" : "free";
  await recover(lane);
  if (stopped || !mayClaim()) return;
  const job = await claimConversionJob(lane, owner);
  if (!job) return;
  const abort = new AbortController(); controller = abort;
  let lastSaved = Date.now();
  let pulsePending: Promise<void> | undefined;
  const pulse = async () => {
    const flags = await heartbeatConversion(job); lastSaved = Date.now();
    if (flags.cancelRequested) abort.abort(new Error("用户停止了转换"));
  };
  const heartbeat = setInterval(() => {
    if (Date.now() - lastSaved >= 10 * 60_000) abort.abort(new Error("转换连续10分钟无法保存心跳"));
    if (!pulsePending) pulsePending = pulse().catch(() => undefined).finally(() => { pulsePending = undefined; });
  }, 30_000);
  heartbeat.unref?.();
  try {
    let result: FileConversionOutcome | null = null;
    let failure: string | undefined;
    try {
      await pulse();
      result = await withPostProdResources(job.id, abort.signal, { phase: "file_conversion" }, signal =>
        withHeavyMediaContext({ userId: job.userId, executionId: job.id }, () => executeFileConversion(job.input, signal, {
          onSource: async sha256 => { await bindConversionSource(job, sha256); job.sourceSha = sha256; },
          beforeConvert: billing => chargeConversionJob(job, billing),
        })));
      abort.signal.throwIfAborted();
    } catch {
      failure = abort.signal.aborted ? "转换已停止，原文件保留；额度或积分将原路返还" : "转换未完成，原文件保留；额度或积分将原路返还";
    }
    // 持久化结果/终态未确认前不释放执行者；绝不自动重新运行转换。
    while (true) {
      try {
        if (result && !failure) await saveHeavyMediaResult(job.id, job.userId, result);
        const terminal = await finishConversionJob(job, result, failure);
        await settleConversionJob(terminal);
        break;
      } catch {
        const { getConversionJob } = await import("./fileConversionRepository");
        const current = await getConversionJob(job.id).catch(() => null);
        if (current && current.status !== "running") {
          await settleConversionJob(current); break;
        }
        await delay(5000);
      }
    }
  } finally { clearInterval(heartbeat); await pulsePending; controller = undefined; }
}
export function startFileConversionWorker(options: { canClaim?: () => boolean } = {}) {
  mayClaim = options.canClaim || (() => true);
  if (timer) return; stopped = false;
  const tick = () => {
    if (active || stopped) return;
    active = processFileConversionOnce().catch(() => console.warn("[file-conversion] queue/settlement temporarily unavailable")).finally(() => { active = undefined; });
  };
  timer = setInterval(tick, 2000); timer.unref?.(); tick();
}
export function stopFileConversionWorker() { stopped = true; if (timer) clearInterval(timer); timer = undefined; }
export async function drainFileConversions() { stopFileConversionWorker(); controller?.abort(new Error("服务正在退出")); await active; }
