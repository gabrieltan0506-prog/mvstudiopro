/**
 * 隔离探针（PR #1752 共用图库素材检索）——在工作机上用 PR 镜像执行：
 *   pnpm exec tsx server/scripts/probeStockFootage.ts
 *
 * 只验代码链路，不调用真实 Pexels：上游元数据与下载两环以本地合成数据替换，
 * 其余全部走真实依赖（生产数据库 jobs 回执、GCS 写入、归属核对、MV 媒体核对）。
 * 探针身份独立（PROBE_USER_ID，默认 999999001，非真实用户）；产物路径 stock-footage/<探针用户>/。
 * 完整结果 JSON 永久保存到 GCS probes/stock-footage/<runId>.json，并打印到标准输出。
 * 不读取、不打印任何密钥；只报告 PEXELS_API_KEY 是否存在。
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

type Step = { step: string; ok: boolean; detail: unknown };
const steps: Step[] = [];
const record = (step: string, ok: boolean, detail: unknown) => {
  steps.push({ step, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${step} ${JSON.stringify(detail)}`);
};
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

  const passed = steps.filter(s => s.ok).length;
  const report = { runId, image: process.env.FLY_IMAGE_REF ?? null, machine: process.env.FLY_MACHINE_ID ?? null, userId, requestId, assetId, passed, total: steps.length, steps, at: new Date().toISOString() };
  try {
    const { gcsUri } = await uploadBufferToGcs({ objectName: `probes/stock-footage/${runId}.json`, buffer: Buffer.from(JSON.stringify(report, null, 2)), contentType: "application/json" });
    console.log(`REPORT ${gcsUri}`);
  } catch (error) {
    console.log(`REPORT_SAVE_FAILED ${(error as Error).message}`);
  }
  console.log(`RESULT passed=${passed} total=${steps.length}`);
  process.exit(passed === steps.length ? 0 : 1);
}

main().catch(error => {
  console.log(`PROBE_ERROR ${(error as Error).stack ?? error}`);
  process.exit(2);
});
