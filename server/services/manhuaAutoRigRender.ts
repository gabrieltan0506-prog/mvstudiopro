/** 现有本人GLB→受控Blender→永久回执/候选；子进程没有云凭证。 */
import { createHash } from "node:crypto";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import {
  AUTO_RIG_BONES,
  autoRigInspectionSchema,
  autoRigRequestSchema,
  type AutoRigRequest,
} from "../../shared/manhuaAutoRig";
import { getCompletedManhua3dSource } from "./manhua3dTask";
import {
  getGcsBucketName,
  inspectGcsObjectBounded,
  uploadBufferToGcsIfAbsent,
} from "./gcs";
import {
  blenderLaunchCommand,
  blenderLowPriorityDefault,
  runPrevisProcess,
} from "./manhuaPrevisRender";
export { blenderLaunchCommand };

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const evidenceSchema = z
  .object({
    gcsUri: z.string(),
    sha256: digest,
    bytes: z
      .number()
      .int()
      .positive()
      .max(64 * 1024 * 1024),
  })
  .strict();
export const autoRigResultSchema = z
  .object({
    version: z.literal(1),
    stage: z.enum(["inspect", "bind"]),
    requestId: z.string().uuid(),
    sourceJobId: z.string(),
    assetRef: z.string(),
    sourceSha256: digest,
    sourceDigest: digest,
    gcsUri: z.string(),
    sha256: digest,
    bytes: z
      .number()
      .int()
      .min(20)
      .max(64 * 1024 * 1024),
    requestSha256: digest,
    qualityAccepted: z.literal(false),
    reportGcsUri: z.string(),
    inspection: autoRigInspectionSchema.optional(),
    previews: z.array(evidenceSchema).min(2).max(5),
    reportSha256: digest,
    /** 0916 低模绑骨：带骨原模（可选，只有原模超限走代理时才有） */
    fullGlb: z
      .object({ gcsUri: z.string(), sha256: digest, bytes: z.number().int().min(20).max(256 * 1024 * 1024) })
      .optional(),
    weightTransfer: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.stage === "inspect" &&
      (!value.inspection || value.previews.length !== 2)
    )
      ctx.addIssue({ code: "custom", message: "检查回执不完整" });
    if (
      value.stage === "bind" &&
      (value.inspection || value.previews.length !== 5)
    )
      ctx.addIssue({ code: "custom", message: "变形检查回执不完整" });
  });
export type AutoRigResult = z.infer<typeof autoRigResultSchema>;
const limbNames = [
  "forearm-1",
  "forearm1",
  "lower_leg-1",
  "lower_leg1",
] as const;
/** 正式求解与云回执恢复共用质量数值契约，不以四个任意键冒充四肢检查。 */
export function validateAutoRigBindReport(
  raw: unknown,
  sourceDigest: string,
  outputSha256?: string
) {
  const report = z
    .object({
      status: z.literal("candidate_validated"),
      productionReady: z.literal(false),
      qualityAccepted: z.literal(false),
      sourceDigest: digest,
      outputSha256: digest,
      // 0916 低模绑骨：model.glb 是权重转移后的中模（≤24 万顶点），代理仍 ≤5 万
      vertices: z.number().int().min(100).max(250_000),
      maxWeightInfluences: z.literal(4),
      influencedVertices: z.record(z.string(), z.number().int().positive()),
      reimportBendMaxDeltaMeters: z.record(
        z.string(),
        z.number().finite().min(0.01)
      ),
      bendMaxDeltaMeters: z.record(z.string(), z.number().finite().min(0.01)),
      truncationBendMaxDeltaMeters: z.record(
        z.string(),
        z.number().finite().nonnegative()
      ),
      stage4Reimport: z.object({
        sha256: digest,
        mappedBones: z.literal(16),
        meshVertices: z.number().int().positive(),
        weightedVertices: z.number().int().positive(),
      }),
      weightTransfer: z
        .object({
          enabled: z.boolean(),
          originalVertices: z.number().int().positive(),
          proxyVertices: z.number().int().positive(),
          proxySha256: digest,
          fullSha256: digest,
          fullVertices: z.number().int().positive(),
          midVertices: z.number().int().positive(),
          filledVertices: z.number().int().nonnegative(),
          originalBendMaxDeltaMeters: z.record(z.string(), z.number().finite().min(0.01)),
        })
        .passthrough()
        .optional(),
    })
    .passthrough()
    .parse(raw);
  const exact = (actual: Record<string, unknown>, keys: readonly string[]) =>
    Object.keys(actual).length === keys.length &&
    keys.every(key => Object.hasOwn(actual, key));
  if (
    report.sourceDigest !== sourceDigest ||
    (outputSha256 && report.outputSha256 !== outputSha256) ||
    report.stage4Reimport.sha256 !== report.outputSha256 ||
    report.stage4Reimport.meshVertices !==
      report.stage4Reimport.weightedVertices ||
    !exact(report.influencedVertices, Object.keys(AUTO_RIG_BONES)) ||
    !exact(report.reimportBendMaxDeltaMeters, limbNames) ||
    !exact(report.bendMaxDeltaMeters, limbNames) ||
    !exact(report.truncationBendMaxDeltaMeters, limbNames)
  )
    throw Error("绑骨回执未通过完整变形检查");
  return report;
}

