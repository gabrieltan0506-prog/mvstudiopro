import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  ManhuaMotionEntryButton,
  resolveManhuaMotionPanelStatus,
} from "../components/ManhuaScriptWorkbench.js";

describe("漫剧人物动作与运镜入口", () => {
  it("执行真实 JSX 入口 handler：打开文字配方，同时滚动并聚焦现有轨迹导演板", () => {
    const order: string[] = [];
    const scrollIntoView = vi.fn(() => order.push("scroll"));
    const focus = vi.fn(() => order.push("focus"));
    const panel = { scrollIntoView, focus } as unknown as HTMLElement;
    const onOpenPathTab = vi.fn(() => order.push("path"));
    const element = ManhuaMotionEntryButton({
      panelRef: { current: panel },
      onOpenPathTab,
      pathTrackLabelZh: "跟移配方",
      narrativeLightingLabelZh: "冷暖交界",
    });

    element.props.onClick();

    expect(onOpenPathTab).toHaveBeenCalledOnce();
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "instant",
      block: "center",
      inline: "nearest",
    });
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(order).toEqual(["path", "scroll", "focus"]);

    const html = renderToStaticMarkup(element);
    expect(html).toContain("人物动作与运镜");
    expect(html).toContain("青色虚线 · 摄影机");
    expect(html).toContain("红色实线 · 人物／道具");
    expect(html).toContain("跟移配方");
    expect(html).toContain("灯光：冷暖交界");
  });

  it("轨迹板五类进度与只读待确认均显示真实状态", () => {
    expect(
      resolveManhuaMotionPanelStatus({
        hasBase: false,
        measureFailed: false,
        geometryReady: false,
        overlay: null,
        canChange: true,
      })
    ).toEqual({ state: "missing-base", labelZh: "缺少本段底图" });
    expect(
      resolveManhuaMotionPanelStatus({
        hasBase: true,
        measureFailed: true,
        geometryReady: false,
        overlay: null,
        canChange: true,
      })
    ).toEqual({ state: "invalid-base", labelZh: "底图读取失败" });
    expect(
      resolveManhuaMotionPanelStatus({
        hasBase: true,
        measureFailed: false,
        geometryReady: false,
        overlay: null,
        canChange: true,
      })
    ).toEqual({ state: "measuring-base", labelZh: "正在核对底图尺寸" });
    expect(
      resolveManhuaMotionPanelStatus({
        hasBase: true,
        measureFailed: false,
        geometryReady: true,
        overlay: null,
        canChange: true,
      })
    ).toEqual({ state: "missing-direction", labelZh: "本段暂无明确轨迹" });
    expect(
      resolveManhuaMotionPanelStatus({
        hasBase: true,
        measureFailed: false,
        geometryReady: true,
        overlay: { needsReview: true },
        canChange: true,
      })
    ).toEqual({ state: "needs-review", labelZh: "待确认" });
    expect(
      resolveManhuaMotionPanelStatus({
        hasBase: true,
        measureFailed: false,
        geometryReady: true,
        overlay: { needsReview: true },
        canChange: false,
      })
    ).toEqual({ state: "needs-review-readonly", labelZh: "待确认 · 当前只读" });
    expect(
      resolveManhuaMotionPanelStatus({
        hasBase: true,
        measureFailed: false,
        geometryReady: true,
        overlay: { needsReview: false },
        canChange: false,
      })
    ).toEqual({ state: "confirmed", labelZh: "已确认 · 接入成片调度" });
  });

  it("尚未挂载右栏时入口仍只切到运镜配方，不执行空目标操作", () => {
    const onOpenPathTab = vi.fn();
    const element = ManhuaMotionEntryButton({
      panelRef: { current: null },
      onOpenPathTab,
    });

    expect(() => element.props.onClick()).not.toThrow();
    expect(onOpenPathTab).toHaveBeenCalledOnce();
    const html = renderToStaticMarkup(element);
    expect(html).toContain("点击到右侧校准轨迹；中栏运镜用于文字配方");
  });
});
