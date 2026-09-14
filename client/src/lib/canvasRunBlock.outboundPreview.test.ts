import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultCanvasBlock } from "./canvasTypes";
import {
  CanvasOutboundPreviewUnsupportedError,
  ManhuaOutboundConfirmationMismatchError,
  ManhuaOutboundConfirmationMissingError,
  requiresManhuaOutboundConfirmation,
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

/** 确认归属三项必填：省略会退化成缺省身份，换账号/项目/节点拿到同一指纹 */
const TEST_SCOPE = {
  userId: "7",
  workspaceId: "manhua-cloud-draft:7",
  projectVersion: "proj-a",
  blockId: "blk-1",
  epoch: 1,
} as const;

function makeBlock(over: Record<string, unknown> = {}) {
  return {
    ...defaultCanvasBlock("video", 0, 0),
    id: "clip-e01-g01",
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

    // 实跑：抓出真正提交的请求体。段成片强制确认，所以先按同一份预览确认再跑。
    const scope = {
      userId: "7",
      workspaceId: "manhua-cloud-draft:7",
      projectVersion: "proj-a",
      blockId: block.id,
      epoch: 1,
    };
    const confirmation = {
      fingerprint: manhuaOutboundConfirmationFingerprint(preview, scope),
      scope,
      confirmedAt: Date.now(),
    };
    const bodies = captureOutbound();
    await runCanvasBlock(deps, block, undefined, {
      enforceOutboundConfirmation: true,
      outboundGate: { currentScope: scope, confirmation },
    } as never);
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
    return manhuaOutboundConfirmationFingerprint(preview, TEST_SCOPE);
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

  // 所有视频成片引擎与工作模式都已接结算点，剩下不支持的只有
  // 「本来就不是漫剧段成片」的：音乐 MV 镜头与非视频块。
  const cases: Array<[string, Record<string, unknown>]> = [
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

  it("普通 Seedance 段成片放行", () => {
    expect(
      resolveCanvasOutboundPreviewUnsupportedReason(makeBlock() as never),
    ).toBeNull();
  });

  // C 项：保留引擎、补预览出口。这三条是「能预览」的正向证据，
  // 且必须同样零外部调用——补出口不等于放松预览不得付费这条。
  const supported: Array<[string, Record<string, unknown>, string]> = [
    ["Wan 3.0", { videoModel: "wan-3.0" }, "wan-3.0"],
    ["海螺 H3", { videoModel: "minimax-hailuo-3" }, "minimax-hailuo-3"],
    ["HappyHorse", { videoModel: "happyhorse" }, "happyhorse"],
    [
      "Seedance 2.5 原片延长",
      {
        videoModel: "seedance-2.5",
        seedance25WorkMode: "video_extend",
        refVideoUrl: "https://test.invalid/source.mp4",
      },
      "seedance-2.5",
    ],
  ];
  it.each(supported)(
    "%s：可预览，拿到真实请求体，且零外部调用",
    async (_label, over, engine) => {
      const calls = forbidEverything();
      const onVideoTaskCreated = vi.fn();
      const block = makeBlock(over);
      const preview = await previewCanvasBlockOutbound(
        { userRole: "admin", optimizeCopy: async () => "", onVideoTaskCreated },
        block as never,
      );
      expect(preview.engine).toBe(engine);
      expect(String(preview.body.prompt || "")).toBeTruthy();
      expect(calls).toEqual([]);
      expect(onVideoTaskCreated).not.toHaveBeenCalled();
    },
  );

  it("原片编辑：可预览，请求体是 video_edit，且零外部调用", async () => {
    const calls = forbidEverything();
    const block = makeBlock({
      id: "clip-e01-g02",
      videoModel: "seedance-2.5",
      seedance25WorkMode: "video_edit",
      refVideoUrl: "https://test.invalid/source.mp4",
      prompt: "原生成稿\n【视频编辑指令】把第 3 秒的剑光调暗",
    });
    const preview = await previewCanvasBlockOutbound(
      { userRole: "admin", optimizeCopy: async () => "" },
      block as never,
    );
    expect(preview.engine).toBe("seedance-2.5");
    expect(preview.body.workMode).toBe("video_edit");
    expect(preview.body.videoUrls).toEqual(["https://test.invalid/source.mp4"]);
    expect(calls).toEqual([]);
  });

  it("即便绕过预览入口直接传 previewOnly，不支持的组合仍在内部拒绝", async () => {
    const calls = forbidEverything();
    const block = makeBlock({ musicMvShot: { referenceImages: [] } });
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
  const fp = (body: Record<string, unknown>, scope: Record<string, unknown> = TEST_SCOPE) =>
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
    const s = {
      userId: "7",
      workspaceId: "manhua-cloud-draft:7",
      projectVersion: "proj-a",
      blockId: "blk-1",
      epoch: 1,
    };
    expect(fp(base, s)).not.toBe(fp(base, { ...s, projectVersion: "proj-b" }));
    expect(fp(base, s)).not.toBe(fp(base, { ...s, workspaceId: "manhua-cloud-draft:8" }));
    // 工作区被整份换掉：同样的内容也必须换指纹
    expect(fp(base, s)).not.toBe(fp(base, { ...s, epoch: 2 }));
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
    manhuaOutboundConfirmationFingerprint({ engine: "seedance-2.5", body } as never, TEST_SCOPE);

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

describe("嵌套结构等价不该误判失效", () => {
  const fp = (body: Record<string, unknown>) =>
    manhuaOutboundConfirmationFingerprint({ engine: "seedance-2.5", body } as never, TEST_SCOPE);

  it("嵌套对象属性顺序不同但内容相同：指纹相同", () => {
    expect(fp({ manhuaPilot: { intent: "pilot", runId: 3 } })).toBe(
      fp({ manhuaPilot: { runId: 3, intent: "pilot" } }),
    );
  });

  it("深层嵌套同样递归归一", () => {
    expect(fp({ a: { b: { x: 1, y: 2 } } } as never)).toBe(
      fp({ a: { b: { y: 2, x: 1 } } } as never),
    );
  });

  it("嵌套内容真变了仍然失效", () => {
    expect(fp({ manhuaPilot: { intent: "pilot", runId: 3 } })).not.toBe(
      fp({ manhuaPilot: { intent: "pilot", runId: 4 } }),
    );
  });

  it("数组顺序保留语义：调换参考素材顺序必须失效", () => {
    expect(fp({ imageUrls: ["https://a.example/1.png", "https://a.example/2.png"] })).not.toBe(
      fp({ imageUrls: ["https://a.example/2.png", "https://a.example/1.png"] }),
    );
  });
});

/**
 * 第三阶段：生成前确认必须在**发请求之前**被重新核对。
 * 单段、批量、重跑都经 runCanvasBlock 出站，所以闸设在提交口，绕不过去。
 */
describe("运行前核对确认：缺确认、换身份、改输入都不下单", () => {
  /** 当前上下文的 scope，和确认记录分开给——这是审查要求的关键 */
  const currentScopeFor = (
    blockId: string,
    over: Record<string, string | number> = {},
  ) => ({
    userId: "7",
    workspaceId: "manhua-cloud-draft:7",
    projectVersion: "proj-a",
    blockId,
    epoch: 1,
    ...over,
  });

  const confirmFor = async (block: ReturnType<typeof makeBlock>) => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("预览不得发起任何请求");
    }));
    const preview = await previewCanvasBlockOutbound(deps, block as never);
    const scope = currentScopeFor(block.id);
    return {
      fingerprint: manhuaOutboundConfirmationFingerprint(preview, scope),
      scope,
      confirmedAt: Date.now(),
    };
  };

  it("完全没有确认记录：拒绝且一次 POST 都没有", async () => {
    const bodies = captureOutbound();
    const block = makeBlock();
    await expect(
      runCanvasBlock(deps, block as never, undefined, {
        enforceOutboundConfirmation: true,
        outboundGate: { currentScope: currentScopeFor(block.id) },
      } as never),
    ).rejects.toBeInstanceOf(ManhuaOutboundConfirmationMissingError);
    expect(bodies).toEqual([]);
  });

  it("产品入口声明了强制，却连 gate 都没传：同样拒绝", async () => {
    const bodies = captureOutbound();
    await expect(
      runCanvasBlock(deps, makeBlock() as never, undefined, {
        enforceOutboundConfirmation: true,
      } as never),
    ).rejects.toBeInstanceOf(ManhuaOutboundConfirmationMissingError);
    expect(bodies).toEqual([]);
  });

  /**
   * C 项闭合：上一轮这里有两条「已知缺口」测试，如实记录 Wan 与原片编辑不在闸内。
   * 现在两条路径都接了共用结算点，缺口不存在了，于是改成正向覆盖——
   * 不是把断言放宽，是同一件事从「没有」变成「有」。
   */
  it("Wan 段成片：缺确认时零 POST", async () => {
    const block = makeBlock({ videoModel: "wan-3.0" });
    expect(requiresManhuaOutboundConfirmation(block as never)).toBe(true);
    const bodies = captureOutbound();
    await expect(
      runCanvasBlock(deps, block as never, undefined, {
        enforceOutboundConfirmation: true,
        outboundGate: { currentScope: currentScopeFor(block.id) },
      } as never),
    ).rejects.toBeInstanceOf(ManhuaOutboundConfirmationMissingError);
    expect(bodies).toEqual([]);
  });

  it("海螺 H3 段成片：缺确认时零 POST", async () => {
    const block = makeBlock({ videoModel: "minimax-hailuo-3" });
    expect(requiresManhuaOutboundConfirmation(block as never)).toBe(true);
    const bodies = captureOutbound();
    await expect(
      runCanvasBlock(deps, block as never, undefined, {
        enforceOutboundConfirmation: true,
        outboundGate: { currentScope: currentScopeFor(block.id) },
      } as never),
    ).rejects.toBeInstanceOf(ManhuaOutboundConfirmationMissingError);
    expect(bodies).toEqual([]);
  });

  it("原片编辑：已在闸范围内，缺确认时零 POST", async () => {
    const block = makeBlock({
      id: "clip-e01-g02",
      videoModel: "seedance-2.5",
      seedance25WorkMode: "video_edit",
      refVideoUrl: "https://test.invalid/source.mp4",
      prompt: "原生成稿\n【视频编辑指令】把第 3 秒的剑光调暗",
    });
    expect(requiresManhuaOutboundConfirmation(block as never)).toBe(true);
    const bodies = captureOutbound();
    await expect(
      runCanvasBlock(deps, block as never, undefined, {
        enforceOutboundConfirmation: true,
        outboundGate: { currentScope: currentScopeFor(block.id) },
      } as never),
    ).rejects.toBeInstanceOf(ManhuaOutboundConfirmationMissingError);
    expect(bodies).toEqual([]);
  });

  it("确认之后把引擎从 Seedance 改成 Wan：旧确认失效，零 POST", async () => {
    // 上一轮审查点名的逃逸路线：确认完再换引擎就离开闸范围。
    // 现在换引擎＝请求体变了＝指纹对不上，直接拦。
    const block = makeBlock();
    const confirmation = await confirmFor(block);
    const switched = { ...block, videoModel: "wan-3.0" };
    const bodies = captureOutbound();
    await expect(
      runCanvasBlock(deps, switched as never, undefined, {
        enforceOutboundConfirmation: true,
        outboundGate: { currentScope: currentScopeFor(block.id), confirmation },
      } as never),
    ).rejects.toBeInstanceOf(ManhuaOutboundConfirmationMismatchError);
    expect(bodies).toEqual([]);
  });

  // —— 0914 ee65736b 审查补测：免检通道与在途切换 ——

  it.each([
    ["HappyHorse", { videoModel: "happyhorse" }],
    [
      "Seedance 2.5 原片延长",
      {
        videoModel: "seedance-2.5",
        seedance25WorkMode: "video_extend",
        refVideoUrl: "https://test.invalid/source.mp4",
      },
    ],
  ])("%s 段成片：从未确认过，零 POST", async (_label, over) => {
    const block = makeBlock(over);
    // 判定只看任务契约，不看预览实现到哪一步
    expect(requiresManhuaOutboundConfirmation(block as never)).toBe(true);
    const bodies = captureOutbound();
    await expect(
      runCanvasBlock(deps, block as never, undefined, {
        enforceOutboundConfirmation: true,
        outboundGate: { currentScope: currentScopeFor(block.id) },
      } as never),
    ).rejects.toBeInstanceOf(ManhuaOutboundConfirmationMissingError);
    expect(bodies).toEqual([]);
  });

  it.each([
    ["延长", { seedance25WorkMode: "video_extend", refVideoUrl: "https://test.invalid/s.mp4" }],
    ["HappyHorse", { videoModel: "happyhorse" }],
  ])("已确认普通片之后切到%s：旧确认失效，零 POST", async (_label, over) => {
    const block = makeBlock();
    const confirmation = await confirmFor(block);
    const switched = { ...block, ...over };
    const bodies = captureOutbound();
    await expect(
      runCanvasBlock(deps, switched as never, undefined, {
        enforceOutboundConfirmation: true,
        outboundGate: { currentScope: currentScopeFor(block.id), confirmation },
      } as never),
    ).rejects.toBeInstanceOf(ManhuaOutboundConfirmationMismatchError);
    expect(bodies).toEqual([]);
  });

  it("在途切账号：早拒通过之后再切，提交边界仍拦下，零 POST", async () => {
    // 审查 P1：入口现读不等于提交时现读。
    // runCanvasBlock 的函数体同步跑到第一个 await 为止，早拒在那之前，
    // 所以这里同步改 userId，改的正是「早拒之后、提交之前」这段窗口。
    const block = makeBlock();
    const confirmation = await confirmFor(block);
    const bodies = captureOutbound();
    let userId = "7";
    const gate = () => ({
      currentScope: currentScopeFor(block.id, { userId }),
      confirmation,
    });
    const running = runCanvasBlock(deps, block as never, undefined, {
      enforceOutboundConfirmation: true,
      resolveOutboundGate: gate,
    } as never);
    userId = "999";
    await expect(running).rejects.toBeInstanceOf(ManhuaOutboundConfirmationMismatchError);
    expect(bodies).toEqual([]);
  });

  it("在途清空确认（世代自增）：旧 gate 对象不得继续有效，零 POST", async () => {
    // 函数开头读到的是「有确认、世代一致」，通过早拒；
    // 随后工作区被重载（epoch 自增、确认被清空），提交边界必须察觉。
    const block = makeBlock();
    const confirmation = await confirmFor(block);
    const bodies = captureOutbound();
    let epoch = 1;
    const gate = () => ({
      currentScope: currentScopeFor(block.id, { epoch }),
      confirmation: epoch === 1 ? confirmation : undefined,
    });
    const running = runCanvasBlock(deps, block as never, undefined, {
      enforceOutboundConfirmation: true,
      resolveOutboundGate: gate,
    } as never);
    // 同步紧接着发生：早拒已经过了，提交边界还没到
    epoch = 2;
    await expect(running).rejects.toBeInstanceOf(ManhuaOutboundConfirmationMissingError);
    expect(bodies).toEqual([]);
  });

  it("确认后未改动：正常提交", async () => {
    const block = makeBlock();
    const confirmation = await confirmFor(block);
    const bodies = captureOutbound();
    const result = await runCanvasBlock(deps, block as never, undefined, {
      outboundGate: { currentScope: currentScopeFor(block.id), confirmation },
    } as never);
    expect(bodies).toHaveLength(1);
    expect(result.outputUrl).toBe("https://test.invalid/result.mp4");
  });

  it("保留旧确认，只让工作区换代（载入云草稿等）：零 POST", async () => {
    const block = makeBlock();
    const confirmation = await confirmFor(block);
    const bodies = captureOutbound();
    await expect(
      runCanvasBlock(deps, block as never, undefined, {
        enforceOutboundConfirmation: true,
        outboundGate: {
          currentScope: currentScopeFor(block.id, { epoch: 2 }),
          confirmation,
        },
      } as never),
    ).rejects.toThrow(/工作区在你确认之后被重新载入过/);
    expect(bodies).toEqual([]);
  });

  it("闸拿到的 currentScope 指向别的节点：零 POST", async () => {
    // 审查点名：assert 收到 block 却不核 a.blockId === block.id。
    // 这里确认记录与 currentScope 内部自洽（都是 clip-e01-g09），
    // 唯独跟真正在执行的 block 不是同一个——旧写法察觉不到。
    const block = makeBlock();
    const bodies = captureOutbound();
    const otherScope = currentScopeFor("clip-e01-g09");
    await expect(
      runCanvasBlock(deps, block as never, undefined, {
        enforceOutboundConfirmation: true,
        outboundGate: {
          currentScope: otherScope,
          confirmation: { fingerprint: "x", scope: otherScope, confirmedAt: 1 },
        },
      } as never),
    ).rejects.toThrow(/确认闸拿到的节点与本次执行的节点不一致/);
    expect(bodies).toEqual([]);
  });

  it("真正执行提交的账号与确认账号不一致：零 POST", async () => {
    // currentScope 与确认记录完全一致，但 deps.userId（入队 jobs 时真正写进去的人）
    // 是另一个账号——上下文串了，不能靠界面那一侧自说自话。
    const block = makeBlock();
    const confirmation = await confirmFor(block);
    const bodies = captureOutbound();
    await expect(
      runCanvasBlock({ ...deps, userId: "999" } as never, block as never, undefined, {
        enforceOutboundConfirmation: true,
        outboundGate: { currentScope: currentScopeFor(block.id), confirmation },
      } as never),
    ).rejects.toThrow(/当前登录账号与确认时的账号不一致/);
    expect(bodies).toEqual([]);
  });

  // 以下三条：**确认记录原样保留**，只切换当前上下文
  it("保留旧确认，只换当前账号：零 POST", async () => {
    const block = makeBlock();
    const confirmation = await confirmFor(block);
    const bodies = captureOutbound();
    await expect(
      runCanvasBlock(deps, block as never, undefined, {
        enforceOutboundConfirmation: true,
        outboundGate: {
          currentScope: currentScopeFor(block.id, { userId: "999" }),
          confirmation,
        },
      } as never),
    ).rejects.toBeInstanceOf(ManhuaOutboundConfirmationMismatchError);
    expect(bodies).toEqual([]);
  });

  it("保留旧确认，只换当前项目：零 POST", async () => {
    const block = makeBlock();
    const confirmation = await confirmFor(block);
    const bodies = captureOutbound();
    await expect(
      runCanvasBlock(deps, block as never, undefined, {
        enforceOutboundConfirmation: true,
        outboundGate: {
          currentScope: currentScopeFor(block.id, { projectVersion: "proj-b" }),
          confirmation,
        },
      } as never),
    ).rejects.toBeInstanceOf(ManhuaOutboundConfirmationMismatchError);
    expect(bodies).toEqual([]);
  });

  it("保留旧确认，只换当前节点：零 POST", async () => {
    const block = makeBlock();
    const confirmation = await confirmFor(block);
    const bodies = captureOutbound();
    await expect(
      runCanvasBlock(deps, block as never, undefined, {
        enforceOutboundConfirmation: true,
        outboundGate: {
          currentScope: currentScopeFor("clip-e01-g09"),
          confirmation,
        },
      } as never),
    ).rejects.toBeInstanceOf(ManhuaOutboundConfirmationMismatchError);
    expect(bodies).toEqual([]);
  });

  it("空账号或未确认项目：身份不完整，拒绝且零 POST", async () => {
    const block = makeBlock();
    const confirmation = await confirmFor(block);
    const bodies = captureOutbound();
    for (const bad of [
      { userId: "" },
      { workspaceId: "" },
      { projectVersion: "unconfirmed" },
    ]) {
      await expect(
        runCanvasBlock(deps, block as never, undefined, {
          enforceOutboundConfirmation: true,
          outboundGate: {
            currentScope: { ...confirmation.scope, ...bad },
            confirmation: { ...confirmation, scope: { ...confirmation.scope, ...bad } },
          },
        } as never),
      ).rejects.toBeInstanceOf(ManhuaOutboundConfirmationMismatchError);
    }
    expect(bodies).toEqual([]);
  });

  it("确认后改提示词 / 改模型 / 改参考素材：全部中止且零 POST", async () => {
    const block = makeBlock();
    const confirmation = await confirmFor(block);
    const bodies = captureOutbound();
    const variants = [
      makeBlock({ prompt: "【第1段·10s】改成收剑后退。" }),
      makeBlock({ videoModel: "seedance-2.0" }),
      makeBlock({ refImageUrl: "https://test.invalid/another.png" }),
    ];
    for (const changed of variants) {
      await expect(
        runCanvasBlock(deps, changed as never, undefined, {
          enforceOutboundConfirmation: true,
        outboundGate: { currentScope: currentScopeFor(block.id), confirmation },
        } as never),
      ).rejects.toThrow();
    }
    expect(bodies).toEqual([]);
  });

  it("中止之后不自动改参数重下单：重试仍然零 POST", async () => {
    const block = makeBlock();
    const confirmation = await confirmFor(block);
    const bodies = captureOutbound();
    const changed = makeBlock({ prompt: "【第1段·10s】改了。" });
    for (let i = 0; i < 2; i += 1) {
      await expect(
        runCanvasBlock(deps, changed as never, undefined, {
          enforceOutboundConfirmation: true,
        outboundGate: { currentScope: currentScopeFor(block.id), confirmation },
        } as never),
      ).rejects.toThrow();
    }
    expect(bodies).toEqual([]);
  });
});

/** 0914 审查 P2：首帧常已在 imageUrls 里，再算一格会让 UI 编号比实际多 */
describe("参考槽位表不重复计首帧", () => {
  it("首帧与 imageUrls 重复时只占一格，且 refCounts 与槽位表同源", async () => {
    const same = "https://test.invalid/identity.png";
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("预览不得发起任何请求");
    }));
    const preview = await previewCanvasBlockOutbound(
      deps,
      makeBlock({ refImageUrl: same, uploadedAssets: [{ kind: "image", url: same, fileName: "a.png" }] }) as never,
    );
    const unique = new Set(preview.refs.imageUrls);
    expect(preview.refs.imageUrls.length).toBe(unique.size);
    expect(preview.refCounts.image).toBe(preview.refs.imageUrls.length);
  });

  it("槽位表顺序即实际发送顺序，首帧排第一", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("预览不得发起任何请求");
    }));
    const preview = await previewCanvasBlockOutbound(deps, makeBlock() as never);
    expect(preview.refs.imageUrls[0]).toBe(String(preview.body.imageUrl || ""));
  });
});