export const autoRigSha = (value: Buffer | string) =>
  createHash("sha256").update(value).digest("hex");
export const autoRigPrefix = (userId: string, requestId: string) =>
  `post-prod/${userId}/auto-rig/${requestId}`;
export type AutoRigRenderDeps = {
  source: typeof getCompletedManhua3dSource;
  inspect: typeof inspectGcsObjectBounded;
  upload: typeof uploadBufferToGcsIfAbsent;
  bucket: () => string;
  run: typeof runPrevisProcess;
  blender: string;
  useXvfb: boolean;
  /**
   * 0917 线上实跑：绑定阶段 Blender `--threads 2` 把 2 vCPU 占满，同一台机器上的 web 进程被饿死——
   * Fly 健康检查失败 15 秒、静帧 mutation `Failed to fetch`。生产（linux）一律用 nice -n 10 起 Blender，
   * 让 web 请求先走；本机/测试默认不包。
   */
  lowPriority?: boolean;
};
export const autoRigStorage = {
  source: getCompletedManhua3dSource,
  inspect: inspectGcsObjectBounded,
  upload: uploadBufferToGcsIfAbsent,
  bucket: getGcsBucketName,
};
const defaults: AutoRigRenderDeps = {
  ...autoRigStorage,
  run: runPrevisProcess,
  blender: process.env.BLENDER_BIN || "blender",
  useXvfb: process.platform === "linux",
  lowPriority: blenderLowPriorityDefault(),
};


export async function readRigCloud(
  gcsUri: string,
  maxBytes: number,
  d: Pick<AutoRigRenderDeps, "inspect">,
  signal?: AbortSignal
) {
  const chunks: Buffer[] = [];
  const receipt = await d.inspect({
    gcsUri,
    maxBytes,
    signal,
    timeoutMs: 30_000,
    onChunk: chunk => chunks.push(Buffer.from(chunk)),
  });
  const bytes = Buffer.concat(chunks);
  if (
    bytes.length !== receipt.byteLength ||
    autoRigSha(bytes) !== receipt.sha256
  )
    throw Error("绑骨对象字节与回执不一致");
  return bytes;
}
async function put(
  objectName: string,
  buffer: Buffer,
  contentType: string,
  d: AutoRigRenderDeps,
  signal: AbortSignal
) {
  signal.throwIfAborted();
  const gcsUri = `gs://${d.bucket()}/${objectName}`;
  const uploaded = await d.upload({ objectName, buffer, contentType, signal });
  if (!uploaded.created) {
    const previous = await d.inspect({
      gcsUri,
      maxBytes: buffer.length,
      signal,
      timeoutMs: 30_000,
    });
    if (
      previous.byteLength !== buffer.length ||
      previous.sha256 !== autoRigSha(buffer)
    )
      throw Error("同一绑骨请求存在不同产物，禁止覆盖");
  }
  return { gcsUri, sha256: autoRigSha(buffer), bytes: buffer.length };
}
async function localBytes(file: string, max = 64 * 1024 * 1024) {
  const info = await stat(file);
  if (!info.isFile() || info.size <= 0 || info.size > max)
    throw Error("绑骨产物为空或超过安全范围，保留原证据");
  const bytes = await readFile(file);
  if (bytes.length !== info.size) throw Error("绑骨产物读取时发生变化");
  return bytes;
}
async function jsonFiles(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory())
      result.push(...(await jsonFiles(path.join(directory, entry.name))));
    else if (entry.isFile() && entry.name.endsWith(".json"))
      result.push(path.join(directory, entry.name));
  }
  return result;
}

