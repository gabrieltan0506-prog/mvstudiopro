import { neon } from "@neondatabase/serverless";
import { downloadGcsObject, getGcsBucketName } from "../server/services/gcs";
import { nativeDeepReadProposalObjectName } from "../server/services/manhuaNativeDeepReadIngest";
import { executeHeavyMedia } from "../server/jobs/heavyMediaWorker";
import { assertManhuaNativeLearningExecution } from "../server/services/manhuaTemplateLearnService";
import { heavyMediaSignal } from "../server/jobs/heavyMediaContext";

// 探针只调用本批正式函数；不替换实现，不提交学习、截图或模型任务。
if (!process.env.FLY_MACHINE_ID || process.env.FLY_MACHINE_ID !== process.env.MANHUA_HEAVY_MACHINE_ID) throw new Error("探针仅允许在已配置Fly工作机执行");
const sql = neon(process.env.DATABASE_URL!);
const [job] = await sql.query(`select status, output->>'nativeSeriesKey' as "seriesKey" from jobs where id='B39Nhgt_cH4LjpJs'`);
if (!job || ["queued", "running"].includes(String(job.status))) throw new Error("本轮学习尚未结束，暂缓探针");
const active = await sql.query(`select id from jobs where status in ('queued','running') limit 1`);
if (active.length) throw new Error("仍有在途任务，暂缓工作机探针");
if (!job.seriesKey) throw new Error("本轮没有可核对的系列键，不读取其他项目产物");
const signal = AbortSignal.timeout(120_000);
const receipt: Record<string, unknown> = { at: new Date().toISOString(), machine: process.env.FLY_MACHINE_ID,
  learningJob: "B39Nhgt_cH4LjpJs", learningStatus: job?.status, source: "本批正式修改源码", modelCalls: 0, mediaSubmissions: 0 };
try { assertManhuaNativeLearningExecution({}); receipt.retiredEntryBlocked = false; }
catch (error) { receipt.retiredEntryBlocked = (error as Error).message.includes("旧抽帧学习"); }
assertManhuaNativeLearningExecution({ nativeDeepReadConfirmed: true });
receipt.nativeEntryAccepted = true;
let frames: import("../shared/manhuaViralTemplateBank").ManhuaViralTemplateEvidenceFrame[] = [];
for (const episodeIndex of [35, 6, 15, 16]) {
  const objectName = nativeDeepReadProposalObjectName(job.seriesKey, episodeIndex);
  let buffer: Buffer;
  try { ({ buffer } = await downloadGcsObject({ gcsUri: `gs://${getGcsBucketName()}/${objectName}` })); }
  catch (error) { if (/\b404\b/.test(String(error))) continue; throw error; }
  const card = JSON.parse(buffer.toString("utf8"));
  if (Array.isArray(card.evidenceFrames) && card.evidenceFrames.length) { frames = card.evidenceFrames.slice(0, 3); receipt.frameEpisodeIndex = episodeIndex; break; }
}
if (!frames.length) throw new Error("现有三集没有保存截图，无法验证真实帧完整性，不生成新帧");
const result = await heavyMediaSignal.run(signal, () => executeHeavyMedia({ kind: "learn_work", requestId: "real-readonly-probe",
  work: { operation: "verify_frames", frames } }, signal, async () => {})) as { stdout: string };
receipt.verifiedFrames = JSON.parse(result.stdout);
const broken = [{ ...frames[0], sha256: "0".repeat(64) }];
const rejected = await heavyMediaSignal.run(signal, () => executeHeavyMedia({ kind: "learn_work", requestId: "real-integrity-rejection",
  work: { operation: "verify_frames", frames: broken } }, signal, async () => {})) as { stdout: string };
receipt.corruptedDigestRejected = JSON.parse(rejected.stdout)[0] === false;
const controller = new AbortController(); controller.abort(new Error("探针取消"));
try { await executeHeavyMedia({ kind: "learn_work", requestId: "cancel-probe", work: { operation: "verify_frames", frames } }, controller.signal, async () => {}); receipt.cancelRejected = false; }
catch { receipt.cancelRejected = true; }
try {
  await heavyMediaSignal.run(signal, () => executeHeavyMedia({ kind: "learn_work", requestId: "invalid-report-probe", work: {
    operation: "native_report", input: { labelZh: "探针输入校验", evidenceObjectNames: [], reportObjectName: "unused-invalid-report.html" }
  } }, signal, async () => {})); receipt.emptyReportRejected = false;
} catch (error) { receipt.emptyReportRejected = (error as Error).message.includes("segmentEvidenceObjectNames"); }
console.log(JSON.stringify(receipt));
if (!(receipt.retiredEntryBlocked && receipt.nativeEntryAccepted && receipt.corruptedDigestRejected && receipt.cancelRejected && receipt.emptyReportRejected)
  || !(receipt.verifiedFrames as boolean[]).every(Boolean)) throw new Error("正式代码只读探针发现阻断");
