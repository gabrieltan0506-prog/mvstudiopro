import { afterEach, expect, it, vi } from "vitest";
import { executeHeavyMedia } from "./heavyMediaWorker";
import {
  dispatchHeavyMedia,
  type HeavyMediaProgress,
  type HeavyMediaReply,
  type HeavyMediaRequest,
} from "./heavyMediaQueue";
import { withHeavyMediaContext } from "./heavyMediaContext";
import { dispatchLearnCommand, dispatchLearnSourcePlayback } from "../services/heavyLearnMedia";
const state = vi.hoisted(() => ({ prepare: vi.fn(), exec: vi.fn(), source: vi.fn() }));
vi.mock("../services/manhuaLearn0996Source", () => ({
  fetchManhua0996EpisodePlaybackLocally: state.source,
  describeManhuaSourceFetchFailure: () => "已脱敏的来源错误",
}));
vi.mock("../services/manhuaNativeDeepReadRunner", () => ({
  prepareEpisodeVideos: state.prepare,
  defaultMediaPreparationDeps: {},
}));
vi.mock("../services/heavyMediaProcess", () => ({
  execHeavyMedia: state.exec,
}));
afterEach(() => vi.clearAllMocks());
const command: Extract<HeavyMediaRequest, { kind: "learn_command" }> = {
  kind: "learn_command",
  command: "ffprobe",
  args: ["https://fixture.invalid/source.mp4"],
  timeoutMs: 20000,
  maxBuffer: 8192,
};
const request = {
  kind: "learn_prepare",
  episode: {
    episodeIndex: 1,
    sourceDurationSec: 60,
    segments: [{ startSec: 0, endSec: 60 }],
  },
  nodes: [],
} as HeavyMediaRequest;
it("native source refresh and group callback stay ordered, nested metadata executes once in the reserved worker slot", async () => {
  let progress: HeavyMediaProgress = {};
  let reply: HeavyMediaReply = {};
  const events: string[] = [];
  state.exec.mockResolvedValue({ stdout: '{"duration":60}', stderr: "" });
  state.prepare.mockImplementation(async (episode, _signal, _deps, limits) => {
    expect(await episode.resolveNodes()).toEqual([
      { url: "https://fixture.invalid/fresh.mp4" },
    ]);
    events.push("source-ready");
    await limits.onPreparedGroup([
      { segmentIndex: 0, video: { uri: "gs://fixture/part.mp4" } },
    ]);
    events.push("group-consumed");
    return [];
  });
  await executeHeavyMedia(
    request,
    new AbortController().signal,
    async value => {
      progress = value;
      if (value.nodeRequest && !value.commandResult)
        reply = { commandRequest: { sequence: 1, request: command } };
      if (value.commandResult) {
        expect(events).toContain("raw-saved");
        reply.nodeResponse = {
          sequence: value.nodeRequest!,
          nodes: [{ url: "https://fixture.invalid/fresh.mp4" }],
        };
      }
      if (value.groups?.length) {
        events.push("consumer");
        reply.consumedGroups = value.groups.length;
      }
    },
    {
      readReply: async () => reply,
      saveCommand: async () => {
        events.push("raw-saved");
      },
    }
  );
  expect(state.exec).toHaveBeenCalledOnce();
  expect(events).toEqual([
    "raw-saved",
    "source-ready",
    "consumer",
    "group-consumed",
  ]);
  expect(progress.commandResult?.result?.stdout).toBe('{"duration":60}');
});
it("app metadata resolver uses callback exchange instead of queueing behind its waiting parent", async () => {
  const commandResult = { stdout: '{"duration":60}', stderr: "" };
  let output: unknown = { progress: { nodeRequest: 1 } };
  let status = "running";
  const store = {
    enqueue: vi.fn(),
    cancel: vi.fn(),
    get: vi.fn(async () => ({
      id: "parent",
      userId: "7",
      input: {},
      output,
      status,
      error: null,
      updatedAt: new Date(),
    })),
    reply: vi.fn(async (_id: string, _user: string, value: HeavyMediaReply) => {
      if (value.commandRequest)
        output = {
          progress: {
            nodeRequest: 1,
            commandResult: {
              sequence: value.commandRequest.sequence,
              result: commandResult,
            },
          },
        };
    }),
  };
  const result = await withHeavyMediaContext(
    { userId: "7", executionId: "original" },
    () =>
      dispatchHeavyMedia(request, {
        store,
        wait: async () => {},
        onProgress: async () => {
          expect(
            await dispatchLearnCommand("ffprobe", command.args, {
              timeout: 20000,
              maxBuffer: 8192,
            })
          ).toEqual(commandResult);
          status = "succeeded";
          output = { result: ["prepared"] };
        },
      })
  );
  expect(result).toEqual(["prepared"]);
  expect(store.enqueue).toHaveBeenCalledOnce();
  expect(store.cancel).not.toHaveBeenCalled();
});
it("consumer cancellation aborts the same preparation without another metadata attempt", async () => {
  const c = new AbortController();
  state.prepare.mockImplementation(async (_ep, _signal, _deps, limits) =>
    limits.onPreparedGroup([])
  );
  await expect(
    executeHeavyMedia(
      request,
      c.signal,
      async () => {
        c.abort(new Error("consumer stopped"));
      },
      {
        readReply: async () => ({}),
        saveCommand: vi.fn(),
      }
    )
  ).rejects.toThrow("consumer stopped");
  expect(state.exec).not.toHaveBeenCalled();
});
it("keeps metadata timeout unset and Node's original 1MiB default, returning native stderr for the existing fallback classifier", async () => {
  const { heavyMediaCallbackCommand } = await import("./heavyMediaContext");
  const bridge = vi.fn(async () => ({
    stdout: '{"partial":true}',
    stderr: "fixture native error",
    executionError: "command failed",
  }));
  await expect(
    heavyMediaCallbackCommand.run(bridge, () =>
      dispatchLearnCommand("ffprobe", command.args, {})
    )
  ).rejects.toMatchObject({
    stderr: "fixture native error",
    stdout: '{"partial":true}',
  });
  expect(bridge).toHaveBeenCalledWith(
    expect.objectContaining({ timeoutMs: undefined, maxBuffer: 1024 * 1024 })
  );
});
it("worker returns original failed command output as a durable receipt before caller classification", async () => {
  state.exec.mockRejectedValueOnce(
    Object.assign(new Error("fixture failure"), {
      stdout: '{"partial":1}',
      stderr: "codec unavailable",
    })
  );
  await expect(
    executeHeavyMedia(command, new AbortController().signal, async () => {})
  ).resolves.toEqual({
    stdout: '{"partial":1}',
    stderr: "codec unavailable",
    executionError: "fixture failure",
  });
});
it("a resumed owner advances persisted command identity and sees acknowledged groups instead of consuming a stale reply", async () => {
  let status = "running";
  let input: unknown = {
    heavyReply: {
      consumedGroups: 2,
      nodeResponse: { sequence: 1 },
      commandRequest: { sequence: 3 },
    },
  };
  let output: unknown = {
    progress: {
      nodeRequest: 2,
      commandResult: { sequence: 3, result: { stdout: "old", stderr: "" } },
    },
  };
  const store = {
    enqueue: vi.fn(),
    cancel: vi.fn(),
    get: vi.fn(async () => ({
      id: "resume",
      userId: "7",
      status,
      input,
      output,
      error: null,
      updatedAt: new Date(),
    })),
    reply: vi.fn(async (_id: string, _user: string, value: HeavyMediaReply) => {
      expect(value.commandRequest?.sequence).toBe(4);
      output = {
        progress: {
          commandResult: {
            sequence: 4,
            result: { stdout: "fresh", stderr: "" },
          },
        },
      };
    }),
  };
  await withHeavyMediaContext({ userId: "7", executionId: "resume" }, () =>
    dispatchHeavyMedia(request, {
      store,
      wait: async () => {},
      onProgress: async value => {
        expect(value.acknowledgedGroups).toBe(2);
        expect(value.resolvedNodeRequest).toBe(1);
        expect(
          (await dispatchLearnCommand("ffprobe", command.args, {})).stdout
        ).toBe("fresh");
        status = "succeeded";
        output = { result: [] };
      },
    })
  );
  expect(store.enqueue).toHaveBeenCalledOnce();
});

