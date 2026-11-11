/**
 * 探针：小说改编「缺省线路」与「线路三（Gemini 4 Carbon）」同输入、同提示词各跑一次，与当时的原有产出三者并排对比。
 * 1111 只写不跑：交付时未执行；运行前须站长批准（Carbon 属贵档，一次约 $0.1–0.6，见交付报告）。
 *
 * 运行约束（同 scripts/probe-knowledge-handbook-*.mts / probe-gemini-carbon-ping.mts）：
 * - 只在工作机（FLY_PROCESS_GROUP=rig）运行，经 with-worker-probe-lease 包装器持有租约，入口先 assertWorkerProbeLease()；
 * - 凭证只用 Fly 服务端环境，不读写本机密钥；日志与 live.json 只写阶段、计数、用量、耗时，不写正文；
 * - 直接调用正式的 callNovelStage（与产品同一份代码、同一参数），不经扣费接口 → **不扣用户积分**；
 * - 原始与解析结果分对象永久写 GCS `probes/novel-carbon-compare/<runId>/`（只增不覆盖），探针目录另存 compare.md；终态 stage = diagnosed。
 *
 * ── 小说改编的数据存在哪、怎么按账号取最近一次产出 ──
 * ① 小说改编工作台（/novel-adaptation，NovelAdaptation.tsx → novelWorkspace.generate，管理者测试，不扣积分）：
 *    每次请求一行 jobs：id = `novel_test_<sha256("<userId>:<requestId>") 前 40 位>`，userId 为字符串，
 *    input.action = "novel_workspace_test"，input.request = 完整 NovelTestInput（阶段、题材、方向、底本、模板配比、大纲、小说正文…），
 *    output.result = 交付结果（text 为校验后的 JSON），output.raw = 模型原始返回 {text, model, settings}，
 *    output.templateCatalogSha256 / selectedTemplates[].cardSha256 = 当时模板目录与模板卡指纹。
 *    提示词本身不入库：由 buildNovelTestPrompt(input, 模板全文, 目录) 重建（prepareNovelTestTemplates，与正式生成同一份代码）；
 *    目录或模板卡若在此后有变，summary 里 catalogChanged / cardsChanged 会标出——三方对比时需注意原有产出是旧目录下写的。
 *    最近一次 = `select * from jobs where "userId" = <owner> and input->>'action' = 'novel_workspace_test' and status = 'succeeded'
 *    order by "createdAt" desc limit 1`（config.stage 可再限定阶段）。草稿正文在浏览器 IndexedDB，云端备份在 GCS
 *    `novel-workspace-backups/user-<id>/`，本探针不读备份。
 * ② 画布编剧室连载扩写（含小说底本改编，OmniCanvas → expandManhuaWriterPack，按集扣积分）：不入 jobs；
 *    每次模型调用的证据在 GCS `manhua-writer-evidence/user-<id>/<requestId>/<sha256(stageId) 前 20 位>/<uuid>/`：
 *    input.json（含完整 prompt、json 标志、所选线路、createdAt）、raw.json、parsed.json（{text, model, settings, route}）、manifest.json。
 *    最近一次 = 该账号前缀下所有 input.json 中 GCS generation（创建时间，微秒）最大者；给 requestId 则只在该请求下取（可再给 stageId）。
 *
 * request.json 的 config（字段都可省略的写「可选」）：
 *   {
 *     "ownerUserId": 1,                 // 或 "ownerEmail": "…"（二选一，必填）；须是站点拥有者（OWNER_OPEN_ID）
 *     "source": "workspace",            // 可选：workspace（缺省，小说改编工作台）| writer（画布连载扩写 / 底本改编）
 *     "requestId": "<uuid>",            // 可选：不给则取该账号最近一次成功产出
 *     "stage": "chapter",               // 可选（workspace）：只在该阶段里取最近一次
 *     "stageId": "1:<uuid>:novel",      // 可选（writer）：同一请求有多次调用时指定哪一次（缺省取最新）
 *     "baselinePreference": "auto",     // 可选：缺省线路；workspace 缺省 auto（线路一优先），writer 缺省 glm
 *     "runId": "ncc-1111a"              // 可选：缺省自动生成；同一 runId 已有对象则拒绝覆盖
 *   }
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "../server/db";
import { jobs, users } from "../drizzle/schema";
import { assertWorkerProbeLease } from "../server/services/workerProbeLease";
import { resolveSiteOwnerOnlyAllowed } from "../server/services/access-policy";
import { callNovelStage } from "../server/services/manhuaNovelAdaptationRun";
import { buildNovelTestPrompt, prepareNovelTestTemplates } from "../server/services/novelWorkspaceTest";
import { downloadGcsObjectVersioned, getGcsBucketName, listGcsObjectVersions, uploadBufferToGcsIfAbsent } from "../server/services/gcs";
import { parseNovelModelJson } from "../shared/novelJson";
import { novelModelLabel, validateNovelStageOutput, type NovelTestInput } from "../shared/novelWorkspace";
import { manhuaWriterModelLabel } from "../shared/manhuaWriterModels";
import { estimateGeminiCarbonCostUsd, GEMINI_CARBON_STANDARD_PRICE_USD_PER_M } from "../shared/geminiCarbon";

if (process.env.FLY_PROCESS_GROUP !== "rig") throw Error("只能在工作机执行");
await assertWorkerProbeLease();

type Config = {
  ownerUserId?: number; ownerEmail?: string; source?: "workspace" | "writer"; requestId?: string; stage?: NovelTestInput["stage"];
  stageId?: string; baselinePreference?: "auto" | "glm" | "deepseek"; runId?: string;
};
const configPath = process.argv[2];
if (!configPath) throw Error("缺少配置文件路径");
const dir = dirname(configPath);
const config = JSON.parse(await readFile(configPath, "utf8")) as Config;
const runId = String(config.runId || `ncc-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`);
if (!/^[a-zA-Z0-9._-]{1,80}$/.test(runId)) throw Error("runId 只允许字母数字与 ._-");
const source = config.source ?? "workspace";
if (source !== "workspace" && source !== "writer") throw Error("source 只允许 workspace 或 writer");
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const live = async (stage: string, summary: Record<string, unknown> = {}) =>
  writeFile(join(dir, "live.json"), JSON.stringify({ at: new Date().toISOString(), runId, stage, summary }));

// ── 证据：probes/novel-carbon-compare/<runId>/<name>.json，只增不覆盖 ──
const bucket = getGcsBucketName();
const gcsPrefix = `probes/novel-carbon-compare/${runId}`;
const put = async (name: string, value: unknown, contentType = "application/json; charset=utf-8") => {
  const buffer = Buffer.from(typeof value === "string" ? value : JSON.stringify(value));
  const saved = await uploadBufferToGcsIfAbsent({ bucket, objectName: `${gcsPrefix}/${name}`, buffer, contentType });
  if (!saved.created) throw Error(`证据已存在，拒绝覆盖：${name}`);
  return { objectName: `${gcsPrefix}/${name}`, bytes: buffer.length, sha256: sha(buffer.toString("utf8")) };
};
const readGcsJson = async (objectName: string) =>
  JSON.parse((await downloadGcsObjectVersioned({ gcsUri: `gs://${bucket}/${objectName}` })).buffer.toString("utf8"));

await live("preparing");
const db = await getDb();
if (!db) throw Error("数据库不可用");
if (!config.ownerUserId && !config.ownerEmail) throw Error("必须给 ownerUserId 或 ownerEmail");
const [owner] = config.ownerUserId
  ? await db.select().from(users).where(eq(users.id, Number(config.ownerUserId))).limit(1)
  : await db.select().from(users).where(sql`lower(${users.email}) = ${String(config.ownerEmail).trim().toLowerCase()}`).limit(1);
if (!owner) throw Error("账号不存在");
if (!resolveSiteOwnerOnlyAllowed(owner)) throw Error("只允许站点拥有者账号");
const ownerId = Number(owner.id);

// ── 取原输入与原有产出 ──
type Case = {
  kind: "workspace" | "writer";
  identity: Record<string, unknown>;
  prompt: string;
  json: boolean;
  stageId: string;
  baseline: "auto" | "glm" | "deepseek";
  original: { text: string; model?: string };
  validate: (text: string) => { ok: boolean; reasonZh?: string; parsed?: unknown };
  catalogNote?: Record<string, unknown>;
};
let job: typeof jobs.$inferSelect | undefined;
let theCase: Case;
if (source === "workspace") {
  const filters = [eq(jobs.userId, String(ownerId)), eq(jobs.status, "succeeded"), sql`${jobs.input}::jsonb->>'action' = 'novel_workspace_test'`];
  if (config.requestId) filters.push(eq(jobs.id, `novel_test_${sha(`${ownerId}:${config.requestId}`).slice(0, 40)}`));
  if (config.stage) filters.push(sql`${jobs.input}::jsonb->'request'->>'stage' = ${config.stage}`);
  [job] = await db.select().from(jobs).where(and(...filters)).orderBy(desc(jobs.createdAt)).limit(1);
  if (!job) throw Error("找不到该账号的已成功小说改编产出");
  const input = (job.input as { request: NovelTestInput }).request;
  const output = job.output as { result?: { text?: string; model?: string }; templateCatalogSha256?: string; selectedTemplates?: Array<{ publicId: string; cardSha256: string }> };
  if (!output?.result?.text) throw Error("原产出缺少结果正文");
  const prepared = await prepareNovelTestTemplates(input);
  const prompt = buildNovelTestPrompt(input, prepared.templates, prepared.catalogSnapshot.catalog);
  const catalogIds = prepared.catalogSnapshot.catalog.map((c: { publicId: string }) => c.publicId);
  theCase = {
    kind: "workspace",
    identity: { jobId: job.id, requestId: input.requestId, stage: input.stage, createdAt: job.createdAt },
    prompt, json: true, stageId: input.requestId,
    baseline: config.baselinePreference ?? "auto",
    original: { text: output.result.text, model: output.result.model },
    validate: (text) => {
      try {
        const value = validateNovelStageOutput(input, parseNovelModelJson(text).value, catalogIds);
        return { ok: true, parsed: value };
      } catch (error) { return { ok: false, reasonZh: String((error as Error)?.message || error).slice(0, 300) }; }
    },
    catalogNote: {
      catalogChanged: Boolean(output.templateCatalogSha256 && output.templateCatalogSha256 !== prepared.catalogSnapshot.sha256),
      cardsChanged: (output.selectedTemplates ?? []).some((row) => prepared.selectedEvidence.find((now) => now.publicId === row.publicId)?.cardSha256 !== row.cardSha256),
    },
  };
} else {
  const userPrefix = `manhua-writer-evidence/user-${ownerId}/`;
  const listed = (await listGcsObjectVersions(config.requestId ? `${userPrefix}${config.requestId}/` : userPrefix))
    .filter((row) => row.name.endsWith("/input.json"));
  if (!listed.length) throw Error("找不到该账号的连载扩写 / 改编证据");
  const candidates = [] as Array<{ name: string; generation: bigint; input: any }>;
  // 指定 stageId 时逐个读 input.json 过滤；否则按创建时间（generation）取最新一份。
  for (const row of listed.sort((a, b) => (BigInt(b.generation) > BigInt(a.generation) ? 1 : -1))) {
    const input = await readGcsJson(row.name);
    if (config.stageId && input.stageId !== config.stageId) continue;
    candidates.push({ name: row.name, generation: BigInt(row.generation), input });
    break;
  }
  const picked = candidates[0];
  if (!picked) throw Error("指定的 stageId 不存在");
  const base = picked.name.slice(0, -"input.json".length);
  let original: { text?: string; model?: string } | undefined;
  try { original = await readGcsJson(`${base}parsed.json`); } catch { original = undefined; }
  if (!original?.text) throw Error("该次调用没有成功产出（parsed.json 缺失），不做对比");
  theCase = {
    kind: "writer",
    identity: { evidence: base, requestId: picked.input.requestId, stageId: picked.input.stageId, originalLine: picked.input.model, createdAt: picked.input.createdAt },
    prompt: String(picked.input.prompt), json: Boolean(picked.input.json), stageId: String(picked.input.stageId),
    baseline: config.baselinePreference ?? "glm",
    original: { text: String(original.text), model: original.model },
    validate: (text) => {
      if (!text.trim()) return { ok: false, reasonZh: "空正文" };
      if (!picked.input.json) return { ok: true };
      try { return { ok: true, parsed: JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "")) }; }
      catch (error) { return { ok: false, reasonZh: `JSON 不合法：${String((error as Error).message).slice(0, 160)}` }; }
    },
  };
}

await put("request.json", { runId, source, ownerUserId: ownerId, config: { ...config, ownerEmail: config.ownerEmail ? "[已给出]" : undefined }, identity: theCase.identity, promptSha256: sha(theCase.prompt), promptChars: theCase.prompt.length, json: theCase.json, baseline: theCase.baseline, ...(theCase.catalogNote ?? {}) });
await put("original.json", { identity: theCase.identity, ...theCase.original });
await put("prompt.json", { prompt: theCase.prompt, sha256: sha(theCase.prompt) });
await live("baseline", { promptChars: theCase.prompt.length });

// ── 同一提示词各跑一次（不扣积分）──
type Run = { line: string; ok: boolean; text?: string; model?: string; elapsedMs: number; usage?: Record<string, number>; costUsd?: number; costUsdStandard?: number; errorZh?: string; validation?: ReturnType<Case["validate"]> };
const runLine = async (pref: "auto" | "glm" | "deepseek" | "carbon"): Promise<Run> => {
  const tag = pref === "carbon" ? "carbon" : "baseline";
  const started = Date.now();
  let usage: Record<string, number> | undefined;
  let costUsd: number | undefined;
  let costUsdStandard: number | undefined;
  let rawCount = 0;
  try {
    const result = await callNovelStage(theCase.prompt, theCase.json, `${theCase.stageId}:probe-${runId}-${tag}`, {
      modelPreference: pref,
      onRaw: async (raw) => {
        rawCount += 1;
        await put(`${tag}-raw${rawCount > 1 ? `-${rawCount}` : ""}.json`, raw);
        if (pref !== "carbon") {
          try { const u = JSON.parse(raw)?.usage; if (u) usage = { inputTokens: Number(u.prompt_tokens) || 0, outputTokens: Number(u.completion_tokens) || 0, thoughtsTokens: Number(u.completion_tokens_details?.reasoning_tokens) || 0 }; } catch { /* 原样已存 */ }
        }
      },
      onRouteEvent: async (event) => { await put(`${tag}-route-${event.route.attempt}-${event.phase}.json`, event); },
      ...(pref === "carbon" ? {
        saveEvidence: async (name: string, value: unknown) => {
          if (name === "hop-used" || name === "hop-exhausted") {
            const total = (value as { totalUsage?: { inputTokens: number; outputTokens: number; thoughtsTokens: number } }).totalUsage;
            if (total) {
              usage = { inputTokens: total.inputTokens, outputTokens: total.outputTokens, thoughtsTokens: total.thoughtsTokens };
              costUsd = estimateGeminiCarbonCostUsd(total);
              costUsdStandard = estimateGeminiCarbonCostUsd(total, GEMINI_CARBON_STANDARD_PRICE_USD_PER_M);
            }
          }
          return put(`carbon/${name}.json`, value);
        },
      } : {}),
    });
    const validation = theCase.validate(result.text);
    await put(`${tag}-parsed.json`, { text: result.text, model: result.model, settings: result.settings, route: result.route, validation: { ok: validation.ok, reasonZh: validation.reasonZh }, parsed: validation.parsed });
    return { line: tag, ok: true, text: result.text, model: result.model, elapsedMs: Date.now() - started, usage, costUsd, costUsdStandard, validation };
  } catch (error) {
    const errorZh = String((error as Error)?.message || error).slice(0, 300);
    await put(`${tag}-failure.json`, { errorZh, code: (error as { code?: string })?.code, elapsedMs: Date.now() - started, usage });
    return { line: tag, ok: false, elapsedMs: Date.now() - started, usage, costUsd, costUsdStandard, errorZh };
  }
};
const baseline = await runLine(theCase.baseline);
console.log(JSON.stringify({ runId, line: "baseline", ok: baseline.ok, chars: baseline.text?.length ?? 0, elapsedMs: baseline.elapsedMs, usage: baseline.usage }));
await live("carbon", { baseline: { ok: baseline.ok, chars: baseline.text?.length ?? 0, elapsedMs: baseline.elapsedMs } });
const carbon = await runLine("carbon");
console.log(JSON.stringify({ runId, line: "carbon", ok: carbon.ok, chars: carbon.text?.length ?? 0, elapsedMs: carbon.elapsedMs, usage: carbon.usage, costUsd: carbon.costUsd }));

