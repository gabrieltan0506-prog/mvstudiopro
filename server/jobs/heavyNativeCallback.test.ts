import { afterEach, expect, it, vi } from "vitest";
import { executeHeavyMedia } from "./heavyMediaWorker";
import {
  dispatchHeavyMedia,
  type HeavyMediaProgress,
  type HeavyMediaReply,
  type HeavyMediaRequest,
} from "./heavyMediaQueue";
import { withHeavyMediaContext } from "./heavyMediaContext";
import { dispatchLearnCommand } from "../services/heavyLearnMedia";
const state = vi.hoisted(() => ({ prepare: vi.fn(), exec: vi.fn() }));
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