const sourceUrl = "https://0996zp.com/vod/play/146259/sid/1313645";
const playback = {
  playbackUrl: "https://ppvod01.kqgfbs.com/fixture.m3u8?whip=worker&sign=test",
  playbackUrls: ["https://ppvod01.kqgfbs.com/fixture.m3u8?whip=worker&sign=test"],
  referer: "https://0996zp.com/",
  markers: [],
};

it("备料已占工作机时，来源解析和探测在同一回调槽执行且不另建子队列", async () => {
  state.source.mockResolvedValue(playback);
  state.exec.mockResolvedValue({ stdout: '{"duration":60}', stderr: "" });
  let status = "running";
  let output: unknown = { progress: { nodeRequest: 1 } };
  const handled: string[] = [];
  const store = {
    enqueue: vi.fn(), cancel: vi.fn(),
    get: vi.fn(async () => ({ id: "prepare", userId: "7", input: {}, output, status, error: null, updatedAt: new Date() })),
    reply: vi.fn(async (_id: string, _user: string, value: HeavyMediaReply) => {
      if (!value.commandRequest) return;
      handled.push(value.commandRequest.request.kind);
      const result = await executeHeavyMedia(value.commandRequest.request, new AbortController().signal, async () => {});
      output = { progress: { nodeRequest: 1, commandResult: { sequence: value.commandRequest.sequence, result } } };
    }),
  };
  await withHeavyMediaContext({ userId: "7", executionId: "source-affinity" }, () => dispatchHeavyMedia(request, {
    store, wait: async () => {}, onProgress: async () => {
      const resolved = await dispatchLearnSourcePlayback(sourceUrl);
      expect(resolved).toEqual(playback);
      await dispatchLearnCommand("ffprobe", [resolved.playbackUrl], {});
      status = "succeeded"; output = { result: [] };
    },
  }));
  expect(handled).toEqual(["learn_source", "learn_command"]);
  expect(store.enqueue).toHaveBeenCalledOnce();
  expect(state.source).toHaveBeenCalledWith(sourceUrl, expect.any(AbortSignal));
  expect(state.exec).toHaveBeenCalledWith("ffprobe", [playback.playbackUrl], expect.any(Object));
  expect(store.cancel).not.toHaveBeenCalled();
});

