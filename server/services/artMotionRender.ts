import {
  persistArtMotionEvidence,
  type ArtMotionEvidenceReceipt,
} from "./artMotionEvidenceStore";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import puppeteer from "puppeteer";
import sharp from "sharp";
import { artMotionJobSchema } from "../../shared/artMotion";
import {
  fetchPostProdSourceToFile,
  runMediaTool,
  uploadResult,
} from "./postProduction";
import { boundMediaThreads, mediaRuntime } from "./postProdResources";

/** The same bundled Canvas runtime produces interactive previews and authoritative video frames. */
export async function renderArtMotion(
  raw: unknown,
  userId: string,
  signal: AbortSignal
) {
  signal.throwIfAborted();
  const parsed = artMotionJobSchema.parse(raw);
  if (parsed.params.stageAnimation) {
    const { renderManhuaStageAnimation } = await import(
      "./manhuaStageAnimationRender"
    );
    return renderManhuaStageAnimation(parsed, userId, signal);
  }
  const root = await mkdtemp(path.join(tmpdir(), "art-motion-"));
  const engine = path.resolve("client/public/art-motion/engine");
  const prefix = `post-prod/${userId.replace(/[^0-9A-Za-z_-]/g, "")}/art-motion-evidence/${randomUUID()}`;
  const evidence: Array<ArtMotionEvidenceReceipt & { name: string }> = [];
  const requestId =
    typeof raw === "object" && raw !== null && "requestId" in raw
      ? String(raw.requestId)
      : "";
  let evidenceFailure = false;
  const preserve = async (name: string, bytes: Buffer) => {
    try {
      try {
        await writeFile(path.join(root, name), bytes);
      } catch {
        evidenceFailure = true;
      }
      const saved = await persistArtMotionEvidence(
        userId,
        requestId,
        `${prefix}/${name}`,
        bytes
      );
      evidence.push({ name, ...saved });
    } catch (e) {
      evidenceFailure = true;
      throw e;
    }
  };
  const frames: Array<{ frame: number; time: number; sha256: string }> = [];
  const errors: string[] = [];
  let framesArchived = false;
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
  let server: ReturnType<typeof createServer> | undefined;
  let encoder: ReturnType<typeof spawn> | undefined;
  let encoderClosed: Promise<void> | undefined;
  let encoderError: Error | undefined;
  const abort = () => {
    encoder?.kill("SIGKILL");
    void browser?.close().catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    await preserve("request.raw.json", Buffer.from(JSON.stringify(raw)));
    const input = artMotionJobSchema.parse(raw),
      spec = input.params;
    await preserve(
      "request.normalized.json",
      Buffer.from(JSON.stringify(input))
    );
    const images = new Map<string, Buffer>();
    const cues = [];
    for (const [index, cue] of Array.from(spec.cues.entries())) {
      signal.throwIfAborted();
      if (!cue.imageUri) {
        cues.push(cue);
        continue;
      }
      const p = path.join(root, `image-${index}`);
      await fetchPostProdSourceToFile(cue.imageUri, p, {
        signal,
        budget: { remainingBytes: 16 * 1024 * 1024 },
      });
      const normalized = await sharp(p, {
        limitInputPixels: 16 * 1024 * 1024,
        animated: false,
      })
        .rotate()
        .resize({
          width: 1920,
          height: 1920,
          fit: "inside",
          withoutEnlargement: true,
        })
        .png()
        .toBuffer();
      const url = `/asset-${index}.png`;
      images.set(url, normalized);
      cues.push({ ...cue, image: url });
    }
    let audio: string | undefined;
    if (spec.inkSpeech) {
      const { assertInkFreeJob } = await import("./inkFreeQuota");
      const { artMotionTaskId } = await import("./artMotionTask");
      await assertInkFreeJob(userId, artMotionTaskId(userId, input.requestId), "mp4");
      const { renderInkFreeSpeech } = await import("./inkFreeSpeech");
      audio = path.join(root, "ink-dialogue.wav");
      const receipt = await renderInkFreeSpeech(spec.inkSpeech, spec.duration, audio, signal);
      await preserve("audio-probe-1.parsed.json", Buffer.from(JSON.stringify(receipt)));
    }
    if (spec.audioUri) {
      audio = path.join(root, "audio");
      await fetchPostProdSourceToFile(spec.audioUri, audio, { signal });
    }
    if (spec.codeAudio) {
      const { renderCodeMotionAudio } = await import("./codeMotionAudio");
      const projectId = input.scopeKey.startsWith("code-motion:") ? input.scopeKey.slice("code-motion:".length) : "";
      const soundtrack = await renderCodeMotionAudio({ userId, projectId, audio: spec.codeAudio, duration: spec.duration, root, speechPath: audio, signal });
      audio = soundtrack.output;
      await preserve("code-audio.parsed.json", Buffer.from(JSON.stringify(soundtrack.receipt)));
    }
    // Serve only the pinned engine and this task's normalized images, never arbitrary local paths.
    server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url || "/", "http://localhost");
        const image = images.get(url.pathname);
        if (image) {
          res.setHeader("Content-Type", "image/png");
          res.end(image);
          return;
        }
        const rel = decodeURIComponent(url.pathname).replace(/^\//, "");
        const target = path.resolve(engine, rel);
        if (
          !target.startsWith(engine + path.sep) ||
          !/^[-\w/.]+$/.test(rel) ||
          !/[.](html|js|woff2?|json|png)$/.test(rel)
        ) {
          res.writeHead(404).end();
          return;
        }
        const mime: Record<string, string> = {
          ".html": "text/html",
          ".js": "application/javascript",
          ".json": "application/json",
          ".woff": "font/woff",
          ".woff2": "font/woff2",
          ".png": "image/png",
        };
        res.setHeader("Content-Type", mime[path.extname(target)]);
        res.end(await readFile(target));
      } catch {
        res.writeHead(404).end();
      }
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("动画渲染入口未就绪");
    const origin = `http://127.0.0.1:${address.port}`;
    browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      userDataDir: path.join(root, "browser"),
      env: { PATH: process.env.PATH, LANG: "C.UTF-8", TMPDIR: root },
      args:
        process.platform === "linux"
          ? ["--no-sandbox", "--disable-dev-shm-usage"]
          : [],
    });
    signal.throwIfAborted();
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on("request", r => {
      void (r.url().startsWith(origin + "/") ? r.continue() : r.abort()).catch(
        () => {}
      );
    });
    page.on("pageerror", e => errors.push(String(e)));
    await page.evaluateOnNewDocument(
      s => {
        (window as unknown as { __ART_SPEC: unknown }).__ART_SPEC = s;
      },
      { ...spec, cues }
    );
    await page.goto(origin + "/studio.html", {
      waitUntil: "load",
      timeout: 120000,
    });
    await page.waitForFunction("window.__productReady || window.__bootFailed", {
      timeout: 120000,
    });
    const failed = await page.evaluate("window.__bootFailed");
    if (failed) throw new Error(String(failed));
    const video = path.join(root, spec.alpha ? "render.mov" : "render.mp4");
    const args = [
      "-y",
      "-v",
      "error",
      "-f",
      "image2pipe",
      "-framerate",
      String(spec.fps),
      "-c:v",
      "png",
      "-i",
      "pipe:0",
      ...(spec.alpha
        ? [
            "-c:v",
            "prores_ks",
            "-profile:v",
            "4444",
            "-pix_fmt",
            "yuva444p10le",
            "-alpha_bits",
            "16",
          ]
        : [
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
            "18",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
          ]),
      video,
    ];
    encoder = spawn("ffmpeg", boundMediaThreads(args), {
      stdio: ["pipe", "ignore", "pipe"],
      env: { PATH: process.env.PATH, LANG: "C.UTF-8" },
    });
    const state = mediaRuntime.getStore();
    if (state) {
      state.phase = "art_motion_render";
      state.childPid = encoder.pid;
    }
    let stderr = "";
    encoder.stderr?.on("data", b => {
      stderr = (stderr + String(b)).slice(-8192);
    });
    encoderClosed = new Promise<void>((resolve, reject) => {
      encoder!.once("error", e => {
        encoderError = e;
        reject(e);
      });
      encoder!.once("close", code => {
        if (code === 0) resolve();
        else {
          encoderError = new Error(`动画编码失败 (${code}): ${stderr}`);
          reject(encoderError);
        }
      });
    });
    encoderClosed.catch(() => {});
    encoder.stdin!.on("error", e => {
      encoderError = e;
    });
    const count = Math.round(spec.duration * spec.fps);
    for (let i = 0; i < count; i++) {
      signal.throwIfAborted();
      if (encoderError) throw encoderError;
      const encoded = await page.evaluate(async time => {
        const w = window as unknown as {
          prepare(t: number): Promise<void>;
          renderFrame(t: number): void;
          __canvas: HTMLCanvasElement;
        };
        await w.prepare(time);
        w.renderFrame(time);
        return w.__canvas.toDataURL("image/png").split(",")[1];
      }, i / spec.fps);
      const frame = Buffer.from(encoded, "base64");
      frames.push({
        frame: i,
        time: i / spec.fps,
        sha256: createHash("sha256").update(frame).digest("hex"),
      });
      if (!encoder.stdin!.write(frame))
        await Promise.race([
          once(encoder.stdin!, "drain"),
          encoderClosed.then(() => {
            throw new Error("动画编码进程提前结束");
          }),
        ]);
      if (i % 30 === 0) console.info("[art-motion] frame", i, "/", count);
    }
    encoder.stdin!.end();
    await encoderClosed;
    await preserve(
      "frames.json",
      Buffer.from(
        JSON.stringify({ complete: true, frameCount: count, frames, errors })
      )
    );
    framesArchived = true;
    if (errors.length) throw new Error("动画场景执行出错，未采用产物");
    let output = video;
    if (audio) {
      output = path.join(root, spec.alpha ? "result.mov" : "result.mp4");
      await runMediaTool(
        "ffmpeg",
        [
          "-y",
          "-i",
          video,
          "-i",
          audio,
          "-filter_complex",
          `[1:a]apad,atrim=duration=${count / spec.fps}[a]`,
          "-map",
          "0:v:0",
          "-map",
          "[a]",
          "-c:v",
          "copy",
          "-c:a",
          spec.alpha ? "pcm_s16le" : "aac",
          output,
        ],
        signal
      );
    }
    const result = await runMediaTool(
      "ffprobe",
      [
        "-v",
        "error",
        "-count_frames",
        "-show_streams",
        "-show_format",
        "-of",
        "json",
        output,
      ],
      signal
    );
    await preserve("probe.raw.json", Buffer.from(result.stdout));
    const probe = JSON.parse(result.stdout);
    await preserve("probe.parsed.json", Buffer.from(JSON.stringify(probe)));
    const stream = probe.streams?.find(
      (s: { codec_type: string }) => s.codec_type === "video"
    );
    if (audio && !probe.streams?.some((s: { codec_type: string }) => s.codec_type === "audio"))
      throw new Error("成片缺少音轨，未采用无声产物");
    if (
      !stream ||
      Number(stream.nb_read_frames) !== count ||
      stream.width !== spec.width ||
      stream.height !== spec.height
    )
      throw new Error("动画产物帧数或画幅不一致");
    const uploaded = await uploadResult({
      filePath: output,
      userId,
      kind: "art-motion",
      ext: spec.alpha ? "mov" : "mp4",
      contentType: spec.alpha ? "video/quicktime" : "video/mp4",
      signal,
    });
    return {
      ...uploaded,
      durationSec: count / spec.fps,
      width: spec.width,
      height: spec.height,
      fps: spec.fps,
      frameCount: count,
      alpha: spec.alpha,
      requestId: input.requestId,
      evidence,
    };
  } finally {
    if (frames.length && !framesArchived)
      await preserve(
        "frames.partial.json",
        Buffer.from(
          JSON.stringify({
            complete: false,
            frameCount: frames.length,
            frames,
            errors,
          })
        )
      ).catch(() => {});
    signal.removeEventListener("abort", abort);
    encoder?.kill("SIGKILL");
    await encoderClosed?.catch(() => {});
    await browser?.close().catch(() => {});
    if (server) {
      server.closeAllConnections();
      await new Promise<void>(r => server!.close(() => r()));
    }
    // Failed evidence upload retains local JSON for recovery; no automatic evidence deletion.
    if (!evidenceFailure) await rm(root, { recursive: true, force: true });
  }
}
