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
      failure = new DOMException("白模渲染已停止", "AbortError");
      stop();
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    child.stdout.on("data", chunk => {
      output += chunk.toString();
      if (Buffer.byteLength(output) > 4 * 1024 * 1024) {
        failure = new Error("白模渲染日志超过上限");
        stop();
      }
    });
    // 不把内部路径与依赖错误直接返给普通用户。
    child.stderr.on("data", () => {});
    child.on("error", error => {
      failure = error;
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
        reportBytes = await readFile(path.join(dir, "report.json"));
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
    const report = JSON.parse(reportBytes.toString()) as PrevisRenderReport;
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
        actor.bones < 12 ||
        !Number.isFinite(actor.contactError) ||
        !Number.isFinite(actor.stanceDrift) ||
        actor.contactError > 0.005 ||
        actor.stanceDrift > 0.005
      )
        throw new Error("白模关节检查未通过");
    }
    const blend = await readFile(path.join(dir, "scene.blend"));
    if (blend.length < 1000 || blend.length > 64 * 1024 * 1024)
      throw new Error("白模场景体积不正确");
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
    const probe = JSON.parse(
      await d.run(
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
      )
    );
    const stream = probe.streams?.[0];
    if (
      Number(stream?.nb_read_frames) !== report.frames ||
      Math.abs(Number(probe.format?.duration) - input.spec.durationSec) > 0.05
    )
      throw new Error("白模视频解码校验未通过");
    const video = await readFile(mp4);
    if (video.length < 1000 || video.length > 64 * 1024 * 1024)
      throw new Error("白模产物体积不正确");
    const videoObject = await d.upload({
      objectName: `${prefix}/preview.mp4`,
      buffer: video,
      contentType: "video/mp4",
      signal: options.signal,
    });
    return {
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
      report,
      clipId: input.clipId,
      requestId: input.requestId,
      spec: input.spec,
    };
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
