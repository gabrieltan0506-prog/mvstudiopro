import {
  inkFreeSpeechEnabled,
  INK_FREE_SPEECH_UNAVAILABLE,
} from "./inkFreeSpeechConfig";
import { spawn } from "node:child_process";
import path from "node:path";
import { inkSpeechSchema, type InkSpeech } from "../../shared/inkSpeech";

/** 使用同一worker的取消信号，无单独固定总时长覆盖心跳；失败不切换付费TTS。 */
export async function renderInkFreeSpeech(
  speech: InkSpeech,
  duration: number,
  output: string,
  signal: AbortSignal
) {
  if (!inkFreeSpeechEnabled()) throw new Error(INK_FREE_SPEECH_UNAVAILABLE);
  const checked = inkSpeechSchema.parse(speech);
  if (
    !Number.isFinite(duration) ||
    duration < 1 ||
    duration > 60 ||
    checked.lines.some(line => line.at + line.duration > duration)
  )
    throw new Error("对白超出视频时间，未开始配音");
  signal.throwIfAborted();
  return new Promise<unknown>((resolve, reject) => {
    const child = spawn(
      process.env.INK_TTS_PYTHON || "python3",
      [
        path.resolve("server/scripts/ink_free_tts.py"),
        "--model-dir",
        process.env.INK_TTS_MODEL_DIR || "/opt/ink-tts-model",
        "--output",
        output,
      ],
      {
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          LANG: "C.UTF-8",
          PYTHONPATH: process.env.INK_TTS_PYTHONPATH || "/opt/ink-tts-runtime",
          OMP_NUM_THREADS: "2",
          OPENBLAS_NUM_THREADS: "2",
        },
      }
    );
    let stdout = "",
      stderr = "",
      settled = false;
    const abort = () => child.kill("SIGKILL");
    const finish = (error?: Error, value?: unknown) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      error ? reject(error) : resolve(value);
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    child.stdout.on("data", chunk => {
      stdout += chunk;
      if (stdout.length > 65536) {
        child.kill("SIGKILL");
        finish(new Error("配音回执过大"));
      }
    });
    child.stderr.on("data", chunk => {
      stderr = (stderr + chunk).slice(-4000);
    });
    child.on("error", error => finish(error));
    child.stdin.on("error", error => {
      if (!signal.aborted) finish(error);
    });
    child.on("close", code => {
      if (signal.aborted) return finish(new Error("配音已取消"));
      if (code !== 0)
        return finish(
          new Error(`免费配音未完成：${stderr.trim() || `退出码${code}`}`)
        );
      try {
        finish(undefined, JSON.parse(stdout));
      } catch {
        finish(new Error("配音回执无法读取，未生成无声替代品"));
      }
    });
    child.stdin.end(JSON.stringify({ speech: checked, duration }));
  });
}