export async function renderManhuaAutoRig(
  raw: AutoRigRequest,
  userId: string,
  options: { signal: AbortSignal },
  d: AutoRigRenderDeps = defaults
): Promise<AutoRigResult> {
  if (!/^[1-9]\d*$/.test(userId) || !Number.isSafeInteger(Number(userId)))
    throw Error("绑骨任务身份无效");
  const request = autoRigRequestSchema.parse(raw),
    signal = options.signal;
  const source = await d.source(
    request.sourceJobId,
    Number(userId),
    request.assetRef
  );
  if (
    source.taskId !== request.sourceJobId ||
    source.assetRef !== request.assetRef ||
    source.bytes > 64 * 1024 * 1024 ||
    source.bytes < 20 ||
    !digest.safeParse(source.sha256).success
  )
    throw Error("本人来源不满足绑骨范围");
  const prefix = autoRigPrefix(userId, request.requestId),
    requestBytes = Buffer.from(JSON.stringify(request));
  await put(
    `${prefix}/request.json`,
    requestBytes,
    "application/json",
    d,
    signal
  );
  const directory = await mkdtemp(path.join(tmpdir(), "manhua-auto-rig-"));
  const out = path.join(directory, "output");
  let archived = false;
  try {
    const bytes = await readRigCloud(
      source.gcsUri,
      64 * 1024 * 1024,
      d,
      signal
    );
    if (bytes.length !== source.bytes || autoRigSha(bytes) !== source.sha256)
      throw Error("本人模型与已登记版本不一致");
    const sourcePath = path.join(directory, "source.glb"),
      inputPath = path.join(directory, "input.json");
    await writeFile(sourcePath, bytes, { flag: "wx", signal });
    await writeFile(
      inputPath,
      JSON.stringify({ request, sourceSha256: source.sha256 }),
      { flag: "wx", signal }
    );
    const args = [
      "--background",
      "--factory-startup",
      "--disable-autoexec",
      "--threads",
      "2",
      "--python-exit-code",
      "1",
      "--python",
      path.resolve("server/scripts/run_manhua_auto_rig.py"),
      "--",
      inputPath,
      sourcePath,
      out,
    ];
    let runError: unknown;
    try {
      const launch = blenderLaunchCommand(d, args);
      const stdout = await d.run(launch.command, launch.args, signal);
      await writeFile(
        path.join(directory, "process.json"),
        JSON.stringify({ stdout }),
        { flag: "wx" }
      );
    } catch (error) {
      runError = error;
      await writeFile(
        path.join(directory, "process.json"),
        JSON.stringify({
          status: "failed",
          message: error instanceof Error ? error.message : String(error),
        }),
        { flag: "wx" }
      );
    } finally {
      // 中止后仍用独立限时保全所有JSON。未归档成功时整目录保留，不清理证据。
      const archiveSignal = AbortSignal.timeout(60_000);
      for (const file of await jsonFiles(directory)) {
        const relative = path
          .relative(directory, file)
          .split(path.sep)
          .join("/");
        await put(
          `${prefix}/raw/${relative}`,
          await localBytes(file),
          "application/json",
          d,
          archiveSignal
        );
      }
      archived = true;
    }
    if (runError) {
      let message =
        "模型检查或绑骨失败，原模型保留；请查看本次失败说明，不要重复提交同一任务";
      try {
        const failure = JSON.parse(
          (
            await localBytes(path.join(out, "failure.json"), 32 * 1024)
          ).toString()
        );
        if (
          failure.type === "ValueError" &&
          typeof failure.message === "string" &&
          /^[\u4e00-\u9fff]/.test(failure.message) &&
          !/[\\/]/.test(failure.message)
        )
          message = failure.message.slice(0, 300);
      } catch {
        /* 无完整失败回执时返回安全的通用错误。 */
      }
      throw Error(message);
    }
    signal.throwIfAborted();
    const reportBytes = await localBytes(
      path.join(out, "report.json"),
      4 * 1024 * 1024
    );
    const report = JSON.parse(reportBytes.toString());
    const inspection =
      request.stage === "inspect"
        ? autoRigInspectionSchema.parse(report)
        : undefined;
    if (
      inspection &&
      (inspection.sourceSha256 !== source.sha256 ||
        JSON.stringify(inspection.settings) !==
          JSON.stringify(request.settings))
    )
      throw Error("模型检查回执来源不一致");
    if (request.stage === "bind")
      validateAutoRigBindReport(report, request.sourceDigest);
    const model = await localBytes(path.join(out, "model.glb"));
    if (request.stage === "bind" && autoRigSha(model) !== report.outputSha256)
      throw Error("候选GLB与绑骨回执不一致");
    const stored = await put(
      `uploads/u${userId}/auto-rig/${request.requestId}/model.glb`,
      model,
      "model/gltf-binary",
      d,
      signal
    );
    // 0916 低模绑骨：绑定阶段若有带骨原模（model-full.glb），另存一份供三视角/画质参考
    let fullGlb: { gcsUri: string; sha256: string; bytes: number } | undefined;
    if (request.stage === "bind" && report.weightTransfer?.enabled) {
      const full = await localBytes(path.join(out, "model-full.glb"), 256 * 1024 * 1024);
      if (autoRigSha(full) !== report.weightTransfer.fullSha256)
        throw Error("带骨原模与绑骨回执不一致");
      fullGlb = await put(
        `uploads/u${userId}/auto-rig/${request.requestId}/model-full.glb`,
        full,
        "model/gltf-binary",
        d,
        signal
      );
    }
    const previews = [];
    for (
      let index = 0;
      index < (request.stage === "inspect" ? 2 : 5);
      index++
    ) {
      const image = await localBytes(
        path.join(out, `preview-${index}.png`),
        8 * 1024 * 1024
      );
      if (
        image.length < 200 ||
        image.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
      )
        throw Error("变形预览图片无效");
      previews.push(
        await put(
          `${prefix}/preview-${index}.png`,
          image,
          "image/png",
          d,
          signal
        )
      );
    }
    const output = autoRigResultSchema.parse({
      version: 1,
      stage: request.stage,
      requestId: request.requestId,
      sourceJobId: request.sourceJobId,
      assetRef: request.assetRef,
      sourceSha256: source.sha256,
      sourceDigest: inspection?.sourceDigest ?? report.sourceDigest,
      ...stored,
      requestSha256: autoRigSha(requestBytes),
      qualityAccepted: false,
      reportGcsUri: `gs://${d.bucket()}/${prefix}/raw/output/report.json`,
      reportSha256: autoRigSha(reportBytes),
      ...(inspection ? { inspection } : {}),
      previews,
      ...(fullGlb ? { fullGlb } : {}),
      ...(report.weightTransfer ? { weightTransfer: report.weightTransfer } : {}),
    });
    // 完整结果最后落盘；失败恢复只读这个已闭合回执，不再次求解。
    await put(
      `${prefix}/result.json`,
      Buffer.from(JSON.stringify(output)),
      "application/json",
      d,
      signal
    );
    return output;
  } finally {
    if (archived) await rm(directory, { recursive: true, force: true });
  }
}
