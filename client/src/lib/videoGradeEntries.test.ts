import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.hoisted(async () => {
  (globalThis as { React?: unknown }).React = await import("react");
});

const queued: unknown[] = [];
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    mvAnalysis: {
      queuePostProd: { useMutation: () => ({ mutateAsync: async (input: unknown) => (queued.push(input), { jobId: "job-1" }) }) },
      getPostProdJob: { useQuery: () => ({ data: undefined }) },
    },
  },
}));
vi.mock("@/components/canvas/VideoGradePanel", () => ({
  VideoGradePanel: (props: { outputSec: number }) => createElement("div", { "data-grade-panel": props.outputSec }),
}));

import { VideoGradeEntry, gradeSourceFromPlayableUrl, videoGradeEntryRequest } from "../components/HomePhotoVideoUpscale";
import { marketingGradeScopeKey } from "../components/platform/MarketingProductionPanel";
import { submitVideoGrade } from "./videoGradeSubmit";

const SIGNED = "https://storage.googleapis.com/mv-bucket/post-prod/7/2026/concat-1.mp4?X-Goog-Signature=abc";

describe("调色入口：来源只接可登记为本人后期素材的地址", () => {
  it("代码动画 flyDownloadUrl 包装还原为原签名链；系统桶直链与 gs:// 原样", () => {
    const wrapped = `https://api.mvstudiopro.com/api/gcs-transfer?url=${encodeURIComponent(SIGNED)}`;
    expect(gradeSourceFromPlayableUrl(wrapped)).toBe(SIGNED);
    expect(gradeSourceFromPlayableUrl(`/api/gcs-transfer?url=${encodeURIComponent(SIGNED)}`)).toBe(SIGNED);
    expect(gradeSourceFromPlayableUrl(SIGNED)).toBe(SIGNED);
    expect(gradeSourceFromPlayableUrl("gs://mv-bucket/post-prod/7/a.mp4")).toBe("gs://mv-bucket/post-prod/7/a.mp4");
  });
  it.each([
    "https://api.mvstudiopro.com/api/photo-media/1762000000000_00000000-0000-0000-0000-000000000000.mp4",
    "https://p1.kling-cdn.example/video.mp4",
    "https://mv-bucket.storage.googleapis.com/post-prod/7/a.mp4",
    `/api/gcs-transfer?url=${encodeURIComponent("https://evil.example/a.mp4")}`,
    "",
    undefined,
  ])("首页临时空间、第三方 CDN、虚拟主机桶链等不显示调色：%s", url => {
    expect(gradeSourceFromPlayableUrl(url)).toBe("");
  });
});

describe("调色入口：提交参数", () => {
  const probe = async () => ({ width: 1280, height: 720, fps: 30, durationSec: 8, durationExactSec: 8, sourceResolution: "720p" } as never);
  const grade = { all: { contrast: 1.1 } } as never;

  it("代码动画：单片 concat，clips 为原签名链，scopeKey 按作品，结果另存新文件", async () => {
    const queue = vi.fn(async () => ({ jobId: "job-cm" }));
    const source = gradeSourceFromPlayableUrl(`/api/gcs-transfer?url=${encodeURIComponent(SIGNED)}`);
    const jobId = await submitVideoGrade(videoGradeEntryRequest(source, grade, "code-motion-grade:p1"), { queue, probe });
    expect(jobId).toBe("job-cm");
    const input = (queue.mock.calls[0] as unknown[])[0] as { action: string; scopeKey: string; params: { clips: string[]; grade: unknown } };
    expect(input.action).toBe("concat");
    expect(input.scopeKey).toBe("code-motion-grade:p1");
    expect(input.params.clips).toEqual([SIGNED]);
    expect(input.params.grade).toBeTruthy();
  });

  it("营销成片：scopeKey 与导出 concat 恢复（marketing:<稿号>）分开", async () => {
    expect(marketingGradeScopeKey("d1")).toBe("marketing-grade:d1");
    expect(marketingGradeScopeKey("x".repeat(300))).toHaveLength(128);
    const queue = vi.fn(async () => "job-mk");
    await submitVideoGrade(videoGradeEntryRequest(SIGNED, grade, marketingGradeScopeKey("d1")), { queue, probe });
    const input = (queue.mock.calls[0] as unknown[])[0] as { scopeKey: string; params: { clips: string[] } };
    expect(input.scopeKey).toBe("marketing-grade:d1");
    expect(input.params.clips).toEqual([SIGNED]);
  });

  it("未设置调色不入队", async () => {
    const queue = vi.fn();
    await expect(submitVideoGrade(videoGradeEntryRequest(SIGNED, undefined), { queue, probe })).rejects.toThrow();
    expect(queue).not.toHaveBeenCalled();
  });

  it("调色区渲染面板与提交按钮（无调色时按钮禁用），前台无引擎名", () => {
    const html = renderToStaticMarkup(createElement(VideoGradeEntry, { source: SIGNED, outputSec: 8, scopeKey: "s" }));
    expect(html).toContain('data-grade-panel="8"');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>生成调色版（新文件，原片保留）<\/button>/);
    expect(html).not.toMatch(/ffmpeg|Seedance|WaveSpeed|Gemini|GPT/i);
    expect(queued).toHaveLength(0);
  });
});
