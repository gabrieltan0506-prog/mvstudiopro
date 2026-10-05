import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  heavyMediaCallbackCommand,
  requireHeavyMediaContext,
} from "./heavyMediaContext";
import type { RenderWorkflowInput } from "../vercel-api-core/renderTypes";
import type { NativeDeepReadBatchRunEpisode } from "../services/manhuaNativeDeepReadRunner";
import type { PreparedNativeVideo } from "../services/manhuaNativeDeepReadRunner";

export type HeavyMediaRequest =
  | {
      kind: "final_render";
      input: Omit<RenderWorkflowInput, "onSubtitleTimeline">;
    }
  | { kind: "local_probe"; source: string }
  | {
      kind: "learn_command";
      command: "ffprobe" | "ffmpeg" | "yt-dlp";
      args: string[];
      timeoutMs?: number;
      maxBuffer: number;
      cookieCandidate?: number;
    }
  | {
      kind: "learn_prepare";
      episode: Omit<NativeDeepReadBatchRunEpisode, "resolveNodes">;
      nodes: Array<{ url: string; referer?: string }>;
      stagedSource?: string;
      limits?: {
        cutConcurrency?: number;
        uploadConcurrency?: number;
        preparedGroupSize?: number;
      };
    };
export type HeavyCommandResult = {
  stdout: string;
  stderr: string;
  executionError?: string;
};
export type PreparedGroup = {
  segmentIndex: number;
  video: PreparedNativeVideo;
}[];
export type HeavyMediaProgress = {
  message?: string;
  groups?: PreparedGroup[];
  nodeRequest?: number;
  acknowledgedGroups?: number;
  resolvedNodeRequest?: number;
  commandResult?: {
    sequence: number;
    result?: HeavyCommandResult;
    error?: string;
  };
};
export type HeavyMediaReply = {
  commandRequest?: {
    sequence: number;
    request: Extract<HeavyMediaRequest, { kind: "learn_command" }>;
  };
  consumedGroups?: number;
  nodeResponse?: {
    sequence: number;
    nodes: Array<{ url: string; referer?: string }>;
  };
};
export type HeavyMediaRow = {
  id: string;
  userId: string;
  status: string;
  input: unknown;
  output: unknown;
  error: string | null;
  updatedAt: Date;
};
export type HeavyMediaStore = {
  enqueue(id: string, userId: string, input: unknown): Promise<void>;
  get(id: string): Promise<HeavyMediaRow | null>;
  cancel(id: string, userId: string): Promise<void>;
  reply?(id: string, userId: string, value: HeavyMediaReply): Promise<void>;
};
export function heavyMediaJobId(
  executionId: string,
  request: HeavyMediaRequest
): string {
  return `media_${createHash("sha256").update(executionId).update("\0").update(JSON.stringify(request)).digest("hex").slice(0, 58)}`;
}
/** Persisted before waking a worker; an ambiguous INSERT is retried only with the same identity. */
export async function dispatchHeavyMedia<T>(
  request: HeavyMediaRequest,
  options: {
    signal?: AbortSignal;
    onProgress?: (
      value: HeavyMediaProgress,
      reply: (value: HeavyMediaReply) => Promise<void>
    ) => Promise<void>;
    store?: HeavyMediaStore;
    wait?: () => Promise<void>;
  } = {}
): Promise<T> {
  const owner = requireHeavyMediaContext();
  const store =
    options.store ?? (await import("./heavyMediaRepository")).heavyMediaStore;
  const id = heavyMediaJobId(`${owner.userId}/${owner.executionId}`, request);
  options.signal?.throwIfAborted();
  await store.enqueue(id, owner.userId, {
    action: "heavy_media",
    version: 1,
    request,
    parentJobId: owner.parentJobId,
  });
  let lastWarning = Date.now();
  let commandSequence = 0;
  const reply = async (value: HeavyMediaReply) => {
    if (!store.reply) throw new Error("Media reply store unavailable");
    await store.reply(id, owner.userId, value);
  };
  const callbackCommand = async (
    command: Extract<HeavyMediaRequest, { kind: "learn_command" }>
  ) => {
    if (request.kind !== "learn_prepare")
      throw new Error("Unexpected native callback");
    const sequence = ++commandSequence;
    await reply({ commandRequest: { sequence, request: command } });
    while (true) {
      options.signal?.throwIfAborted();
      const current = await store.get(id);
      if (
        !current ||
        current.userId !== owner.userId ||
        current.status !== "running"
      )
        throw new Error("Native callback task no longer running");
      const result = (current.output as { progress?: HeavyMediaProgress })
        ?.progress?.commandResult;
      if (result?.sequence === sequence) {
        if (result.error) throw new Error(result.error);
        if (!result.result) throw new Error("Native callback result missing");
        return result.result;
      }
      await (options.wait?.() ??
        delay(250, undefined, { signal: options.signal }));
    }
  };
  try {
    while (true) {
      options.signal?.throwIfAborted();
      let row;
      try {
        row = await store.get(id);
      } catch {
        // A read outage is not task failure; never refund/re-submit while the worker may still run.
        await (options.wait?.() ??
          delay(1_000, undefined, { signal: options.signal }));
        continue;
      }
      if (!row || row.userId !== owner.userId)
        throw new Error("媒体任务回执暂不可确认，请核对原任务，勿重新提交");
      const output = row.output as {
        result?: T;
        progress?: HeavyMediaProgress;
      } | null;
      if (output?.progress && options.onProgress) {
        try {
          const savedReply = (row.input as { heavyReply?: HeavyMediaReply })
            ?.heavyReply;
          commandSequence = Math.max(
            commandSequence,
            savedReply?.commandRequest?.sequence ?? 0
          );
          await heavyMediaCallbackCommand.run(callbackCommand, () =>
            options.onProgress!(
              {
                ...output.progress!,
                acknowledgedGroups: savedReply?.consumedGroups ?? 0,
                resolvedNodeRequest: savedReply?.nodeResponse?.sequence ?? 0,
              },
              reply
            )
          );
        } catch (error) {
          await store.cancel(id, owner.userId);
          throw error;
        }
      }
      if (row.status === "succeeded") {
        if (!output || !("result" in output))
          throw new Error("媒体任务缺少结果回执");
        return output.result as T;
      }
      if (row.status === "failed")
        throw new Error(row.error || "媒体处理未完成，原任务回执保留");
      if (Date.now() - lastWarning >= 5 * 60_000) {
        console.warn(
          `[heavy-media] waiting for ${id}, state=${row.status}, lastPersistedActivity=${row.updatedAt.toISOString()}`
        );
        lastWarning = Date.now();
      }
      await (options.wait?.() ??
        delay(1_000, undefined, { signal: options.signal }));
    }
  } catch (error) {
    // Request cancellation is durable; a running job remains running until its children/uploads settle.
    // DB uncertainty never re-enqueues or retries the operation.
    if (options.signal?.aborted) await store.cancel(id, owner.userId);
    throw error;
  }
}
