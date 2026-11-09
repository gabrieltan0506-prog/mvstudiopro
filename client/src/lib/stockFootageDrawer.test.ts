import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { StockFootageAssetView, StockFootageCandidate } from "@shared/stockFootage";
import {
  PENDING_KEY,
  PENDING_MAX_AGE_MS,
  PENDING_MAX_ITEMS,
  buildStockPick,
  candidateShortBySec,
  defaultMinDurationSec,
  fallbackQueryFromText,
  fmtDuration,
  fmtSec,
  isFreshPending,
  keywordSourceText,
  newRequestId,
  orientationLabel,
  pendingMatchesContext,
  readPending,
  writePending,
  type PendingAdoption,
} from "@/components/stockFootage/stockFootageModel";

function memoryStorage(initial?: string) {
  const map = new Map<string, string>();
  if (initial !== undefined) map.set(PENDING_KEY, initial);
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), map };
}

const NOW = 1_800_000_000_000;
function pendingItem(over: Partial<PendingAdoption> = {}): PendingAdoption {
  return { requestId: "11111111-1111-4111-8111-111111111111", providerAssetId: "123", kind: "video", purpose: "mv", usage: "insert", context: {}, startedAt: NOW, ...over };
}

function asset(over: Partial<StockFootageAssetView> = {}): StockFootageAssetView {
  return {
    assetId: `sf_${"a".repeat(48)}`,
    requestId: "11111111-1111-4111-8111-111111111111",
    kind: "video",
    purpose: "mv",
    usage: "insert",
    gcsUri: "gs://test-bucket/a.mp4",
    mimeType: "video/mp4",
    bytes: 10,
    sha256: "0".repeat(64),
    width: 1920,
    height: 1080,
    durationSec: 10,
    source: {
      provider: "pexels",
      providerAssetId: "123",
      pageUrl: "https://example.test/p",
      author: { name: "Someone Author" },
      license: { name: "L", url: "https://example.test/l" },
      downloadedFrom: "https://example.test/f",
      providerFileId: "1",
      retrievedAt: "2026-11-08T00:00:00Z",
    },
    context: {},
    adoptedAt: "2026-11-08T00:00:00Z",
    url: "https://signed.test/a.mp4",
    ...over,
  };
}

