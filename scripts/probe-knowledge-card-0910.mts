/**
 * 0910 知识卡长书探针（只在 Fly 容器内跑，用分支源码打包成单文件放 /app 下执行，不动部署）。
 * 用已上传到 GCS 的那本 EPUB（取用户最近一条 knowledge_card_distill 任务的 files[0]，或 --gcs=）：
 * 1) prepareKnowledgeCardCopy 完整版（level=full）：转换 → 读页 → 挑参考页（DeepSeek 视觉链）→ 分段提炼 → 统稿
 * 2) deriveKnowledgeCardCompact：从完整版长稿派生精华版（DeepSeek V4 Flash）
 * 输出 /tmp/probe-0910/{full.md,concise.md,summary.json}，日志逐段带时间戳。
 */
import fs from "node:fs/promises";
if (process.env.FLY_APP_NAME !== "mvstudiopro") throw new Error("只允许在 Fly 容器内运行");
const arg = (k: string, d = "") => (process.argv.find((a) => a.startsWith(`--${k}=`)) || "").split("=").slice(1).join("=") || d;
const userId = Number(arg("user", "1"));
const model = arg("model", "deepseek-v4-flash");
const out = arg("out", "/tmp/probe-0910");
await fs.mkdir(out, { recursive: true });
const t0 = Date.now();
const el = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;
const log = (...a: unknown[]) => console.info(`[probe-0910 ${el()}]`, ...a);

const { getLatestPlatformJobForUserAction } = await import("../server/jobs/repository.js");
const { prepareKnowledgeCardCopy } = await import("../server/services/knowledgeCardDistill.js");
const { knowledgeCardDistillActivity } = await import("../server/services/knowledgeCardDistillActivity.js");
const { deriveKnowledgeCardCompact } = await import("../server/services/knowledgeCardLevelDerive.js");
const { planKnowledgeCardPages } = await import("../shared/knowledgeCardPagination.js");

let gcsUri = arg("gcs", "");
let fileName = arg("name", "probe.epub");
let mimeType = arg("mime", "application/epub+zip");
if (!gcsUri) {
  const job = await getLatestPlatformJobForUserAction(String(userId), "knowledge_card_distill");
  const files = (job?.input as { params?: { files?: Array<{ gcsUri: string; mimeType: string; fileName?: string }> } })?.params?.files || [];
  if (!files.length) throw new Error("没找到最近一条带文件的提炼任务，请用 --gcs= 指定");
  gcsUri = files[0]!.gcsUri; mimeType = files[0]!.mimeType; fileName = files[0]!.fileName || fileName;
  log(`最近任务 ${job?.id} 状态 ${job?.status}，文件 ${fileName} ${mimeType} ${gcsUri}`);
}

let lastBeat = Date.now();
const touch = () => { lastBeat = Date.now(); };
const beatWatch = setInterval(() => log(`heartbeat idle ${((Date.now() - lastBeat) / 1000).toFixed(0)}s`), 5 * 60_000);

const prepared = await knowledgeCardDistillActivity.run(touch, () => prepareKnowledgeCardCopy({
  files: [{ gcsUri, mimeType, fileName }],
  forceDistill: true,
  distillModel: model,
  detailLevel: "full",
  userId,
  onExtractProgress: (p) => { touch(); log(`extract ${p.stage} ${p.done}/${p.total} ${p.fileName || ""}`); },
  onProgress: (p) => { touch(); log(`distill ${p.phase} ${p.doneChunks}/${p.totalChunks}`); },
}));
clearInterval(beatWatch);
const full = prepared.distilledMarkdown;
await fs.writeFile(`${out}/full.md`, full);
const fullPlan = planKnowledgeCardPages(full, prepared.distillModel);
const sections = (md: string) => (md.match(/^##\s/gm) || []).length;
log(`FULL done chars=${full.length} sections=${sections(full)} pages=${fullPlan.pageCount} credits=${fullPlan.credits} model=${prepared.distillModel} methods=${prepared.extractionMethods.join(" | ")}`);
const notices = prepared.extractionMethods.filter((m) => m.includes(":notice:"));
log(`notices: ${notices.length ? notices.join(" || ") : "none"}`);

const t1 = Date.now();
const derived = await knowledgeCardDistillActivity.run(touch, () => deriveKnowledgeCardCompact({
  fullMarkdown: full,
  onProgress: (p) => log(`derive pass ${p.pass} batch ${p.doneBatches}/${p.totalBatches}`),
}));
await fs.writeFile(`${out}/concise.md`, derived.markdown);
const concisePlan = planKnowledgeCardPages(derived.markdown, prepared.distillModel);
log(`CONCISE done chars=${derived.markdown.length} sections=${derived.sections} target=${derived.targetSections} passes=${derived.passes} pages=${concisePlan.pageCount} credits=${concisePlan.credits} deriveSec=${((Date.now() - t1) / 1000).toFixed(0)}`);
const summary = {
  file: { gcsUri, fileName, mimeType },
  totalSec: Math.round((Date.now() - t0) / 1000),
  full: { chars: full.length, sections: sections(full), pages: fullPlan.pageCount, credits: fullPlan.credits },
  concise: { chars: derived.markdown.length, sections: derived.sections, target: derived.targetSections, passes: derived.passes, pages: concisePlan.pageCount, credits: concisePlan.credits },
  methods: prepared.extractionMethods,
};
await fs.writeFile(`${out}/summary.json`, JSON.stringify(summary, null, 2));
log(`SUMMARY ${JSON.stringify(summary)}`);
process.exit(0);
