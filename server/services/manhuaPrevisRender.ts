/** 白模确定性渲染：受控 JSON → 固定脚本 → 实际帧 → MP4 → 本人持久产物。 */
import { spawn } from "node:child_process";
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
  manhuaPrevisRequestSchema,
  type ManhuaPrevisRequest,
} from "../../shared/manhuaPrevis";
import { uploadBufferToGcs } from "./gcs";

/** 超时杀整个 xvfb/Blender 进程组，不只杀 shell 留下后台渲染。 */
export function runPrevisProcess(
  command: string,
  args: string[],
  signal: AbortSignal
): Promise<string> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        PATH: process.env.PATH,
        LANG: "C.UTF-8",
        LIBGL_ALWAYS_SOFTWARE: "1",
        OMP_NUM_THREADS: "2",
      },
    });
    let output = "";
    let outputBytes = 0;
    let failure: Error | undefined;
    const stop = () => {
      try {
        if (process.platform !== "win32" && child.pid)
          process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        /* 进程已经结束。 */
      }
    };
    const abort = () => {
      failure ??= new DOMException("白模渲染已停止", "AbortError");
      stop();
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    const receive = (chunk: Buffer, capture: boolean) => {
      if (failure) return;
      outputBytes += chunk.length;
      if (outputBytes > 4 * 1024 * 1024) {
        failure = new Error("白模渲染日志超过上限");
        stop();
      } else if (capture) output += chunk.toString();
    };
    child.stdout.on("data", chunk => receive(chunk, true));
    // 不把内部路径与依赖错误直接返给普通用户。
    child.stderr.on("data", chunk => receive(chunk, false));
    child.on("error", () => {
      failure ??= new Error("白模渲染程序暂不可用");
      stop();
    });
    child.on("close", code => {
      signal.removeEventListener("abort", abort);
      if (failure) reject(failure);
      else if (code !== 0)
        reject(new Error("白模渲染未完成，请检查动作与镜头配置"));
      else resolve(output);
    });
  });
}

export type PrevisRenderReport = {
  frames: number;
  fps: number;
  actors: Array<{
    id: string;
    nameZh: string;
    bones: number;
    contactError: number;
    stanceDrift: number;
    offscreenFrames: number[];
  }>;
  warnings: string[];
  /** 竖屏构图决策留证：tight=已收紧、auto=挤不下回退、landscape=横屏不进这段 */
  portraitFraming?: "tight" | "auto" | "landscape";
};
export type PrevisRenderDeps = {
  upload: typeof uploadBufferToGcs;
  run: typeof runPrevisProcess;
  blender: string;
  useXvfb: boolean;
};
const deps: PrevisRenderDeps = {
  upload: uploadBufferToGcs,
  run: runPrevisProcess,
  blender: process.env.BLENDER_BIN || "blender",
  useXvfb: process.platform === "linux",
};
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const reportSchema = z
  .object({
    frames: z.number().int().min(48).max(720),
    fps: z.literal(24),
    actors: z
      .array(
        z
          .object({
            id: z.string().min(1),
            nameZh: z.string().min(1),
            bones: z.number().int().min(12),
            contactError: z.number().finite().nonnegative().max(0.005),
            stanceDrift: z.number().finite().nonnegative().max(0.005),
            offscreenFrames: z.array(z.number().int().min(1).max(720)).max(720),
          })
          .passthrough()
      )
      .min(1)
      .max(6),
    warnings: z.array(z.string()),
  })
  .passthrough();

/** 固定脚本退出后才读取产物，先查大小，避免损坏产物一次性耗尽 worker 内存。 */
async function readBoundedArtifact(
  file: string,
  min: number,
  max: number,
  message: string
) {
  const info = await stat(file);
  if (!info.isFile() || info.size < min || info.size > max)
    throw new Error(message);
  const bytes = await readFile(file);
  if (bytes.length !== info.size) throw new Error(message);
  return bytes;
}