describe("本机待办（同步落盘 / 同编号续做 / 成功清除的存储层）", () => {
  it("正向：写入后可读回，保留裁点", () => {
    const s = memoryStorage();
    writePending([pendingItem({ trim: { inSec: 1, outSec: 5 } })], s);
    expect(readPending(s, NOW)).toEqual([pendingItem({ trim: { inSec: 1, outSec: 5 } })]);
  });
  it("边界：最多保留最近 50 条；超过 7 天的过期丢弃", () => {
    const s = memoryStorage();
    writePending(Array.from({ length: PENDING_MAX_ITEMS + 5 }, (_, i) => pendingItem({ requestId: `r${i}` })), s);
    const list = readPending(s, NOW);
    expect(list).toHaveLength(PENDING_MAX_ITEMS);
    expect(list[0].requestId).toBe("r5");
    expect(readPending(s, NOW + PENDING_MAX_AGE_MS)).toEqual([]);
  });
  it("反向：损坏的 JSON、非数组、缺编号条目、存储抛错都不崩", () => {
    expect(readPending(memoryStorage("{oops"), NOW)).toEqual([]);
    expect(readPending(memoryStorage('{"a":1}'), NOW)).toEqual([]);
    expect(readPending(memoryStorage(JSON.stringify([null, { startedAt: NOW }, pendingItem()])), NOW)).toEqual([pendingItem()]);
    const throwing = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("quota"); } };
    expect(readPending(throwing, NOW)).toEqual([]);
    expect(() => writePending([pendingItem()], throwing)).not.toThrow();
    expect(readPending(undefined, NOW)).toEqual([]);
  });
  it("刚发起 2 分钟内的待办不查询状态", () => {
    expect(isFreshPending({ startedAt: NOW - 60_000 }, NOW)).toBe(true);
    expect(isFreshPending({ startedAt: NOW - 2 * 60_000 }, NOW)).toBe(false);
  });
  it("抽屉只续做同用途、同项目/镜头/段落的待办", () => {
    const p = pendingItem({ context: { projectId: "p1", shotId: "s2" } });
    expect(pendingMatchesContext(p, "mv", { projectId: "p1", shotId: "s2", note: "x" })).toBe(true);
    expect(pendingMatchesContext(p, "mv", { projectId: "p1", shotId: "s3" })).toBe(false);
    expect(pendingMatchesContext(p, "marketing", { projectId: "p1", shotId: "s2" })).toBe(false);
    expect(pendingMatchesContext(pendingItem(), "mv", undefined)).toBe(true);
  });
  it("编号为 UUID", () => {
    expect(newRequestId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("抽屉展示与裁点交付", () => {
  it("时长/画幅文案", () => {
    expect(fmtDuration(undefined)).toBe("");
    expect(fmtDuration(8.4)).toBe("8秒");
    expect(fmtDuration(75)).toBe("1:15");
    expect(fmtSec(4)).toBe("4秒");
    expect(fmtSec(3.46)).toBe("3.5秒");
    expect(orientationLabel(1920, 1080)).toBe("横屏");
    expect(orientationLabel(1080, 1920)).toBe("竖屏");
    expect(orientationLabel(1000, 1050)).toBe("方形");
    expect(orientationLabel(0, 10)).toBe("");
  });
  it("短于镜头 N 秒：视频按一位小数向上取；照片、无时长、无目标为 0", () => {
    expect(candidateShortBySec({ kind: "video", durationSec: 3.5 }, 5)).toBe(1.5);
    expect(candidateShortBySec({ kind: "video", durationSec: 4.96 }, 5)).toBe(0.1);
    expect(candidateShortBySec({ kind: "video", durationSec: 8 }, 5)).toBe(0);
    expect(candidateShortBySec({ kind: "photo" }, 5)).toBe(0);
    expect(candidateShortBySec({ kind: "video" }, 5)).toBe(0);
    expect(candidateShortBySec({ kind: "video", durationSec: 3 }, undefined)).toBe(0);
  });
  it("「至少 N 秒」默认取镜头时长整秒，非法/过短时不限", () => {
    expect(defaultMinDurationSec(4.8)).toBe(4);
    expect(defaultMinDurationSec(900)).toBe(600);
    expect(defaultMinDurationSec(0.5)).toBeUndefined();
    expect(defaultMinDurationSec(undefined)).toBeUndefined();
    expect(defaultMinDurationSec(Number.NaN)).toBeUndefined();
  });
  it("关键词兜底：压缩空白并截断到接口上限", () => {
    expect(fallbackQueryFromText("  雨夜  城市\n街道 ")).toBe("雨夜 城市 街道");
    expect(fallbackQueryFromText("字".repeat(300))).toHaveLength(100);
    expect(fallbackQueryFromText(undefined)).toBe("");
    expect(keywordSourceText("a".repeat(2000))).toHaveLength(300);
    expect(keywordSourceText("   ")).toBe("");
  });
  it("视频交付按资产时长再夹一次；照片固定 0→目标（缺省 3 秒）", () => {
    expect(buildStockPick(asset(), { inSec: 2, outSec: 6 }, 4)).toMatchObject({ inSec: 2, outSec: 6 });
    // 候选元数据比入库文件长：入点越界被夹回
    expect(buildStockPick(asset({ durationSec: 5 }), { inSec: 4, outSec: 8 }, 4)).toMatchObject({ inSec: 1, outSec: 5 });
    // 续做时没有裁点：按镜头时长从头取
    expect(buildStockPick(asset(), undefined, 4)).toMatchObject({ inSec: 0, outSec: 4 });
    expect(buildStockPick(asset(), undefined, undefined)).toMatchObject({ inSec: 0, outSec: 10 });
    expect(buildStockPick(asset({ durationSec: undefined }), undefined, 4)).toMatchObject({ inSec: 0, outSec: 4 });
    const photo = asset({ kind: "photo", durationSec: undefined });
    expect(buildStockPick(photo, { inSec: 2, outSec: 6 }, 5)).toMatchObject({ inSec: 0, outSec: 5 });
    expect(buildStockPick(photo, undefined, undefined)).toMatchObject({ inSec: 0, outSec: 3 });
  });
});

// ── 组件级：用服务端渲染检查抽屉结构（node 环境，无 DOM 交互） ──
const candidates: StockFootageCandidate[] = [
  { provider: "pexels", providerAssetId: "101", kind: "video", pageUrl: "https://example.test/v/101", previewImageUrl: "https://img.test/101.jpg", previewVideoUrl: "https://vid.test/101.mp4", width: 1920, height: 1080, durationSec: 3.5, author: { name: "Jane Photographer", url: "https://example.test/u/jane" }, alt: "rainy street" },
  { provider: "pexels", providerAssetId: "102", kind: "video", pageUrl: "https://example.test/v/102", previewImageUrl: "https://img.test/102.jpg", width: 1080, height: 1920, durationSec: 12, author: { name: "John Filmmaker" } },
];
const suggestUseQuery = vi.fn((..._args: unknown[]) => ({ data: undefined, isLoading: true, isError: false }));
const searchUseQuery = vi.fn((..._args: unknown[]) => ({ data: { candidates, hasMore: true, page: 1 }, isFetching: false, error: null }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ stockFootage: { listAdoptions: { invalidate: vi.fn() }, getAdoption: { fetch: vi.fn() } } }),
    stockFootage: {
      suggestKeywords: { useQuery: (...a: unknown[]) => suggestUseQuery(...a) },
      search: { useQuery: (...a: unknown[]) => searchUseQuery(...a) },
      adopt: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
    },
  },
}));

