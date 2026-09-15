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

  it("溯不回 https 的本机地址：绝不出现在出站请求里", async () => {
    // 这里不断言「必须抛错」——该引擎未必强制要图，抛不抛是另一条产品规则。
    // 真正要保住的是：溯不回 https 的地址一个字节都不能发给供应商。
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("预览不得发起任何请求");
    }));
    const orphan = "blob:http://localhost/never-registered";
    const preview = await previewCanvasBlockOutbound(deps, clip(orphan) as never);
    const all = JSON.stringify([preview.body, preview.refs]);
    expect(all.includes(orphan), "溯不回的本机地址被发出去了").toBe(false);
    expect(all.includes("blob:"), "出站里出现了 blob:").toBe(false);
    expect(all.includes("local-media:"), "出站里出现了 local-media:").toBe(false);
  });
});
