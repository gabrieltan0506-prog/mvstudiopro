import { describe, expect, it, vi } from "vitest";
import {
  TokenPlanDialogueTtsConfigurationError,
  TokenPlanDialogueTtsExplicitRejectionError,
  TokenPlanDialogueTtsUnknownResultError,
} from "./tokenPlanDialogueTts.js";
import {
  normalizeTokenPlanWsVoice,
  synthesizeTokenPlanDialogueWs,
  type TokenPlanTtsSocket,
} from "./tokenPlanDialogueTtsWs.js";

/** 事件可编排的假 WS：send 进来什么，脚本决定回什么。 */
class FakeSocket implements TokenPlanTtsSocket {
  readonly sent: Array<Record<string, any>> = [];
  private readonly handlers = new Map<string, Array<(...args: unknown[]) => void>>();
  constructor(
    private readonly script: (socket: FakeSocket, message: Record<string, any>) => void
  ) {}
  on(event: string, listener: (...args: unknown[]) => void): void {
    const list = this.handlers.get(event) || [];
    list.push(listener);
    this.handlers.set(event, list);
    if (event === "open") queueMicrotask(() => this.emit("open"));
  }
  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.handlers.get(event) || []) listener(...args);
  }
  emitEvent(kind: string, extra: Record<string, unknown> = {}): void {
    this.emit(
      "message",
      Buffer.from(JSON.stringify({ header: { event: kind, ...extra } })),
      false
    );
  }
  emitAudio(buf: Buffer): void {
    this.emit("message", buf, true);
  }
  send(data: string): void {
    const message = JSON.parse(data);
    this.sent.push(message);
    queueMicrotask(() => this.script(this, message));
  }
  close(): void {
    /* 测试里关闭不再回发事件 */
  }
}

const happyScript = (socket: FakeSocket, message: Record<string, any>) => {
  const action = message?.header?.action;
  if (action === "run-task") socket.emitEvent("task-started");
  if (action === "continue-task") {
    socket.emitAudio(Buffer.alloc(300, 1));
    socket.emitAudio(Buffer.alloc(200, 2));
  }
  if (action === "finish-task") socket.emitEvent("task-finished");
};

const acceptedGate = {
  accepted: true as const,
  durationSeconds: 2.5,
  voicedSeconds: 2.1,
};

function baseDeps(factory: (url: string) => TokenPlanTtsSocket) {
  const uploadAudio = vi.fn(async () => ({ gcsUri: "gs://bucket/x.mp3" }));
  return {
    env: { DASHSCOPE_SG_PLAN_KEY: "sg-key", WAN_PLAN_API_KEY: "bj-key" } as any,
    socketFactory: (url: string) => factory(url),
    inspectAudio: vi.fn(async () => acceptedGate as any),
    uploadAudio: uploadAudio as any,
    signAudioUrl: vi.fn(() => "https://signed.example/x.mp3") as any,
    startTimeoutMs: 500,
    totalTimeoutMs: 1000,
  };
}

describe("normalizeTokenPlanWsVoice", () => {
  it("strips the long catalog prefix and keeps bare ids", () => {
    expect(
      normalizeTokenPlanWsVoice("qwen-audio-3.0-tts-plus-longcanzhuyue")
    ).toBe("longcanzhuyue");
    expect(normalizeTokenPlanWsVoice("longanlingxin")).toBe("longanlingxin");
    expect(() => normalizeTokenPlanWsVoice(" ")).toThrow(
      TokenPlanDialogueTtsConfigurationError
    );
  });
});

describe("synthesizeTokenPlanDialogueWs", () => {
  it("synthesizes via singapore first and uploads gated audio", async () => {
    const urls: string[] = [];
    const deps = baseDeps((url) => {
      urls.push(url);
      return new FakeSocket(happyScript);
    });
    const result = await synthesizeTokenPlanDialogueWs(
      { input: "你好", voice: "longanlingxin", ownerUserId: 7 },
      deps
    );
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("ap-southeast-1");
    expect(result.region).toBe("singapore");
    expect(result.bytes).toBe(500);
    expect(result.voiceGate.accepted).toBe(true);
    const uploaded = (deps.uploadAudio as any).mock.calls[0][0];
    expect(uploaded.objectName).toMatch(
      /^manhua-dialogue-tts\/token-plan\/u7\//
    );
  });

  it("falls back to beijing when singapore reports task-failed", async () => {
    const urls: string[] = [];
    const deps = baseDeps((url) => {
      urls.push(url);
      if (url.includes("ap-southeast-1")) {
        return new FakeSocket((socket, message) => {
          if (message?.header?.action === "run-task")
            socket.emitEvent("task-failed", { error_message: "quota" });
        });
      }
      return new FakeSocket(happyScript);
    });
    const result = await synthesizeTokenPlanDialogueWs(
      { input: "你好", voice: "longanlingxin", ownerUserId: 7 },
      deps
    );
    expect(urls).toHaveLength(2);
    expect(result.region).toBe("beijing");
  });

  it("treats post-start disconnect as unknown result and never retries beijing", async () => {
    const urls: string[] = [];
    const deps = baseDeps((url) => {
      urls.push(url);
      return new FakeSocket((socket, message) => {
        if (message?.header?.action === "run-task") {
          socket.emitEvent("task-started");
        }
        if (message?.header?.action === "continue-task") {
          socket.emit("error", new Error("boom"));
        }
      });
    });
    await expect(
      synthesizeTokenPlanDialogueWs(
        { input: "你好", voice: "longanlingxin", ownerUserId: 7 },
        deps
      )
    ).rejects.toBeInstanceOf(TokenPlanDialogueTtsUnknownResultError);
    expect(urls).toHaveLength(1);
  });

  it("rejects with configuration error when no plan keys exist", async () => {
    await expect(
      synthesizeTokenPlanDialogueWs(
        { input: "你好", voice: "longanlingxin", ownerUserId: 7 },
        { env: {} as any }
      )
    ).rejects.toBeInstanceOf(TokenPlanDialogueTtsConfigurationError);
  });

  it("propagates explicit rejection when every region refuses", async () => {
    const deps = baseDeps(
      () =>
        new FakeSocket((socket, message) => {
          if (message?.header?.action === "run-task")
            socket.emitEvent("task-failed");
        })
    );
    await expect(
      synthesizeTokenPlanDialogueWs(
        { input: "你好", voice: "longanlingxin", ownerUserId: 7 },
        deps
      )
    ).rejects.toBeInstanceOf(TokenPlanDialogueTtsExplicitRejectionError);
  });
});
