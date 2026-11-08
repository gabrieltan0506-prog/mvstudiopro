/**
 * 隔离探针（PR #1752 共用图库素材检索）——在工作机上用 PR 镜像执行：
 *   pnpm exec tsx server/scripts/probeStockFootage.ts
 *
 * 只验代码链路，不调用真实 Pexels：上游元数据与下载两环以本地合成数据替换，
 * 其余全部走真实依赖（生产数据库 jobs 回执、GCS 写入、归属核对、MV 媒体核对）。
 * 探针身份独立（PROBE_USER_ID，默认 999999001，非真实用户）；产物路径 stock-footage/<探针用户>/。
 * 完整结果 JSON 永久保存到 GCS probes/stock-footage/<runId>.json，并打印到标准输出。
 * 不读取、不打印任何密钥；只报告 PEXELS_API_KEY 是否存在。
 *
 * 第二期（素材检索 UX）扩展项：自动关键词规则版、裁点纯函数与 MV 绑定、营销后期引用。
 * 关键词服务（另一分支）用动态导入，模块不存在时记 SKIP（不计入失败）；MV 绑定未接收裁点时「入点写入」一项记 SKIP。
 * 关键词只调用规则版函数，不触发任何真实模型调用。
 */
import { randomUUID } from "node:crypto";
import {
  adoptStockFootage,
  getStockAdoption,
  realStockAdoptionDeps,
  stockFootageAssetId,
  type StockAdoptionDeps,
} from "../services/stockFootage/adoption";
import { loadOwnedStockAsset } from "../services/stockFootage/ownership";
import { searchPexels, StockFootageError } from "../services/stockFootage/pexelsClient";
import { resolveCanvasMusicMvVideo } from "../services/canvasMusicMvMedia";
import { uploadBufferToGcs } from "../services/gcs";
import { resolvePostProdInputSources, stockPostProdSource } from "../services/postProdMediaSource";
import { bindMusicMvStockFootage, MV_EDIT_FPS, type MusicMvEditDocument } from "../../shared/canvasMusicMvEdit";
import { stockDurationFrames, type StockFootageAsset } from "../../shared/stockFootage";
import { clampStockTrim, stockTrimToFrames } from "../../shared/stockFootageTrim";

