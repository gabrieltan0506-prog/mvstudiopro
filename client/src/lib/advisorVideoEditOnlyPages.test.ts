import { readFileSync } from "node:fs";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { advisorProjectRef } from "@shared/manhuaCreativeAdvisor";

const quotaInputs: unknown[] = [];
vi.mock("@/lib/trpc", () => ({
  trpc: {
    mvAnalysis: {
      getManhuaAdvisorQuota: {
        useQuery: (input: unknown) => {
          quotaInputs.push(input);
          return { data: { remaining: 5, price: 12, exempt: false }, isError: false, refetch: async () => ({}) };
        },
      },
    },
  },
}));
vi.mock("streamdown", () => ({ Streamdown: () => null }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 7 }, isAuthenticated: true }) }));

import {
  createAdvisorVideoEditControl,
  createAdvisorVideoEditHub,
  createVideoEditOnlyAdvisorAction,
  videoEditOnlyAdvisorProject,
} from "./advisorVideoEditControl";

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return { get length() { return m.size; }, key: i => Array.from(m.keys())[i] ?? null, getItem: k => m.get(k) ?? null, setItem: (k, v) => void m.set(k, String(v)), removeItem: k => void m.delete(k), clear: () => m.clear() };
}
const sig = () => new AbortController().signal;
const CODE_ID = "6f9619ff-8b86-4d01-b42d-00cf4fc964ff";
const DRAFT_ID = "7f9619ff-8b86-4d01-b42d-00cf4fc964ff";
const err = (p: Promise<unknown>) => p.then(() => "ok", (e: Error) => e.message);

/** 与 HomePhotoVideoUpscale / MarketingProductionPanel 登记的控件同构：清单 = 当前成片，open = 打开「局部修改」并预填。 */
function pageEntry(target: { id: string; label: string }, durationSec: number) {
  const open = vi.fn();
  const control = createAdvisorVideoEditControl({
    targets: () => [{ ...target, url: `https://cdn.test/${encodeURIComponent(target.id)}.mp4`, durationSec }],
    open,
  });
  return { open, control };
}

describe.each([
  { page: "代码动画", key: "code-motion", scope: `code-motion:${CODE_ID}`, target: { id: `code-motion:${CODE_ID}`, label: "代码动画成片" } },
  { page: "营销", key: "marketing-final", scope: `marketing:${DRAFT_ID}`, target: { id: "marketing-final", label: "营销成片" } },
])("$page 页顾问：清单列成片、预填打开面板、其他动作拒绝", ({ key, scope, target }) => {
  it("inspect 列出对应成片；prefill 只打开面板预填、不提交；其他动作按现有方式拒绝", async () => {
    const hub = createAdvisorVideoEditHub();
    const act = createVideoEditOnlyAdvisorAction(hub, scope);
    // 未生成成片：清单为空并给原因，预填拒绝
    expect(JSON.parse(await act({ action: "inspect" }, sig()))).toMatchObject({ scope, operations: ["videoEdit"], videoEdit: { videos: [] } });
    expect(await err(act({ action: "videoEdit", operation: "inspect" }, sig()))).toContain("没有可局部修改的成片");
    const entry = pageEntry(target, 42.3);
    hub.register(key)(entry.control);
    const inv = JSON.parse(await act({ action: "inspect" }, sig()));
    expect(inv.videoEdit.videos).toEqual([{ targetId: target.id, label: target.label, durationSec: 42.3 }]);
    expect(JSON.parse(await act({ action: "videoEdit", operation: "inspect" }, sig())).videos[0].targetId).toBe(target.id);
    const r = JSON.parse(await act({ action: "videoEdit", operation: "prefill", targetId: target.id, startSec: 10, endSec: 16, promptZh: "背景换成办公室，人物不变" }, sig()));
    expect(r).toMatchObject({ status: "prefilled", targetId: target.id, startSec: 10, endSec: 16 });
    expect(r.note).toContain("尚未提交、未扣积分");
    expect(entry.open).toHaveBeenCalledTimes(1);
    expect(entry.open.mock.calls[0]![0]).toMatchObject({ targetId: target.id, startSec: 10, endSec: 16, promptZh: "背景换成办公室，人物不变" });
    for (const other of [
      { action: "effects", tool: "vfx", operation: "inspect" },
      { action: "edit", operation: "inspect", episode: 1 },
      { action: "scoring", operation: "inspect" },
    ])
      expect(await err(act(other as never, sig()))).toBe("此操作请使用对应制作入口");
    expect(entry.open).toHaveBeenCalledTimes(1);
    hub.register(key)(null);
    expect(await err(act({ action: "videoEdit", operation: "prefill", targetId: target.id, startSec: 10, endSec: 16, promptZh: "改背景" }, sig()))).toContain("没有可局部修改的成片");
  });
});

