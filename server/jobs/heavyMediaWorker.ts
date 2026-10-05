import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  claimHeavyMediaJob,
  writeHeavyMediaProgress,
  finishHeavyMediaJob,
  countHeavyWorkerJobs,
} from "./heavyMediaRepository";
import { getJobByIdStrict } from "./repository";
import { heavyMediaSignal, withHeavyMediaContext } from "./heavyMediaContext";
import type {
  HeavyMediaRequest,
  HeavyMediaProgress,
  PreparedGroup,
  HeavyMediaReply,
} from "./heavyMediaQueue";
import {
  saveHeavyMediaResult,
  readHeavyMediaResult,
} from "../services/heavyMediaEvidence";
import { assertHeavyLearnCommand } from "../services/heavyLearnMedia";
import { getGcsBucketName, signGsUriV4ReadUrl } from "../services/gcs";
import { withPostProdResources } from "../services/postProdResources";

import { execHeavyMedia } from "../services/heavyMediaProcess";
const exec = execHeavyMedia;
let activeController: AbortController | undefined;
let shuttingDown = false;
export async function drainHeavyMediaOnShutdown() {
  shuttingDown = true;
  activeController?.abort(
    new Error("Worker shutting down; no automatic retry")
  );
  while (heavyWorkerState.active) await delay(100);
}
const owner = `${process.env.FLY_MACHINE_ID || "local"}/${randomUUID()}`;
export const heavyWorkerState = { active: false, ready: false };
/** Readiness precedes all claims. No upstream model call, no machine creation. */
export async function assertHeavyWorkerReady() {
  if (
    !process.env.MANHUA_HEAVY_MACHINE_ID ||
    process.env.FLY_MACHINE_ID !== process.env.MANHUA_HEAVY_MACHINE_ID
  ) {
    throw new Error(
      "Heavy worker must match its explicitly configured machine identity"
    );
  }
  if (!getGcsBucketName())
    throw new Error("Heavy worker object storage is not configured");
  await countHeavyWorkerJobs();
  for (const cmd of ["ffmpeg", "ffprobe", "yt-dlp"])
    await exec(cmd, [cmd === "yt-dlp" ? "--version" : "-version"], {
      timeout: 15_000,
    });
  heavyWorkerState.ready = true;
}
export async function executeHeavyMedia(
  request: HeavyMediaRequest,
  signal: AbortSignal,
  progress: (value: HeavyMediaProgress) => Promise<void>,
  exchange?: {
    readReply: () => Promise<HeavyMediaReply>;
    saveCommand: (sequence: number, result: unknown) => Promise<void>;
  }
): Promise<unknown> {
  signal.throwIfAborted();
  switch (request.kind) {
    case "final_render": {
      const { renderWorkflowFinalVideo } = await import(
        "../vercel-api-core/render"
      );
      let subtitleTimeline: unknown;
      const url = await renderWorkflowFinalVideo({
        ...request.input,
        onSubtitleTimeline: value => {
          subtitleTimeline = value;
        },
      });
      return { url, subtitleTimeline };
    }
    case "local_probe": {
      const { materializeHeavyMediaSource } = await import(
        "../services/heavyLearnMedia"
      );
      const { probeVideo } = await import(
        "../services/manhuaLocalVideoUploadService"
      );
      return materializeHeavyMediaSource(request.source, probeVideo);
    }
    case "learn_command": {
      assertHeavyLearnCommand(request.command, request.args);
      const args = request.args.map(value =>
        value.startsWith("gs://") ? signGsUriV4ReadUrl(value, 3600) : value
      );
      // Same timeout and arguments as the native caller; no changes to learning/model parameters.
      let cleanup: (() => Promise<void>) | undefined;
      if (request.cookieCandidate !== undefined) {
        if (request.command !== "yt-dlp")
          throw new Error("Cookie candidates are metadata-only");
        const { openYtdlpCookieSession } = await import(
          "../services/manhuaLearnYtdlpRuntime"
        );
        const cookie = await openYtdlpCookieSession(request.cookieCandidate);
        args.unshift(...cookie.args);
        cleanup = cookie.cleanup;
      }
      try {
        const { stdout, stderr } = await exec(request.command, args, {
          timeout: request.timeoutMs,
          maxBuffer: request.maxBuffer,
          signal,
        });
        return { stdout, stderr };
      } catch (error) {
        signal.throwIfAborted();
        const failure = error as {
          stdout?: unknown;
          stderr?: unknown;
          message?: string;
        };
        // Preserve the original failure output for native classification, before any parser/fallback.
        return {
          stdout: String(failure.stdout ?? ""),
          stderr: String(failure.stderr ?? ""),
          executionError: failure.message || "Media command failed",
        };
      } finally {
        await cleanup?.();
      } // raw JSON is saved before the app parses it
    }
    case "learn_prepare": {
      const { prepareEpisodeVideos, defaultMediaPreparationDeps } =
        await import("../services/manhuaNativeDeepReadRunner");
      const groups: PreparedGroup[] = [];
      let sequence = 0;
      let commandSequence = 0;
      let lastProgress: HeavyMediaProgress = {};
      const report = async (value: HeavyMediaProgress) => {
        lastProgress = { ...lastProgress, ...value };
        await progress(lastProgress);
      };
      const waitFor = async (ready: (value: HeavyMediaReply) => boolean) => {
        if (!exchange)
          throw new Error("Native preparation callback exchange missing");
        while (true) {
          signal.throwIfAborted();
          const value = await exchange.readReply();
          const command = value.commandRequest;
          if (command && command.sequence > commandSequence) {
            if (command.request.kind !== "learn_command")
              throw new Error("Invalid native callback command");
            let response: NonNullable<HeavyMediaProgress["commandResult"]>;
            try {
              const result = (await executeHeavyMedia(
                command.request,
                signal,
                async () => {}
              )) as { stdout: string; stderr: string };
              response = { sequence: command.sequence, result };
            } catch (error) {
              response = {
                sequence: command.sequence,
                error:
                  error instanceof Error
                    ? error.message
                    : "Media metadata unavailable",
              };
            }
            // Original JSON is permanent before the app parses or consumes it.
            await exchange.saveCommand(command.sequence, response);
            commandSequence = command.sequence;
            await report({ commandResult: response });
            continue;
          }
          if (ready(value)) return value;
          await delay(250, undefined, { signal });
        }
      };
      const limits = {
        ...request.limits,
        onSourceFetchProgress: (message: string) => report({ message, groups }),
        onPreparedGroup: async (rows: readonly PreparedGroup[number][]) => {
          groups.push([...rows]);
          await report({ groups });
          await waitFor(value => (value.consumedGroups ?? 0) >= groups.length);
        },
      };
      if (request.stagedSource) {
        const local = request.episode.localVideoUpload;
        if (!local) throw new Error("Missing local source ownership");
        const { materializeHeavyMediaSource } = await import(
          "../services/heavyLearnMedia"
        );
        const { buildManhuaLocalVideoSourceRef } = await import(
          "../../shared/manhuaLocalVideoUpload"
        );
        const { stat } = await import("node:fs/promises");
        return materializeHeavyMediaSource(request.stagedSource, async file =>
          prepareEpisodeVideos(
            {
              ...request.episode,
              resolveNodes: async () => {
                throw new Error("Local source cannot use a remote fallback");
              },
            },
            signal,
            {
              ...defaultMediaPreparationDeps,
              resolveLocalUpload: async () => ({
                sourceRef: buildManhuaLocalVideoSourceRef(local),
                sha256: local.sha256,
                localPath: file,
                bytes: (await stat(file)).size,
                durationSec: request.episode.sourceDurationSec,
              }),
            },
            limits
          )
        );
      }
      return prepareEpisodeVideos(
        {
          ...request.episode,
          resolveNodes: async () => {
            const current = ++sequence;
            await report({ groups, nodeRequest: current });
            const reply = await waitFor(
              value => value.nodeResponse?.sequence === current
            );
            return reply.nodeResponse!.nodes;
          },
        },
        signal,
        undefined,
        limits
      );
    }
    default:
      throw new Error("Unsupported heavy media operation");
  }
}
/** One claim, one execution. No crash/timeout retry, including ambiguous result persistence. */
export async function processHeavyMediaOnce(
  blocked: () => boolean
): Promise<void> {
  if (
    shuttingDown ||
    !heavyWorkerState.ready ||
    heavyWorkerState.active ||
    blocked()
  )
    return;
  heavyWorkerState.active = true; // set before asynchronous claim, so idle stop cannot pass
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let heartbeatPending: Promise<void> | undefined;
  try {
    const job = await claimHeavyMediaJob(owner);
    if (!job) return;
    const input = job.input as {
      version: number;
      request: HeavyMediaRequest;
      parentJobId?: string;
    };
    const controller = new AbortController();
    activeController = controller;
    let lastHeartbeatAt = Date.now();
    let lastWarningAt = Date.now();
    const pulse = async () => {
      const flags = await writeHeavyMediaProgress(job.id, owner);
      lastHeartbeatAt = Date.now();
      if (flags.cancelRequested)
        controller.abort(new Error("用户已停止媒体处理"));
      if (input.parentJobId) {
        const parent = await getJobByIdStrict(input.parentJobId);
        if (
          !parent ||
          parent.userId !== job.userId ||
          parent.status === "failed" ||
          (parent.input as { cancelRequestedAt?: unknown })?.cancelRequestedAt
        ) {
          controller.abort(new Error("原任务已停止，媒体子任务收尾"));
        }
      }
    };
    await pulse();
    heartbeat = setInterval(() => {
      if (Date.now() - lastWarningAt >= 10 * 60_000) {
        console.warn(
          `[heavy-media] long task ${job.id}; checking persisted heartbeat, no wall-clock kill`
        );
        lastWarningAt = Date.now();
      }
      if (Date.now() - lastHeartbeatAt >= 10 * 60_000)
        controller.abort(new Error("媒体任务连续10分钟无法保存心跳"));
      if (!heartbeatPending)
        heartbeatPending = pulse()
          .catch(() => {
            console.warn(
              `[heavy-media] heartbeat persistence unavailable for ${job.id}`
            );
          })
          .finally(() => {
            heartbeatPending = undefined;
          });
    }, 30_000);
    heartbeat.unref?.();
    let result: unknown = null;
    let failure: string | undefined;
    try {
      if (input.version !== 1)
        throw new Error("Unsupported media task contract");
      result = await withPostProdResources(
        job.id,
        controller.signal,
        { phase: "heavy_media" },
        signal =>
          withHeavyMediaContext(
            { userId: job.userId, executionId: job.id },
            () =>
              heavyMediaSignal.run(signal, () =>
                executeHeavyMedia(
                  input.request,
                  signal,
                  value =>
                    writeHeavyMediaProgress(job.id, owner, value).then(
                      () => undefined
                    ),
                  {
                    saveCommand: async (sequence, value) => {
                      const key = `callback_${createHash("sha256").update(`${job.id}/${sequence}`).digest("hex").slice(0, 55)}`;
                      await saveHeavyMediaResult(key, job.userId, value);
                    },
                    readReply: async () => {
                      const current = await getJobByIdStrict(job.id);
                      if (!current || current.status !== "running")
                        throw new Error("Media task no longer running");
                      return (
                        (current.input as { heavyReply?: HeavyMediaReply })
                          .heavyReply ?? {}
                      );
                    },
                  }
                )
              )
          )
      );
      controller.signal.throwIfAborted();
    } catch {
      failure = controller.signal.aborted
        ? "媒体处理已停止，原素材和回执保留；未自动重做"
        : "媒体处理失败，原素材和回执保留；未自动重做";
    }
    // Remain locally busy until uploads AND durable status finish; no stop on failed DB writes.
    while (true) {
      try {
        if (!failure) await saveHeavyMediaResult(job.id, job.userId, result);
        await finishHeavyMediaJob(job.id, owner, result, failure);
        break;
      } catch {
        const current = await getJobByIdStrict(job.id).catch(() => null);
        if (current && current.status !== "running") {
          // The immutable result remains available even if the reaper won the terminal CAS.
          if (!failure) await saveHeavyMediaResult(job.id, job.userId, result);
          break;
        }
        console.warn(
          `[heavy-media] ${job.id} result/status persistence pending; worker remains busy`
        );
        await delay(5_000);
      }
    }
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    await heartbeatPending;
    activeController = undefined;
    heavyWorkerState.active = false;
  }
}
export async function recoverHeavyMediaResult(id: string, userId: string) {
  return readHeavyMediaResult(id, userId);
}