export async function renderManhuaPrevis(
  raw: ManhuaPrevisRequest,
  userId: string,
  options: { signal: AbortSignal },
  d: PrevisRenderDeps = deps
) {
  if (!/^[1-9]\d*$/.test(userId)) throw new Error("白模任务身份无效");
  const input = manhuaPrevisRequestSchema.parse(raw);
  const specBytes = Buffer.from(JSON.stringify(input.spec));
  const prefix = `post-prod/${userId}/previs/${input.requestId}`;
  // 原始请求已在 jobs 内；对象证据先落盘再执行，不能让清理吞掉配置来源。
  const requestBytes = Buffer.from(JSON.stringify(input));
  const requestObject = await d.upload({
    objectName: `${prefix}/request.json`,
    buffer: requestBytes,
    contentType: "application/json",
    signal: options.signal,
  });
  const dir = await mkdtemp(path.join(tmpdir(), "manhua-previs-"));
  const specPath = path.join(dir, "spec.json");
  await writeFile(specPath, specBytes);
  let reportArchived = false;
  try {
    const args = [
      "--background",
      "--factory-startup",
      "--disable-autoexec",
      "--threads",
      "2",
      "--python-exit-code",
      "1",
      "--python",
      path.resolve("server/scripts/render-manhua-previs.py"),
      "--",
      specPath,
      dir,
    ];
    let reportBytes: Buffer | undefined;
    let reportObject: Awaited<ReturnType<typeof uploadBufferToGcs>> | undefined;
    try {
      await d.run(
        d.useXvfb ? "xvfb-run" : d.blender,
        d.useXvfb ? ["-a", d.blender, ...args] : args,
        options.signal
      );
    } finally {
      // 报告在渲染前产生。失败或超时也先永久保存原字节，再做解析和门禁。
      // 不复用已经中止的媒体信号；保全独立限时，不重跑渲染。
      try {
        reportBytes = await readBoundedArtifact(
          path.join(dir, "report.json"),
          0,
          4 * 1024 * 1024,
          "白模报告体积异常，原文件保留待检查"
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      if (reportBytes) {
        const evidenceSignal = AbortSignal.timeout(30_000);
        reportObject = await d.upload({
          objectName: `${prefix}/report.json`,
          buffer: reportBytes,
          contentType: "application/json",
          signal: evidenceSignal,
        });
        const manifest = Buffer.from(
          JSON.stringify({
            request: {
              gcsUri: requestObject.gcsUri,
              bytes: requestBytes.length,
              sha256: sha(requestBytes),
            },
            report: {
              gcsUri: reportObject.gcsUri,
              bytes: reportBytes.length,
              sha256: sha(reportBytes),
            },
            requestId: input.requestId,
            clipId: input.clipId,
          })
        );
        await d.upload({
          objectName: `${prefix}/evidence.json`,
          buffer: manifest,
          contentType: "application/json",
          signal: evidenceSignal,
        });
        reportArchived = true;
      }
    }
    if (!reportBytes || !reportObject) throw new Error("白模检查报告缺失");
    const parsedReport: unknown = JSON.parse(reportBytes.toString());
    const parsedReportBytes = Buffer.from(JSON.stringify(parsedReport));
    const parsedReportObject = await d.upload({
      objectName: `${prefix}/report.parsed.json`,
      buffer: parsedReportBytes,
      contentType: "application/json",
      signal: AbortSignal.timeout(30_000),
    });
    await d.upload({
      objectName: `${prefix}/report.parsed-evidence.json`,
      buffer: Buffer.from(
        JSON.stringify({
          requestId: input.requestId,
          clipId: input.clipId,
          parsedReport: {
            gcsUri: parsedReportObject.gcsUri,
            bytes: parsedReportBytes.length,
            sha256: sha(parsedReportBytes),
          },
        })
      ),
      contentType: "application/json",
      signal: AbortSignal.timeout(30_000),
    });
    const checkedReport = reportSchema.safeParse(parsedReport);
    if (!checkedReport.success) throw new Error("白模检查报告格式不正确");
    const report = checkedReport.data as PrevisRenderReport;
    if (
      report.frames !== input.spec.durationSec * 24 ||
      report.fps !== 24 ||
      report.actors.length !== input.spec.actors.length
    )
      throw new Error("白模帧数或角色数量不一致");
    for (let index = 0; index < report.actors.length; index++) {
      const actor = report.actors[index];
      if (
        actor.id !== input.spec.actors[index].id ||
        actor.nameZh !== input.spec.actors[index].nameZh ||
        actor.offscreenFrames.some(frame => frame > report.frames) ||
        actor.bones < 12 ||
        !Number.isFinite(actor.contactError) ||
        !Number.isFinite(actor.stanceDrift) ||
        actor.contactError > 0.005 ||
        actor.stanceDrift > 0.005
      )
        throw new Error("白模关节检查未通过");
    }
    const blend = await readBoundedArtifact(
      path.join(dir, "scene.blend"),
      1000,
      64 * 1024 * 1024,
      "白模场景体积不正确"
    );
    const sceneObject = await d.upload({
      objectName: `${prefix}/scene.blend`,
      buffer: blend,
      contentType: "application/octet-stream",
      signal: options.signal,
    });
    // 只加载本次固定脚本生成的场景。长时渲染前，报告和场景已永久存储。
    const renderArgs = [
      "--background",
      "--disable-autoexec",
      path.join(dir, "scene.blend"),
      "--threads",
      "2",
      "--render-anim",
    ];
    await d.run(
      d.useXvfb ? "xvfb-run" : d.blender,
      d.useXvfb ? ["-a", d.blender, ...renderArgs] : renderArgs,
      options.signal
    );
    const frameNames = await readdir(path.join(dir, "frames"));
    if (frameNames.length !== report.frames) throw new Error("白模渲染帧缺失");
    for (let frame = 1; frame <= report.frames; frame++) {
      if (
        (
          await stat(
            path.join(
              dir,
              "frames",
              `frame-${String(frame).padStart(4, "0")}.png`
            )
          )
        ).size === 0
      )
        throw new Error("白模渲染存在空帧");
    }
    const mp4 = path.join(dir, "preview.mp4");
    await d.run(
      "ffmpeg",
      [
        "-v",
        "error",
        "-framerate",
        "24",
        "-i",
        path.join(dir, "frames/frame-%04d.png"),
        "-an",
        "-c:v",
        "libx264",
        "-threads",
        "2",
        "-crf",
        "22",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        mp4,
      ],
      options.signal
    );
    const probeRaw = await d.run(
      "ffprobe",
      [
        "-v",
        "error",
        "-count_frames",
        "-show_entries",
        "stream=width,height,nb_read_frames:format=duration",
        "-of",
        "json",
        mp4,
      ],
      options.signal
    );
    // 解码探针也是质量证据：先保全原始 JSON，再解析或拒收。
    const probeBytes = Buffer.from(probeRaw);
    const probeObject = await d.upload({
      objectName: `${prefix}/probe.json`,
      buffer: probeBytes,
      contentType: "application/json",
      signal: AbortSignal.timeout(30_000),
    });
    await d.upload({
      objectName: `${prefix}/probe-evidence.json`,
      buffer: Buffer.from(
        JSON.stringify({
          requestId: input.requestId,
          clipId: input.clipId,
          probe: {
            gcsUri: probeObject.gcsUri,
            bytes: probeBytes.length,
            sha256: sha(probeBytes),
          },
        })
      ),
      contentType: "application/json",
      signal: AbortSignal.timeout(30_000),
    });
    const probe = JSON.parse(probeRaw);
    const parsedProbeBytes = Buffer.from(JSON.stringify(probe));
    const parsedProbeObject = await d.upload({
      objectName: `${prefix}/probe.parsed.json`,
      buffer: parsedProbeBytes,
      contentType: "application/json",
      signal: AbortSignal.timeout(30_000),
    });
    await d.upload({
      objectName: `${prefix}/validation-evidence.json`,
      buffer: Buffer.from(
        JSON.stringify({
          requestId: input.requestId,
          clipId: input.clipId,
          report: {
            gcsUri: reportObject.gcsUri,
            bytes: reportBytes.length,
            sha256: sha(reportBytes),
            actors: report.actors.length,
          },
          parsedReport: {
            gcsUri: parsedReportObject.gcsUri,
            bytes: parsedReportBytes.length,
            sha256: sha(parsedReportBytes),
            actors: report.actors.length,
          },
          probe: {
            gcsUri: probeObject.gcsUri,
            bytes: probeBytes.length,
            sha256: sha(probeBytes),
          },
          parsedProbe: {
            gcsUri: parsedProbeObject.gcsUri,
            bytes: parsedProbeBytes.length,
            sha256: sha(parsedProbeBytes),
          },
        })
      ),
      contentType: "application/json",
      signal: AbortSignal.timeout(30_000),
    });
    const stream = probe?.streams?.[0];
    const [width, height] =
      input.spec.aspect === "16:9" ? [960, 540] : [540, 960];
    if (
      probe?.streams?.length !== 1 ||
      stream?.width !== width ||
      stream?.height !== height ||
      !Number.isFinite(Number(probe?.format?.duration)) ||
      Number(stream?.nb_read_frames) !== report.frames ||
      Math.abs(Number(probe?.format?.duration) - input.spec.durationSec) > 0.05
    )
      throw new Error("白模视频解码校验未通过");
    const video = await readBoundedArtifact(
      mp4,
      1000,
      64 * 1024 * 1024,
      "白模产物体积不正确"
    );
    const videoObject = await d.upload({
      objectName: `${prefix}/preview.mp4`,
      buffer: video,
      contentType: "video/mp4",
      signal: options.signal,
    });
    const result = {
      userId,
      scopeId: input.scopeId,
      gcsUri: videoObject.gcsUri,
      durationSec: input.spec.durationSec,
      bytes: video.length,
      sha256: sha(video),
      width: stream.width,
      height: stream.height,
      sceneGcsUri: sceneObject.gcsUri,
      requestGcsUri: requestObject.gcsUri,
      reportGcsUri: reportObject.gcsUri,
      requestSha256: sha(requestBytes),
      reportSha256: sha(reportBytes),
      probeSha256: sha(probeBytes),
      sceneSha256: sha(blend),
      probeGcsUri: probeObject.gcsUri,
      report,
      clipId: input.clipId,
      requestId: input.requestId,
      spec: input.spec,
    };
    // 先把完整回执存证，再交给 worker 落库；数据库暂时失败不应丢掉已生成产物。
    const resultBytes = Buffer.from(JSON.stringify(result));
    const resultObject = await d.upload({
      objectName: `${prefix}/result.json`,
      buffer: resultBytes,
      contentType: "application/json",
      signal: AbortSignal.timeout(30_000),
    });
    await d.upload({
      objectName: `${prefix}/result-evidence.json`,
      buffer: Buffer.from(
        JSON.stringify({
          userId,
          requestId: input.requestId,
          scopeId: input.scopeId,
          clipId: input.clipId,
          result: {
            gcsUri: resultObject.gcsUri,
            bytes: resultBytes.length,
            sha256: sha(resultBytes),
          },
        })
      ),
      contentType: "application/json",
      signal: AbortSignal.timeout(30_000),
    });
    return result;
  } finally {
    // 仅清理由本次 mkdtemp 产生的媒体；JSON 永久证据不随临时媒体删除。
    await rm(path.join(dir, "frames"), { recursive: true, force: true }).catch(
      () => {}
    );
    await rm(path.join(dir, "preview.mp4"), { force: true }).catch(() => {});
    if (reportArchived)
      await rm(path.join(dir, "scene.blend"), { force: true }).catch(() => {});
  }
}
