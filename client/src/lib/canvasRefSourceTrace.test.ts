/**
 * 0915 审查实证的缺陷：本机参考被**提前过滤**。
 *
 * toHttpsImageUrls 本来就会把 blob: / local-media: 溯源回 https，
 * 但参考池在到它之前先按 `^https?://` 筛了一遍，
 * 回灌后的本机地址在筛选那一步就被静默丢掉——
 * 表现是「来源映射明明正确，却报缺图片」。
 *
 * 这组测试钉住：**溯源发生在筛选、去重、容量分配之前**，
 * 且**绝不把 blob: 直接发给供应商**。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./flyHealthGate", () => ({
  withFlyHealthGate: async (_o: string, run: () => Promise<unknown>) => run(),
}));
vi.mock("./longJobsFlyOrigin", () => ({
  withLongJobsFlyDirect: (url: string) => url,
  flyHealthProbeOriginForUrl: () => "https://test.invalid",
}));

import { previewCanvasBlockOutbound } from "./canvasRunBlock";
import { rememberLocalMediaDisplay, makeLocalMediaPointer } from "./manhuaLocalMediaStore";

const deps = { userRole: "admin" as const, userId: "t", optimizeCopy: async () => "" };
const SOURCE = "https://example.com/keyart-e01.jpg";

afterEach(() => vi.unstubAllGlobals());

const clip = (refImageUrl: string) => ({
  id: "clip-e01-g01",
  kind: "video" as const,
  prompt: "0–10s：阿菁推门，灯笼光扫过面颊。",
  videoModel: "seedance-2.5",
  aspectRatio: "9:16" as const,
  episodeIndex: 1,
  refImageUrl,
});

describe("本机展示地址的参考：先溯源，再筛选", () => {
  it.each([
    ["blob:", "blob:http://localhost/keyart-e01"],
    ["local-media:", makeLocalMediaPointer("rec-trace")],
  ])("%s 参考能溯源回 https 并真的进入出站请求", async (_label, display) => {
    rememberLocalMediaDisplay({ displayUrl: display, pointer: makeLocalMediaPointer("rec-trace"), sourceUrl: SOURCE });
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("预览不得发起任何请求");
    }));

    const preview = await previewCanvasBlockOutbound(deps, clip(display) as never);
    const urls = [
      ...(preview.refs.imageUrls || []),
      String((preview.body as Record<string, unknown>).imageUrl ?? ""),
      ...(((preview.body as Record<string, unknown>).imageUrls as string[] | undefined) ?? []),
    ].filter(Boolean);

    expect(urls.length, "参考被丢光了——这就是那个缺陷").toBeGreaterThan(0);
    expect(urls, "溯源后的 https 原链没进出站").toContain(SOURCE);
    // 绝不把本机地址发给供应商
    expect(urls.some((u) => u.startsWith("blob:")), "blob: 被直接发出去了").toBe(false);
    expect(urls.some((u) => u.startsWith("local-media:")), "local-media: 被直接发出去了").toBe(
      false,
    );
  });

  it("溯不回 https 的本机地址：报出具体的槽位与来源，并且不出站", async () => {
    // 0915 复审：这里的正确行为不是「静默不发」，而是**明确拒绝**——
    // 用户已经选了图，它凭空消失比报错更糟。
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("预览不得发起任何请求");
    }));
    const orphan = "blob:http://localhost/never-registered";
    await expect(
      previewCanvasBlockOutbound(deps, clip(orphan) as never),
    ).rejects.toThrow(/已选参考解析不到可提交的来源[\s\S]*never-registered/);
  });
});

/**
 * 0915 复审新增的三条。统一顺序是：
 *   本机溯源 → 合法站内路径绝对化 → 可提交协议校验 → 去重 → 容量/绑定规划
 */
describe("参考规范化：顺序、早筛与失败语义", () => {
  it("显式选过的参考解析不出来：明确报错，不静默丢（哪怕另有一张有效图）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("预览不得发起任何请求");
    }));
    const good = "https://example.com/still-ok.jpg";
    const orphan = "blob:http://localhost/no-source-at-all";
    // 有一张有效静帧 + 一张溯不回来源的显式引用：
    // 旧行为是预览照常成功、那张引用凭空消失。
    await expect(
      previewCanvasBlockOutbound(
        deps,
        { ...clip(good), editFusionUrls: [orphan] } as never,
      ),
    ).rejects.toThrow(/已选参考解析不到可提交的来源/);
  });

  it("本来就没有参考的合法用法不受影响（不能一刀切成报错）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("预览不得发起任何请求");
    }));
    const bare = {
      id: "clip-e01-g01",
      kind: "video" as const,
      prompt: "0–10s：空镜，雨落在青石板上。",
      videoModel: "seedance-2.5",
      aspectRatio: "9:16" as const,
      episodeIndex: 1,
    };
    const preview = await previewCanvasBlockOutbound(deps, bare as never);
    expect(preview.engine).toBe("seedance-2.5");
  });

  it("溯源得到站内相对路径：绝对化后仍进出站，不被协议筛选丢掉", async () => {
    // node 测试环境默认没有 location，absolutize 无从取 origin；
    // 生产在浏览器里总有 origin，这里补上以还原真实条件。
    vi.stubGlobal("location", { origin: "https://app.test.invalid" });
    const display = "blob:http://localhost/site-relative";
    rememberLocalMediaDisplay({
      displayUrl: display,
      pointer: makeLocalMediaPointer("rec-rel"),
      sourceUrl: "/manhua-assets/a.png",
    });
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("预览不得发起任何请求");
    }));

    const preview = await previewCanvasBlockOutbound(deps, clip(display) as never);
    const all = JSON.stringify([preview.body, preview.refs]);
    expect(all.includes("manhua-assets/a.png"), "站内相对路径被丢掉了").toBe(true);
    expect(all.includes("blob:"), "出站里出现了 blob:").toBe(false);
  });
});

