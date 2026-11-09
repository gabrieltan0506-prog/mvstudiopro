/**
 * 爆款复刻「视频分镜 · 找素材」渲染：按用户 id 读本机记录、段落状态小字、已采用素材秒数、预览地址来自 listAdoptions 重新签名。
 */
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { REMIX_STOCK_PICKS_KEY } from "@/lib/remixStockPicks";

const ASSET_A = `sf_${"a".repeat(48)}`;
const ASSET_B = `sf_${"b".repeat(48)}`;
const pick = (assetId: string, inSec: number, outSec: number) => ({
  assetId, requestId: "11111111-1111-4111-8111-111111111111", kind: "video", gcsUri: "gs://b/x.mp4", width: 1080, height: 1920, durationSec: 12, inSec, outSec, adoptedAt: "2026-11-09T00:00:00.000Z",
});
const storage = new Map<string, string>();
storage.set(REMIX_STOCK_PICKS_KEY, JSON.stringify({
  version: 1,
  users: {
    "7": { "2": [pick(ASSET_A, 0, 4)], "4": [pick(ASSET_B, 1, 3.5)] },
    "8": { "1": [pick(ASSET_B, 0, 2)] },
  },
}));
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => void storage.set(k, v),
  removeItem: (k: string) => void storage.delete(k),
};

const listUseQuery = vi.fn((..._a: unknown[]) => ({ data: [{ assetId: ASSET_A, url: "https://signed.test/a.mp4?sig=1" }], isLoading: false, isError: false, refetch: vi.fn() }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ stockFootage: { listAdoptions: { invalidate: vi.fn() }, getAdoption: { fetch: vi.fn() } } }),
    stockFootage: {
      listAdoptions: { useQuery: (...a: unknown[]) => listUseQuery(...a) },
      suggestKeywords: { useQuery: () => ({ data: undefined, isLoading: false, isError: false }) },
      search: { useQuery: () => ({ data: undefined, isFetching: false, error: null }) },
      adopt: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
    },
  },
}));

const segments = [
  { time: "00:00-00:02", title: "开场钩子", detail: "画面先给最痛的身体状态" },
  { time: "00:02-00:06", title: "痛点放大", detail: "切到最典型的痛点动作" },
  { time: "00:06-00:12", title: "动作与方法", detail: "展示 1 到 2 个最关键动作" },
  { time: "00:12-00:18", title: "结果与行动", detail: "结尾只收一个动作" },
];

let render: (props: Record<string, unknown>) => string;
beforeAll(async () => {
  const React = await import("react");
  (globalThis as { React?: unknown }).React = React;
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { RemixStoryboardStock } = await import("@/components/remix/RemixStoryboardStock");
  render = props => renderToStaticMarkup(React.createElement(RemixStoryboardStock, { userId: 7, segments, analyzed: true, ...props } as never));
});

describe("RemixStoryboardStock 渲染", () => {
  it("用户 7：说明文案、四段各一个「找素材」、第 2/4 段「已替换」其余「原片画面」、秒数与预览地址", () => {
    listUseQuery.mockClear();
    const html = render({});
    expect(html).toContain("结构学爆款，画面用自己的");
    expect(html).toContain("至少换 1–2 段");
    expect((html.match(/>找素材</g) ?? []).length).toBe(4);
    expect(html).toContain("已替换 2 / 4 段");
    expect((html.match(/>已替换</g) ?? []).length).toBe(2);
    expect((html.match(/>原片画面</g) ?? []).length).toBe(2);
    expect(html).toContain("已采用素材 · 4 秒");
    expect(html).toContain("已采用素材 · 2.5 秒");
    expect(html).toContain("1080×1920");
    // 预览地址来自 listAdoptions（purpose=remix）重新签名，而非本机记录
    expect(listUseQuery.mock.calls[0][0]).toEqual({ purpose: "remix", limit: 100 });
    expect(listUseQuery.mock.calls[0][1]).toMatchObject({ enabled: true });
    expect(html).toContain('src="https://signed.test/a.mp4?sig=1"');
    // 第 4 段的素材 listAdoptions 还没返回地址 → 显示暂无预览，不伪造
    expect(html).toContain("暂无预览");
    for (const t of ["00:00-00:02", "开场钩子", "痛点放大", "动作与方法", "结果与行动"]) expect(html).toContain(t);
  });

  it("用户 8：只看到自己的 1 条记录，看不到用户 7 的", () => {
    const html = render({ userId: 8 });
    expect(html).toContain("已替换 1 / 4 段");
    expect(html).toContain("已采用素材 · 2 秒");
    expect(html).not.toContain("已采用素材 · 4 秒");
  });

  it("用户 9：没有记录时不请求 listAdoptions，全部「原片画面」", () => {
    listUseQuery.mockClear();
    const html = render({ userId: 9, analyzed: false });
    expect(html).toContain("已替换 0 / 4 段");
    expect((html.match(/>原片画面</g) ?? []).length).toBe(4);
    expect(listUseQuery.mock.calls[0][1]).toMatchObject({ enabled: false });
    expect(html).toContain("还没分析参考视频");
  });

  it("反向：界面不出现供应商、许可、署名、来源等字样；按钮都是真实 button", () => {
    const html = render({});
    for (const word of ["Pexels", "pexels", "License", "许可", "署名", "来源", "作者"]) expect(html).not.toContain(word);
    const buttons = html.match(/<button[^>]*>/g) ?? [];
    expect(buttons.length).toBeGreaterThanOrEqual(4);
    for (const b of buttons) expect(b).toMatch(/type="button"/);
  });
});

describe("源码约束", () => {
  const src = readFileSync("client/src/components/remix/RemixStoryboardStock.tsx", "utf8");
  it("抽屉接法：purpose=remix / usage=insert / kind=video / portrait / 目标时长按时间段解析 / context 带段标题与段序号", () => {
    expect(src).toContain('purpose="remix"');
    expect(src).toContain('usage="insert"');
    expect(src).toContain('kind="video"');
    expect(src).toContain('orientation="portrait"');
    expect(src).toContain("targetDurationSec={parseSegmentDurationSec(drawerSegment.time)}");
    expect(src).toContain("context={{ note: drawerSegment.title, segmentId: drawerSegmentId! }}");
    expect(src).toContain("title={`为「${drawerSegment.title}」找素材`}");
  });
  it("不接成片/导出，不出现供应商与许可字样", () => {
    for (const word of ["Pexels", "pexels", "License", "署名", "postProd", "renderJob", "下载成片"]) expect(src).not.toContain(word);
  });
});