let render: (props: Record<string, unknown>) => string;
beforeAll(async () => {
  const React = await import("react");
  (globalThis as { React?: unknown }).React = React;
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { StockFootageDrawer } = await import("@/components/stockFootage/StockFootageDrawer");
  render = props => renderToStaticMarkup(React.createElement(StockFootageDrawer, { onClose() {}, onPick() {}, title: "为镜头02找素材", purpose: "mv", ...props } as never));
});

describe("StockFootageDrawer 渲染", () => {
  it("关闭时不渲染", () => {
    expect(render({ open: false })).toBe("");
  });
  it("打开：对话框、标题、候选单选、时长徽标、尺寸、短于镜头提示；默认确认文案", () => {
    const html = render({ open: true, targetDurationSec: 5, sourceText: "雨夜的城市街道" });
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("为镜头02找素材");
    expect(html).toContain('role="radiogroup"');
    expect((html.match(/role="radio"/g) ?? []).length).toBe(2);
    expect(html).toContain("1920×1080");
    expect(html).toContain("横屏");
    expect(html).toContain("竖屏");
    expect(html).toContain("短于镜头 1.5 秒");
    expect(html).toContain("采用到镜头 02");
    expect(html).toContain("正在根据描述生成关键词");
    // 未选中候选时确认按钮不可用
    expect(html).toMatch(/<button type="button" disabled=""[^>]*>采用到镜头 02<\/button>/);
    // 步骤条与候选区标题（有结果未选 → 第 ② 步高亮）
    expect(html).toContain('aria-label="步骤"');
    expect(html).toContain('aria-current="step"');
    expect(html).toContain("第 ② 步 · 点一张候选预览（2 个");
    expect(html).toContain("先在上方点选一张候选");
    // 一屏 6 个
    expect(searchUseQuery.mock.calls.at(-1)?.[0]).toMatchObject({ perPage: 6 });
  });
  it("关键词：无 initialQuery 时按描述调用生成；有 initialQuery 时不调用；筛选默认至少=镜头时长", () => {
    suggestUseQuery.mockClear();
    searchUseQuery.mockClear();
    render({ open: true, targetDurationSec: 6.5, sourceText: "  雨夜的城市街道 ", orientation: "portrait" });
    expect(suggestUseQuery.mock.calls[0][0]).toEqual({ text: "雨夜的城市街道", purpose: "mv", orientation: "portrait" });
    expect(suggestUseQuery.mock.calls[0][1]).toMatchObject({ enabled: true });
    expect(searchUseQuery.mock.calls[0][0]).toMatchObject({ minDurationSec: 6, orientation: "portrait", kind: "video" });

    suggestUseQuery.mockClear();
    searchUseQuery.mockClear();
    const html = render({ open: true, initialQuery: "city night rain", sourceText: "雨夜" });
    expect(suggestUseQuery.mock.calls[0][1]).toMatchObject({ enabled: false });
    expect(searchUseQuery.mock.calls[0][0]).toMatchObject({ query: "city night rain" });
    expect(searchUseQuery.mock.calls[0][0]).not.toHaveProperty("minDurationSec");
    expect(html).toContain('value="city night rain"');
  });
  it("照片：不带时长筛选，自定义确认文案", () => {
    searchUseQuery.mockClear();
    const html = render({ open: true, kind: "photo", initialQuery: "forest", targetDurationSec: 4, confirmLabel: "用作参考" });
    expect(searchUseQuery.mock.calls[0][0]).toMatchObject({ kind: "photo" });
    expect(searchUseQuery.mock.calls[0][0]).not.toHaveProperty("minDurationSec");
    expect(html).not.toContain("至少（秒");
    expect(html).toContain("用作参考");
  });
  it("反向：用途与用法冲突时只显示原因，不发搜索", () => {
    searchUseQuery.mockClear();
    const html = render({ open: true, purpose: "manhua", usage: "insert", initialQuery: "forest" });
    expect(html).toContain("漫剧只能把图库素材用作参考图或无人物空镜");
    expect(searchUseQuery.mock.calls[0][1]).toMatchObject({ enabled: false });
    expect(html).not.toContain('role="radiogroup"');
  });
  it("反向：界面不出现作者、来源、许可、供应商等字样；按钮都是真实 button 且触控 ≥44px", () => {
    const html = render({ open: true, targetDurationSec: 5, initialQuery: "rain" });
    for (const word of ["Pexels", "pexels", "License", "许可", "作者", "来源", "Jane Photographer", "John Filmmaker", "example.test", "rainy street", "编号", "入库"]) expect(html).not.toContain(word);
    const buttons = html.match(/<button[^>]*>/g) ?? [];
    expect(buttons.length).toBeGreaterThan(3);
    for (const b of buttons) expect(b).toMatch(/type="(button|submit)"/);
    for (const b of buttons.filter(b => !b.includes('tabindex="-1"'))) expect(b).toMatch(/min-h-11|h-11/);
  });
});