// ── 并排对比 Markdown（正文进 GCS 与探针目录，不进日志）──
const lineName = (run: Run | undefined, fallbackModel?: string) =>
  theCase.kind === "workspace" ? novelModelLabel(run?.model ?? fallbackModel) || "—" : (run?.model ?? fallbackModel ?? "—");
const fence = (text?: string) => (text ? `\`\`\`${theCase.json ? "json" : "markdown"}\n${text.replace(/```/g, "ˋˋˋ")}\n\`\`\`` : "（无产出）");
const row = (name: string, run: Run | undefined, original?: { text: string; model?: string }) => {
  const text = run ? run.text : original?.text;
  const validation = run ? run.validation : theCase.validate(original?.text ?? "");
  return `| ${name} | ${run ? lineName(run) : lineName(undefined, original?.model)} | ${run ? (run.ok ? "成功" : `失败：${run.errorZh}`) : "原有"} | ${text?.length ?? 0} | ${validation ? (validation.ok ? "通过" : `不过：${validation.reasonZh}`) : "—"} | ${run?.usage ? `${run.usage.inputTokens}/${run.usage.outputTokens}/${run.usage.thoughtsTokens}` : "—"} | ${run ? `${(run.elapsedMs / 1000).toFixed(1)}s` : "—"} | ${run?.costUsd !== undefined ? `$${run.costUsd}（12-01 起 $${run.costUsdStandard}）` : "—"} |`;
};
const md = [
  `# 小说改编线路对比 · ${runId}`,
  "",
  `- 来源：${source === "workspace" ? "小说改编工作台" : "画布连载扩写 / 底本改编"}；${Object.entries(theCase.identity).map(([k, v]) => `${k}=${String(v)}`).join("，")}`,
  `- 提示词：${theCase.prompt.length} 字，sha256 ${sha(theCase.prompt).slice(0, 16)}…；两条线路使用完全相同的提示词与参数（与产品同一份 callNovelStage）；未扣积分`,
  ...(theCase.catalogNote ? [`- 模板目录自原产出后${theCase.catalogNote.catalogChanged ? "**有变化**" : "未变"}；所选模板卡${theCase.catalogNote.cardsChanged ? "**有变化**" : "未变"}（有变化时原有产出不是同一提示词）`] : []),
  `- 证据：gs://${bucket}/${gcsPrefix}/（原始与解析分对象永久保存）`,
  "",
  "| 产出 | 线路 | 状态 | 字数 | 合同校验 | 用量 输入/输出/思考 | 耗时 | 估算成本 |",
  "| --- | --- | --- | --- | --- | --- | --- | --- |",
  row("原有产出", undefined, theCase.original),
  row(`缺省线路（${theCase.kind === "workspace" ? theCase.baseline : manhuaWriterModelLabel(theCase.baseline === "deepseek" ? "deepseek" : "glm")}）`, baseline),
  row("线路三", carbon),
  "",
  "## 原有产出",
  fence(theCase.original.text),
  "",
  "## 缺省线路（本次重跑）",
  baseline.ok ? fence(baseline.text) : `失败：${baseline.errorZh}`,
  "",
  "## 线路三（本次重跑）",
  carbon.ok ? fence(carbon.text) : `失败：${carbon.errorZh}`,
  "",
].join("\n");
const compare = await put("compare.md", md, "text/markdown; charset=utf-8");
await writeFile(join(dir, "compare.md"), md);
const summary = {
  runId, source, gcs: `gs://${bucket}/${gcsPrefix}/`, compare: compare.objectName,
  original: { chars: theCase.original.text.length },
  baseline: { ok: baseline.ok, chars: baseline.text?.length ?? 0, valid: baseline.validation?.ok ?? false, elapsedMs: baseline.elapsedMs, usage: baseline.usage },
  carbon: { ok: carbon.ok, chars: carbon.text?.length ?? 0, valid: carbon.validation?.ok ?? false, elapsedMs: carbon.elapsedMs, usage: carbon.usage, costUsd: carbon.costUsd, costUsdStandard: carbon.costUsdStandard },
  ...(theCase.catalogNote ?? {}),
};
await put("summary.json", summary);
await live("diagnosed", summary);
console.log(JSON.stringify(summary));