it("工作机备料等待来源时接受新的解析回调并先保存回执", async () => {
  state.source.mockResolvedValue(playback);
  let reply: HeavyMediaReply = {};
  const saved = vi.fn();
  state.prepare.mockImplementation(async episode => {
    expect(await episode.resolveNodes()).toEqual([{ url: playback.playbackUrl, referer: playback.referer }]);
    return [];
  });
  await executeHeavyMedia(request, new AbortController().signal, async value => {
    if (value.nodeRequest && !value.commandResult) reply = {
      commandRequest: { sequence: 1, request: { kind: "learn_source", sourceUrl, refreshId: "fixture-refresh" } },
    };
    if (value.commandResult) {
      expect(saved).toHaveBeenCalledOnce();
      expect(JSON.parse(value.commandResult.result!.stdout)).toEqual(playback);
      reply.nodeResponse = { sequence: value.nodeRequest!, nodes: [{ url: playback.playbackUrl, referer: playback.referer }] };
    }
  }, { readReply: async () => reply, saveCommand: saved });
  expect(state.source).toHaveBeenCalledOnce();
});

it("显式刷新不复用已持久化签名，取消和错误不回退到网站机", async () => {
  const { heavyMediaCallbackCommand } = await import("./heavyMediaContext");
  const bridge = vi.fn(async () => ({ stdout: JSON.stringify(playback), stderr: "" }));
  await heavyMediaCallbackCommand.run(bridge, async () => {
    await dispatchLearnSourcePlayback(sourceUrl);
    await dispatchLearnSourcePlayback(sourceUrl);
    const c = new AbortController(); c.abort(new Error("已停止"));
    await expect(dispatchLearnSourcePlayback(sourceUrl, c.signal)).rejects.toThrow("已停止");
  });
  expect(bridge).toHaveBeenCalledTimes(2);
  const calls = bridge.mock.calls as unknown as [[{ refreshId: string }], [{ refreshId: string }]];
  expect(calls[0][0].refreshId).not.toBe(calls[1][0].refreshId);
  expect(Object.keys(calls[0][0]).sort()).toEqual(["kind", "refreshId", "sourceUrl"]);
  await expect(heavyMediaCallbackCommand.run(async () => ({ stdout: "", stderr: "", executionError: "来源拒绝" }),
    () => dispatchLearnSourcePlayback(sourceUrl))).rejects.toThrow("来源拒绝");
});

it("工作机来源失败仅返回脱敏错误，不能作为空解析成功", async () => {
  state.source.mockRejectedValueOnce(new Error("https://fixture.invalid/?sign=test-secret"));
  await expect(executeHeavyMedia({ kind: "learn_source", sourceUrl, refreshId: "failure" }, new AbortController().signal, async () => {}))
    .resolves.toEqual({ stdout: "", stderr: "", executionError: "已脱敏的来源错误" });
});