describe("源码约束", () => {
  const drawer = readFileSync("client/src/components/stockFootage/StockFootageDrawer.tsx", "utf8");
  const panel = readFileSync("client/src/components/stockFootage/StockFootagePanel.tsx", "utf8");
  const hook = readFileSync("client/src/components/stockFootage/useStockFootageAdoption.ts", "utf8");
  it("抽屉与面板共用采用 hook，不各自直接调用采用接口", () => {
    expect(drawer).toContain("useStockFootageAdoption(");
    expect(panel).toContain("useStockFootageAdoption(");
    expect(drawer).not.toContain("stockFootage.adopt.useMutation");
    expect(panel).not.toContain("stockFootage.adopt.useMutation");
  });
  it("hook 先落本机待办再发请求，待办读写同步落盘", () => {
    const start = hook.slice(hook.indexOf("const startAdoption"));
    expect(start.indexOf("updatePending(list => [...list, item])")).toBeLessThan(start.indexOf("return runAdopt(item)"));
    expect(hook).toMatch(/const next = fn\(readPending\(\)\);\s*writePending\(next\);\s*setPending\(next\);/);
  });
  it("裁点经 clampStockTrim，交付经 buildStockPick", () => {
    expect(drawer).toContain("clampStockTrim(");
    expect(drawer).toContain("buildStockPick(asset");
  });
});

describe("找素材抽屉流程辅助", async () => {
  const m = await import("@/components/stockFootage/stockFootageModel");
  it("主按钮文案按标题推导目标，推不出退回默认", () => {
    expect(m.stockDrawerConfirmLabel("为镜头02找素材")).toBe("采用到镜头 02");
    expect(m.stockDrawerConfirmLabel("为第 3 段找素材")).toBe("采用到第 3 段");
    expect(m.stockDrawerConfirmLabel("为第 2 段找无人物空镜")).toBe("采用到第 2 段");
    expect(m.stockDrawerConfirmLabel("为口播 第 4 段 找补充画面")).toBe("采用到口播第 4 段");
    expect(m.stockDrawerConfirmLabel("为本集场景找参考图")).toBe("采用为场景参考");
    expect(m.stockDrawerConfirmLabel("随便什么")).toBe("采用并绑定");
    expect(m.stockDrawerConfirmLabel("随便什么", "替换")).toBe("替换");
  });
  it("步骤判定：无结果①、有结果未选②、已选③；一屏 6 个", () => {
    expect(m.stockDrawerStep({ hasQuery: false, hasCandidates: false, hasSelected: false })).toBe(1);
    expect(m.stockDrawerStep({ hasQuery: true, hasCandidates: false, hasSelected: false })).toBe(1);
    expect(m.stockDrawerStep({ hasQuery: true, hasCandidates: true, hasSelected: false })).toBe(2);
    expect(m.stockDrawerStep({ hasQuery: true, hasCandidates: true, hasSelected: true })).toBe(3);
    expect(m.STOCK_DRAWER_PER_PAGE).toBe(6);
    expect(m.STOCK_DRAWER_GUIDE.length).toBe(4);
  });
  it("候选排序：时长够且画幅符合的在前，稳定且不丢候选", () => {
    const list = [
      { kind: "video" as const, durationSec: 2, width: 1080, height: 1920 },   // 短
      { kind: "video" as const, durationSec: 9, width: 1920, height: 1080 },   // 横，画幅不符
      { kind: "video" as const, durationSec: 9, width: 1080, height: 1920 },   // 合适
      { kind: "video" as const, durationSec: 12, width: 1080, height: 1920 },  // 合适
    ];
    const ranked = m.rankStockCandidates(list, 5, "portrait");
    expect(ranked.map(c => [c.durationSec, c.fit])).toEqual([[9, true], [12, true], [2, false], [9, false]]);
    expect(m.rankStockCandidates(list, undefined, undefined).map(c => c.fit)).toEqual([true, true, true, true]);
  });
});