describe("两页顾问上下文与额度查询带作品类型", () => {
  it("上下文带 code_motion / marketing 与作品编号；含链接的正文省略而不阻断", () => {
    const code = videoEditOnlyAdvisorProject({ kind: "code_motion", projectId: CODE_ID, title: "季度汇报", stageZh: "代码动画成片", body: "见 https://x.test/a 的数据" });
    expect(code.context).toMatchObject({ projectKind: "code_motion", projectId: CODE_ID, stage: "final" });
    expect(code.context.episodeBody).not.toMatch(/https?:/);
    expect(advisorProjectRef(code.context)).toEqual({ kind: "code_motion", projectId: CODE_ID });
    const mk = videoEditOnlyAdvisorProject({ kind: "marketing", projectId: DRAFT_ID, title: "营销成片", stageZh: "营销成片" });
    expect(advisorProjectRef(mk.context)).toEqual({ kind: "marketing", projectId: DRAFT_ID });
    // 前台不出现模型名 / 通道名
    expect(JSON.stringify([code, mk])).not.toMatch(/Seedance|EvoLink|Gemini|Vertex|GPT|Claude|GLM|DeepSeek/i);
  });
  it("现有顾问面板按两页上下文查询额度：带 projectId 与作品类型", async () => {
    (globalThis as { React?: typeof React }).React = React; // vitest 按经典 JSX 转译组件
    const { default: Panel } = await import("@/components/canvas/ManhuaCreativeAdvisorPanel");
    for (const [kind, projectId] of [["code_motion", CODE_ID], ["marketing", DRAFT_ID]] as const) {
      quotaInputs.length = 0;
      const project = videoEditOnlyAdvisorProject({ kind, projectId, title: "作品", stageZh: "成片" });
      renderToStaticMarkup(createElement(Panel, { open: true, onClose: () => {}, userId: "7", projectId, confirmedProjectVersion: `x:${projectId}`, project, storage: memoryStorage(), templates: [], onRequestTrial: () => {} }));
      expect(quotaInputs[0]).toEqual({ projectId, projectKind: kind });
    }
  });
});

describe("两页接线", () => {
  const src = (f: string) => readFileSync(f, "utf8");
  it("代码动画页：页面汇总登记成片入口，顾问带 code_motion 与作品编号", () => {
    const page = src("client/src/pages/CodeMotionStudio.tsx");
    expect(page).toContain("const advisorVideoEditHub = useMemo(() => createAdvisorVideoEditHub(), []);");
    expect(page).toContain('onAdvisorVideoEditControl={advisorVideoEditHub.register("code-motion")}');
    expect(page).toMatch(/<VideoEditOnlyAdvisor[^>]*hub=\{advisorVideoEditHub\}[\s\S]{0,200}work=\{\{ kind: "code_motion", projectId: project\.id/);
  });
  it("营销页：制作稿面板登记成片入口并回报稿号，顾问带 marketing 与稿号", () => {
    const page = src("client/src/pages/PlatformPage.tsx");
    const panel = src("client/src/components/platform/MarketingProductionPanel.tsx");
    expect(page).toContain('onAdvisorVideoEditControl={marketingAdvisorHub.register("marketing-final")}');
    expect(page).toContain("onDraftIdChange={draftId => setMarketingDraft(");
    expect(page).toMatch(/hub=\{marketingAdvisorHub\}[\s\S]{0,200}work=\{\{ kind: "marketing", projectId: marketingDraftId/);
    expect(panel).toContain("useEffect(() => { draftIdReport.current?.(draft.draftId); }, [draft.draftId]);");
  });
  it("宿主：videoEdit 走页面汇总，首次点开才加载面板，不新造顾问", () => {
    const host = src("client/src/components/canvas/VideoEditOnlyAdvisor.tsx");
    expect(host).toContain('lazy(() => import("./ManhuaCreativeAdvisorPanel"))');
    expect(host).toContain("createVideoEditOnlyAdvisorAction(props.hub, scope)");
    expect(host).toContain("{loaded && project && (");
    expect(host).not.toMatch(/queueVideoPartialEdit|deductCredits/);
  });
});
