import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultCanvasBlock } from "./canvasTypes";
import {
  manhuaOutboundConfirmationFingerprint,
  previewCanvasBlockOutbound,
  runCanvasBlock,
  type CanvasOutboundPreview,
} from "./canvasRunBlock";

/**
 * UI-07：生成前确认必须展示**真正会发出去的那一份**。
 *
 * 节点上存的 prompt 与实际出站串不是同一个东西：Seedance 先过
 * renderManhuaClipPromptForSeedance，再按引擎/时长/参考数量重排格式，
 * 出口还把 @图N 还原成 @图片N。这组测试钉住预览与出站同源，
 * 以及输入一变旧确认就失效。
 */

vi.mock("./flyHealthGate", () => ({
  withFlyHealthGate: async (_origin: string, run: () => Promise<unknown>) => run(),
}));
vi.mock("./longJobsFlyOrigin", () => ({
  withLongJobsFlyDirect: (url: string) => url,
  flyHealthProbeOriginForUrl: () => "https://test.invalid",
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

const deps = { userRole: "admin" as const, optimizeCopy: async () => "" };

function makeBlock(over: Record<string, unknown> = {}) {
  return {
    ...defaultCanvasBlock("video", 0, 0),
    id: "video-outbound-preview",
    videoModel: "seedance-2.5" as const,
    prompt:
      "【第1段·10s】0–10s：阿菁在甲板上拔剑格挡，刃口相接后半步卸力。@图片1提供人物身份。",
    refImageUrl: "https://test.invalid/identity.png",
    ...over,
  };
}

/** 拦住真实 POST，把出站请求体抓出来；同时保证测试永不联网 */
function captureOutbound() {
  const bodies: Record<string, unknown>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (!String(url).includes("op=seedanceI2V") || init?.method !== "POST") {
        throw new Error(`禁止真实网络：${url}`);
      }
      bodies.push(JSON.parse(String(init.body)));
      return new Response(
        JSON.stringify({ ok: true, videoUrl: "https://test.invalid/result.mp4" }),
      );
    }),
  );
  return bodies;
}

describe("生成前确认与实际出站同源", () => {
  it("同一段输入：预览的请求体与真正 POST 的逐字段相同", async () => {
    const block = makeBlock();

    // 预览：必须一次网络都不发
    const noNetwork = vi.fn(async () => {
      throw new Error("预览不得发起任何请求");
    });
    vi.stubGlobal("fetch", noNetwork);
    const preview = await previewCanvasBlockOutbound(deps, block);
    expect(noNetwork).not.toHaveBeenCalled();

    // 实跑：抓出真正提交的请求体
    const bodies = captureOutbound();
    await runCanvasBlock(deps, block);
    expect(bodies).toHaveLength(1);

    // idempotencyKey 每次运行都不同，且与用户所见内容无关，比对时剔除
    const strip = (body: Record<string, unknown>) => {
      const { idempotencyKey: _k, ...rest } = body;
      return rest;
    };
    expect(strip(preview.body)).toEqual(strip(bodies[0]!));
  });

  it("预览给出的提示词就是出站提示词，且不等于节点上存的原串", async () => {
    const block = makeBlock();
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("预览不得发起任何请求");
    }));
    const preview = await previewCanvasBlockOutbound(deps, block);

    expect(preview.compile.blocked).toBe(false);
    expect(preview.body.prompt).toBe(preview.compile.text);
    // 出站串经过引擎方言与格式层，和节点原串不是同一个东西——这正是要展示它的理由
    expect(preview.body.prompt).not.toBe(block.prompt);
  });

  it("预览带出真实参考素材与去重后的数量，供确认界面逐条展示", async () => {
    const block = makeBlock();
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("预览不得发起任何请求");
    }));
    const preview = await previewCanvasBlockOutbound(deps, block);

    expect(preview.refCounts.image).toBeGreaterThan(0);
    expect(preview.refs.imageUrls.length).toBeGreaterThan(0);
    // 参考数量与编译入参同源：去重后计数，不是数组长度直接相加
    const deduped = new Set(preview.refs.imageUrls.map((u) => u.trim()).filter(Boolean));
    expect(preview.refCounts.image).toBe(deduped.size);
    expect(preview.durationSec).toBeGreaterThan(0);
  });
});

describe("输入一变，旧确认失效", () => {
  const fingerprintOf = async (block: ReturnType<typeof makeBlock>) => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("预览不得发起任何请求");
    }));
    const preview: CanvasOutboundPreview = await previewCanvasBlockOutbound(deps, block);
    return manhuaOutboundConfirmationFingerprint(preview);
  };

  it("同一份输入连算两次，指纹稳定——否则每次刷新都会误判失效", async () => {
    const block = makeBlock();
    expect(await fingerprintOf(block)).toBe(await fingerprintOf(block));
  });

  it("改提示词 → 旧确认失效", async () => {
    const before = await fingerprintOf(makeBlock());
    const after = await fingerprintOf(
      makeBlock({ prompt: "【第1段·10s】0–10s：阿菁改为收剑后退，不再格挡。" }),
    );
    expect(after).not.toBe(before);
  });

  it("改模型 → 旧确认失效", async () => {
    const before = await fingerprintOf(makeBlock());
    const after = await fingerprintOf(makeBlock({ videoModel: "seedance-2.0" }));
    expect(after).not.toBe(before);
  });

  it("改时长 → 旧确认失效", async () => {
    const before = await fingerprintOf(makeBlock());
    const after = await fingerprintOf(
      makeBlock({ prompt: "【第1段·6s】0–6s：阿菁在甲板上拔剑格挡。@图片1提供人物身份。" }),
    );
    expect(after).not.toBe(before);
  });

  it("改参考素材 → 旧确认失效", async () => {
    const before = await fingerprintOf(makeBlock());
    const after = await fingerprintOf(
      makeBlock({ refImageUrl: "https://test.invalid/another-identity.png" }),
    );
    expect(after).not.toBe(before);
  });
});
