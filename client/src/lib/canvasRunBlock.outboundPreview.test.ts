import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultCanvasBlock } from "./canvasTypes";
import {
  CanvasOutboundPreviewUnsupportedError,
  manhuaOutboundConfirmationFingerprint,
  normalizeOutboundRefUrlForFingerprint,
  previewCanvasBlockOutbound,
  resolveCanvasOutboundPreviewUnsupportedReason,
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

/**
 * 0914 审查 P1：previewOnly 原先只拦住普通 Seedance 分支，
 * 原片编辑会提前进入 runSeedanceProductVideo，Wan/H3 与非视频块各有自己的提交点，
 * 都绕过了末尾的预览回卷——等于预览会真的发出付费请求。
 * 这组测试把「任何外部调用之前就拒绝」钉死。
 */
describe("预览安全：不支持的组合在任何外部调用之前拒绝", () => {
  /** 任何网络、任何 LLM、任何任务回调被碰到都立刻失败 */
  function forbidEverything() {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(`fetch:${url}`);
        throw new Error(`预览不得发起任何请求：${url}`);
      }),
    );
    return calls;
  }

  // 原片编辑／延长按仓库真实契约构造：id 以 clip- 开头 + 2.5 + 明确 workMode
  const cases: Array<[string, Record<string, unknown>]> = [
    [
      "原片编辑节点",
      { id: "clip-e01-g02", videoModel: "seedance-2.5", seedance25WorkMode: "video_edit" },
    ],
    [
      "原片延长节点",
      { id: "clip-e01-g02", videoModel: "seedance-2.5", seedance25WorkMode: "video_extend" },
    ],
    ["Wan 3.0", { videoModel: "wan-3.0" }],
    ["海螺 H3", { videoModel: "minimax-hailuo-3" }],
    ["音乐 MV 镜头", { musicMvShot: { referenceImages: [] } }],
  ];

  it.each(cases)("%s：预览被拒绝且零外部调用", async (_label, over) => {
    const calls = forbidEverything();
    const llm = vi.fn(async () => "");
    const onVideoTaskCreated = vi.fn();
    const block = makeBlock(over);
    await expect(
      previewCanvasBlockOutbound(
        { userRole: "admin", optimizeCopy: llm, onVideoTaskCreated },
        block as never,
      ),
    ).rejects.toBeInstanceOf(CanvasOutboundPreviewUnsupportedError);
    expect(calls).toEqual([]);
    expect(llm).not.toHaveBeenCalled();
    expect(onVideoTaskCreated).not.toHaveBeenCalled();
  });

  it("非视频节点（图片/文案/音乐）一律拒绝", () => {
    for (const kind of ["image", "text", "copy_organize", "music", "video_reverse"]) {
      expect(resolveCanvasOutboundPreviewUnsupportedReason({ kind } as never)).toBeTruthy();
    }
  });

  it("普通 Seedance 段成片才放行", () => {
    expect(
      resolveCanvasOutboundPreviewUnsupportedReason(makeBlock() as never),
    ).toBeNull();
  });

  it("即便绕过预览入口直接传 previewOnly，runCanvasBlock 内部也拒绝", async () => {
    const calls = forbidEverything();
    const block = makeBlock({ videoModel: "wan-3.0" });
    await expect(
      runCanvasBlock(deps, block as never, undefined, { previewOnly: true } as never),
    ).rejects.toBeInstanceOf(CanvasOutboundPreviewUnsupportedError);
    expect(calls).toEqual([]);
  });
});

/**
 * 0914 审查 P2：白名单指纹漏掉 episodeIndex / clipIndex / manhuaPilot，
 * 换集段、换项目、换试片身份会得到同一个指纹。改为黑名单口径后钉住。
 */
describe("确认指纹覆盖完整业务身份", () => {
  const fp = (body: Record<string, unknown>, scope?: Record<string, unknown>) =>
    manhuaOutboundConfirmationFingerprint(
      { engine: "seedance-2.5", body } as never,
      scope as never,
    );
  const base = { prompt: "同一段提示词", duration: 10, version: "2.5" };

  it("只换 idempotencyKey 不失效", () => {
    expect(fp({ ...base, idempotencyKey: "k-1" })).toBe(fp({ ...base, idempotencyKey: "k-2" }));
  });

  it("换集号失效", () => {
    expect(fp({ ...base, episodeIndex: 1 })).not.toBe(fp({ ...base, episodeIndex: 2 }));
  });

  it("换段号失效", () => {
    expect(fp({ ...base, clipIndex: 1 })).not.toBe(fp({ ...base, clipIndex: 2 }));
  });

  it("换试片身份失效", () => {
    expect(fp({ ...base, manhuaPilot: { intent: "pilot" } })).not.toBe(
      fp({ ...base, manhuaPilot: { intent: "final" } }),
    );
  });

  it("换项目 / 换节点 / 换账号失效", () => {
    const s = { userId: "7", projectId: "proj-a", blockId: "blk-1" };
    expect(fp(base, s)).not.toBe(fp(base, { ...s, projectId: "proj-b" }));
    expect(fp(base, s)).not.toBe(fp(base, { ...s, blockId: "blk-2" }));
    expect(fp(base, s)).not.toBe(fp(base, { ...s, userId: "8" }));
  });

  it("键序不影响指纹", () => {
    expect(fp({ a: 1, b: 2 } as never)).toBe(fp({ b: 2, a: 1 } as never));
  });
});

/**
 * 0914 审查 P2：预览与生成各自都会重新续签，指纹若含完整 URL，
 * 用户什么都没改也会被判旧确认失效。
 */
describe("同一素材重新签名不该让确认失效", () => {
  const signed = (object: string, sig: string, extra = "") =>
    `https://storage.googleapis.com/bucket/${object}?X-Goog-Algorithm=GOOG4-RSA-SHA256` +
    `&X-Goog-Credential=cred&X-Goog-Date=2026091${sig}T000000Z&X-Goog-Expires=3600` +
    `&X-Goog-SignedHeaders=host&X-Goog-Signature=${sig}${extra}`;
  const fp = (body: Record<string, unknown>) =>
    manhuaOutboundConfirmationFingerprint({ engine: "seedance-2.5", body } as never);

  it("同一对象换签名：指纹不变", () => {
    expect(fp({ imageUrls: [signed("a.png", "1")] })).toBe(
      fp({ imageUrls: [signed("a.png", "2")] }),
    );
  });

  it("换对象：指纹变化", () => {
    expect(fp({ imageUrls: [signed("a.png", "1")] })).not.toBe(
      fp({ imageUrls: [signed("b.png", "1")] }),
    );
  });

  it("换版本（generation）：指纹变化", () => {
    expect(fp({ imageUrls: [signed("a.png", "1", "&generation=100")] })).not.toBe(
      fp({ imageUrls: [signed("a.png", "1", "&generation=200")] }),
    );
  });

  it("非 GCS 外链的 query 一律保留：内容参数变化必须失效", () => {
    const a = "https://cdn.example.com/i?v=1";
    const b = "https://cdn.example.com/i?v=2";
    expect(normalizeOutboundRefUrlForFingerprint(a)).toBe(a);
    expect(fp({ imageUrls: [a] })).not.toBe(fp({ imageUrls: [b] }));
  });

  it("站内稳定链原样保留", () => {
    const inSite = "/api/canvas-media/generated/u1/a.png";
    expect(normalizeOutboundRefUrlForFingerprint(inSite)).toBe(inSite);
  });
});