describe("资产图：规范化必须早于 resolveManhuaAssetImageBindRows", () => {
  it("@角色 的资产路径是本机地址时，身份图仍进得了 refs", async () => {
    // 0915 复审 P1 实测：resolveManhuaAssetImageBindRows 内部先过
    // isBindableAssetPath，它已排除 blob:/local-media:，
    // 之后再 map 溯源救不回**已经被删掉的整行**——身份图整张消失，只剩静帧。
    const display = "blob:http://localhost/asset-c1";
    rememberLocalMediaDisplay({
      displayUrl: display,
      pointer: makeLocalMediaPointer("rec-c1"),
      sourceUrl: "https://example.com/char-c1.png",
    });
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("预览不得发起任何请求");
    }));

    const still = "https://example.com/still-ok.jpg";
    const preview = await previewCanvasBlockOutbound(
      {
        ...deps,
        manhuaAssetPathById: { c1: display },
      } as never,
      {
        id: "clip-e01-g01",
        kind: "video" as const,
        prompt:
          "【资产·Image对照】\n@角色1|id=c1|label=黑奇|kind=角色|duty=identity\n\n【秒轴】\n0–10s：黑奇自梁上落地。",
        videoModel: "seedance-2.5",
        aspectRatio: "9:16" as const,
        episodeIndex: 1,
        refImageUrl: still,
      } as never,
    );

    const all = JSON.stringify([preview.body, preview.refs]);
    expect(all.includes("char-c1.png"), "身份图整行被早筛删掉了").toBe(true);
    expect(all.includes("blob:"), "出站里出现了 blob:").toBe(false);
  });
});

/**
 * 0915 复审新增两条：逐处补漏改成**统一清单**之后，这两种形态必须一起被覆盖。
 */
describe("引用清单：资产与导演板一起走同一套解析与失败语义", () => {
  const clipWithAsset = (over: Record<string, unknown> = {}) => ({
    id: "clip-e01-g01",
    kind: "video" as const,
    prompt:
      "【资产·Image对照】\n@角色1|id=c1|label=黑奇|kind=角色|duty=identity\n\n【秒轴】\n0–10s：黑奇自梁上落地。",
    videoModel: "seedance-2.5",
    aspectRatio: "9:16" as const,
    episodeIndex: 1,
    refImageUrl: "https://example.com/still-ok.jpg",
    ...over,
  });

  it("断链资产：即便另有有效静帧，也必须明确报错而不是悄悄少一张", async () => {
    // 旧行为：resolveManhuaAssetImageBindRows 先按 isBindableAssetPath 过滤，
    // 整行消失；只要还有静帧，预览照常成功——用户看到的和实际发出的不是一回事。
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("预览不得发起任何请求");
    }));
    await expect(
      previewCanvasBlockOutbound(
        { ...deps, manhuaAssetPathById: { c1: "blob:http://localhost/asset-no-source" } } as never,
        clipWithAsset() as never,
      ),
    ).rejects.toThrow(/已选参考解析不到可提交的来源[\s\S]*资产图 @角色1/);
  });

  it("导演板是本机地址：溯源后必须进参考列表，不能漏接", async () => {
    const display = "blob:http://localhost/board-e01";
    rememberLocalMediaDisplay({
      displayUrl: display,
      pointer: makeLocalMediaPointer("rec-board"),
      sourceUrl: "https://example.com/board-e01.png",
    });
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("预览不得发起任何请求");
    }));

    const preview = await previewCanvasBlockOutbound(
      {
        ...deps,
        manhuaAssetPathById: { c1: "https://example.com/char-c1.png" },
        manhuaDirectorBoardUrlByEpisode: { 1: display },
      } as never,
      clipWithAsset() as never,
    );
    const all = JSON.stringify([preview.body, preview.refs]);
    expect(all.includes("board-e01.png"), "导演板漏接规范化，没进参考列表").toBe(true);
    expect(all.includes("blob:"), "出站里出现了 blob:").toBe(false);
  });
});