type Step = { step: string; ok: boolean; skipped?: boolean; detail: unknown };
const steps: Step[] = [];
const record = (step: string, ok: boolean, detail: unknown) => {
  steps.push({ step, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${step} ${JSON.stringify(detail)}`);
};
/** 依赖的模块尚未合入：记 SKIP，不算通过也不算失败。 */
const skip = (step: string, detail: unknown) => {
  steps.push({ step, ok: false, skipped: true, detail });
  console.log(`SKIP ${step} ${JSON.stringify(detail)}`);
};
/** 可选模块：不存在返回 null；存在但加载报错照常抛出（记 FAIL）。路径用变量，避免未合入时类型检查报缺模块。 */
async function optionalImport(relativeTs: string): Promise<Record<string, unknown> | null> {
  const href = new URL(relativeTs, import.meta.url).href;
  try {
    return (await import(href)) as Record<string, unknown>;
  } catch (error) {
    const code = (error as { code?: string }).code;
    const message = String((error as Error)?.message ?? error);
    if (code === "ERR_MODULE_NOT_FOUND" || /Cannot find module/i.test(message)) {
      if (message.includes(relativeTs.split("/").pop()!.replace(/\.ts$/, ""))) return null;
    }
    throw error;
  }
}
async function expectReject(step: string, run: () => Promise<unknown>, kind?: string) {
  try {
    await run();
    record(step, false, "未被拒绝");
  } catch (error) {
    const k = error instanceof StockFootageError ? error.kind : undefined;
    record(step, kind ? k === kind : true, { kind: k, message: (error as Error).message });
  }
}

async function main() {
  const runId = `probe-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const userId = Number(process.env.PROBE_USER_ID || 999999001);
  const requestId = randomUUID();
  const providerAssetId = "900000001";
  const fakeLink = `https://videos.pexels.com/video-files/${providerAssetId}/probe-1080.mp4`;
  const fakeBytes = Buffer.from(`stock-footage-probe ${runId}`);
  const counters = { getAsset: 0, download: 0 };

  record("env.PEXELS_API_KEY 存在", true, { present: Boolean(process.env.PEXELS_API_KEY) });

  // 1. 未配置密钥时搜索应明确报「未启用」（只在确实未配置时执行，不发真实请求）
  if (!process.env.PEXELS_API_KEY) {
    await expectReject("search 未配置时返回 not_configured", () => searchPexels({ query: "probe", kind: "video", page: 1, perPage: 1, purpose: "mv" }), "not_configured");
  } else {
    record("search 未配置分支", true, "已配置密钥，按授权跳过真实调用");
  }

  // 2. 采用：真实数据库回执 + 真实 GCS，上游两环替换为合成数据
  const deps: StockAdoptionDeps = {
    ...realStockAdoptionDeps,
    getAsset: (async () => {
      counters.getAsset++;
      return {
        kind: "video",
        video: {
          id: Number(providerAssetId), width: 1920, height: 1080, duration: 12,
          url: `https://www.pexels.com/video/${providerAssetId}/`, image: "https://images.pexels.com/probe.jpg",
          user: { name: "Probe", url: "https://www.pexels.com/@probe" },
          video_files: [{ id: 1, file_type: "video/mp4", width: 1920, height: 1080, link: fakeLink }],
        },
      };
    }) as StockAdoptionDeps["getAsset"],
    download: async (url) => {
      counters.download++;
      if (url !== fakeLink) throw new Error("下载地址与上游元数据不一致");
      return { buffer: fakeBytes, contentType: "video/mp4" };
    },
  };
  const input = { requestId, providerAssetId, kind: "video" as const, purpose: "mv" as const, usage: "insert" as const, context: { projectId: runId, note: "isolated probe" } };
  const first = await adoptStockFootage(userId, input, deps);
  const assetId = stockFootageAssetId(userId, requestId);
  record("adopt 首次成功入库", first.status === "succeeded" && first.assetId === assetId, { status: first.status, assetId: first.assetId, gcsUri: first.asset?.gcsUri, bytes: first.asset?.bytes, sha256: first.asset?.sha256 });
  record("来源证据完整", Boolean(first.asset?.source.license.url && first.asset?.source.author.name && first.asset?.source.downloadedFrom === fakeLink), first.asset?.source);

  const second = await adoptStockFootage(userId, input, deps);
  record("同编号重复采用幂等（不重取上游/不重下载）", second.status === "succeeded" && counters.getAsset === 1 && counters.download === 1, { status: second.status, counters });

  await expectReject("同编号换素材 → conflict", () => adoptStockFootage(userId, { ...input, providerAssetId: "900000002" }, deps), "conflict");

  const queried = await getStockAdoption(userId, requestId);
  record("getAdoption 从数据库恢复", queried.status === "succeeded" && queried.asset?.gcsUri === first.asset?.gcsUri, { status: queried.status });

  // 3. 归属核对（真实数据库）
  const owned = await loadOwnedStockAsset(userId, assetId, { purpose: "mv", kind: "video" });
  record("loadOwnedStockAsset 本人+用途匹配", owned.gcsUri === first.asset?.gcsUri, { gcsUri: owned.gcsUri });
  await expectReject("他人账号读取被拒", () => loadOwnedStockAsset(userId + 1, assetId), "not_found");
  await expectReject("用途不符（数字人）被拒", () => loadOwnedStockAsset(userId, assetId, { purpose: "digital_human" }), "invalid");
  await expectReject("用法不符（漫剧参考）被拒", () => loadOwnedStockAsset(userId, assetId, { usages: ["reference"] }), "invalid");

  // 4. MV 媒体核对（真实桶）：gcsUri + assetId 通过；篡改地址/时长被拒
  if (owned.durationSec) {
    const resolved = await resolveCanvasMusicMvVideo(userId, { url: owned.gcsUri, taskId: assetId, durationSec: owned.durationSec });
    record("MV resolveCanvasMusicMvVideo 接受本人图库素材", typeof resolved === "string" && resolved.length > 0, { resolved });
    await expectReject("MV 篡改时长被拒", () => resolveCanvasMusicMvVideo(userId, { url: owned.gcsUri, taskId: assetId, durationSec: owned.durationSec! + 5 }));
    await expectReject("MV 他人账号被拒", () => resolveCanvasMusicMvVideo(userId + 1, { url: owned.gcsUri, taskId: assetId }));
  }

  // 5. 漫剧禁止直接入片（schema 层）
  await expectReject("漫剧 insert 在输入校验即被拒", () => adoptStockFootage(userId, { ...input, requestId: randomUUID(), purpose: "manhua", usage: "insert" }, deps));

  // ---- 第二期扩展（以上 15 项保持不变）----
  await probeKeywordRules();
  await probeMvTrimBinding(userId, owned);
  await probeMarketingPostProd(userId, input, deps, assetId);

  const counted = steps.filter(s => !s.skipped);
  const passed = counted.filter(s => s.ok).length;
  const skipped = steps.length - counted.length;
  const report = { runId, image: process.env.FLY_IMAGE_REF ?? null, machine: process.env.FLY_MACHINE_ID ?? null, userId, requestId, assetId, passed, total: counted.length, skipped, steps, at: new Date().toISOString() };
  try {
    const { gcsUri } = await uploadBufferToGcs({ objectName: `probes/stock-footage/${runId}.json`, buffer: Buffer.from(JSON.stringify(report, null, 2)), contentType: "application/json" });
    console.log(`REPORT ${gcsUri}`);
  } catch (error) {
    console.log(`REPORT_SAVE_FAILED ${(error as Error).message}`);
  }
  console.log(`RESULT passed=${passed} total=${counted.length} skipped=${skipped}`);
  process.exit(passed === counted.length ? 0 : 1);
}

/** (a) 自动关键词规则版：「城市夜景雨天」→ 英文检索词含 city / night / rain。只调规则函数，不打模型。 */
async function probeKeywordRules() {
  const step = "关键词规则版：城市夜景雨天 → city/night/rain";
  try {
    const service = await optionalImport("../services/stockFootage/keywords.ts");
    if (!service) return skip(step, "server/services/stockFootage/keywords.ts 未合入");
    const shared = await optionalImport("../../shared/stockFootageKeywords.ts");
    const candidates = [...Object.entries(service), ...Object.entries(shared ?? {})]
      .filter(([name, fn]) => typeof fn === "function" && /rule/i.test(name)) as Array<[string, (...args: unknown[]) => unknown]>;
    if (!candidates.length) return record(step, false, { error: "未找到规则版导出函数", exports: [...Object.keys(service), ...Object.keys(shared ?? {})] });
    const text = "城市夜景雨天";
    const tried: Array<{ fn: string; query?: string; error?: string }> = [];
    for (const [name, fn] of candidates) {
      // 规则版签名为 (text, purpose)；先试位置参数，避免对象参数被当作文本落到默认词。
      for (const args of [[text, "mv"], [{ text, purpose: "mv" }]] as unknown[][]) {
        try {
          const out = await fn(...args);
          const o = (out && typeof out === "object" ? out : {}) as Record<string, unknown>;
          const query = typeof out === "string" ? out : typeof o.query === "string" ? o.query : Array.isArray(out) ? out.join(" ") : Array.isArray(o.keywords) ? (o.keywords as unknown[]).join(" ") : undefined;
          if (!query) { tried.push({ fn: name, error: "无 query 输出" }); continue; }
          const lower = query.toLowerCase();
          const missing = ["city", "night", "rain"].filter(w => !lower.includes(w));
          return record(step, missing.length === 0, { fn: name, query, queryZh: o.queryZh, source: o.source, missing });
        } catch (error) {
          tried.push({ fn: name, error: (error as Error).message });
        }
      }
    }
    record(step, false, { error: "规则版调用均无有效输出", tried });
  } catch (error) {
    record(step, false, { error: (error as Error).message });
  }
}

/** (b) 裁点纯函数 + MV 绑定：非 0 入点绑定后 sourceInFrame 不越界，绑定后的片段仍通过 resolveCanvasMusicMvVideo。 */
async function probeMvTrimBinding(userId: number, owned: StockFootageAsset) {
  const sourceSec = owned.durationSec ?? 0;
  if (!sourceSec) return record("MV 非0入点绑定：探针资产时长", false, { durationSec: owned.durationSec });
  try {
    const over = clampStockTrim({ sourceSec, targetSec: 4, inSec: sourceSec - 1 });
    const okOver = over.inSec >= 0 && over.outSec <= sourceSec + 1e-9 && Math.abs(over.outSec - over.inSec - Math.min(4, sourceSec)) < 0.002 && over.shortBySec === 0;
    record("clampStockTrim 越界入点夹回素材内", okOver, { sourceSec, requestedIn: sourceSec - 1, ...over });
  } catch (error) {
    record("clampStockTrim 越界入点夹回素材内", false, { error: (error as Error).message });
  }
  try {
    const trim = clampStockTrim({ sourceSec, targetSec: 4, inSec: 5 });
    const expected = stockTrimToFrames(trim, MV_EDIT_FPS);
    const doc: MusicMvEditDocument = {
      version: 1, fps: 30, basePlanRequestId: randomUUID(), audioId: "probe-audio", audioDurationSec: 30,
      clips: [{ id: "probe-clip-1", shotId: "probe-shot-1", blockId: "probe-block-1", title: "probe", kind: "generated", sourceInFrame: 0, durationFrames: 120 }],
    };
    // 第二期绑定第4参数为帧：{ sourceInFrame, durationFrames }（由抽屉裁点经 stockTrimToFrames 换算）。
    const bound = bindMusicMvStockFootage(doc, "probe-clip-1", owned, expected);
    const clip = bound.clips[0];
    const available = stockDurationFrames(sourceSec, MV_EDIT_FPS);
    const inBounds = clip.sourceInFrame >= 0 && clip.sourceInFrame + clip.durationFrames <= available && clip.kind === "footage";
    record("MV 非0入点绑定：sourceInFrame 不越界", inBounds, { trim, expected, sourceInFrame: clip.sourceInFrame, durationFrames: clip.durationFrames, available });
    if (clip.sourceInFrame === expected.sourceInFrame) record("MV 绑定写入抽屉入点", true, { sourceInFrame: clip.sourceInFrame });
    else record("MV 绑定写入抽屉入点", false, { expected: expected.sourceInFrame, actual: clip.sourceInFrame });
    const resolved = await resolveCanvasMusicMvVideo(userId, clip.source!);
    record("MV 非0入点绑定后 resolveCanvasMusicMvVideo 通过", resolved === owned.gcsUri, { resolved });
  } catch (error) {
    record("MV 非0入点绑定：sourceInFrame 不越界", false, { error: (error as Error).message });
  }
}

/** (c) 营销口播：marketing 用途的图库视频经后期解析通过；mv 用途资产在同一入口被拒。 */
async function probeMarketingPostProd(userId: number, base: Parameters<typeof adoptStockFootage>[1], deps: StockAdoptionDeps, mvAssetId: string) {
  const concat = (clips: string[]) => ({ action: "concat" as const, params: { clips, trims: clips.map(() => ({ startSec: 0, endSec: 3 })) } });
  try {
    const mkRequestId = randomUUID();
    const mk = await adoptStockFootage(userId, { ...base, requestId: mkRequestId, purpose: "marketing", usage: "insert", context: { ...base.context, note: "isolated probe marketing" } }, deps);
    const mkAssetId = stockFootageAssetId(userId, mkRequestId);
    record("营销用途采用成功", mk.status === "succeeded" && mk.assetId === mkAssetId, { status: mk.status, assetId: mk.assetId, gcsUri: mk.asset?.gcsUri });
    const queued = await resolvePostProdInputSources({ userId: String(userId), input: concat([stockPostProdSource(mkAssetId)]) });
    const queuedClips = (queued.params as { clips?: string[] }).clips;
    record("营销 stock 引用入队通过（保留引用不落地址）", queuedClips?.[0] === stockPostProdSource(mkAssetId), { clips: queuedClips });
    const materialized = await resolvePostProdInputSources({ userId: String(userId), input: concat([stockPostProdSource(mkAssetId)]) }, undefined, { materializeStock: true });
    const matClips = (materialized.params as { clips?: string[] }).clips;
    record("营销 stock 引用执行前换成资产 gcsUri", matClips?.[0] === mk.asset?.gcsUri, { clips: matClips });
  } catch (error) {
    record("营销 stock 引用后期解析", false, { error: (error as Error).message });
  }
  await expectReject("mv 用途资产走营销后期入口被拒", () => resolvePostProdInputSources({ userId: String(userId), input: concat([stockPostProdSource(mvAssetId)]) }));
}

main().catch(error => {
  console.log(`PROBE_ERROR ${(error as Error).stack ?? error}`);
  process.exit(2);
});
