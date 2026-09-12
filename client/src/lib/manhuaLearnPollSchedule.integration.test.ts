import { readFileSync } from "node:fs";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MANHUA_LEARN_SYNC_INITIAL,
  manhuaLearnSyncDelayMs,
  nextManhuaLearnSyncState,
} from "./manhuaLearnPollSchedule";

/** 执行页面里的真实闭包，替换的只有网络与浏览器时钟，不复制排程实现。 */
function pageCallback(path: string, match: (node: ts.Node) => boolean): string {
  const source = ts.createSourceFile(path, readFileSync(new URL(path, import.meta.url), "utf8"),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found: ts.Node | undefined;
  const visit = (node: ts.Node) => {
    if (match(node)) found = node;
    else ts.forEachChild(node, visit);
  };
  visit(source);
  if (!found) throw new Error(`没有找到待测回调：${path}`);
  return ts.transpileModule(`const callback = ${found.getText(source)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

const learnCallback = pageCallback("../pages/PlatformPage.tsx", (node) =>
  ts.isArrowFunction(node) && ts.isCallExpression(node.parent)
  && node.parent.expression.getText() === "useEffect"
  && node.getText().includes("let wakePending = false"));
const bgmCallback = pageCallback("../components/canvas/PostProdWorkshopCard.tsx", (node) =>
  ts.isArrowFunction(node) && ts.isPropertyAssignment(node.parent)
  && node.parent.name.getText() === "refetchInterval"
  && node.getText().includes("const rows = query.state.data"));

function mountLearn(refresh: () => Promise<{ items: unknown[] }>) {
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(0);
  const wake = { current: null as null | (() => void) };
  const visibility = new EventTarget();
  let hidden = false;
  const deps = {
    hasSupervisorOpsAccess: true, user: { id: 1 }, trendInsightTab: "ai_manhua",
    window: { setTimeout, clearTimeout }, document: visibility,
    manhuaLearnWakeRef: wake, bumpManhuaLearnSnapshotBaseline: vi.fn(),
    refreshManhuaLearnServerJobs: refresh,
    MANHUA_LEARN_SYNC_INITIAL, manhuaLearnSyncDelayMs, nextManhuaLearnSyncState,
    isPageHidden: () => hidden,
  };
  const cleanup = new Function(...Object.keys(deps), `${learnCallback}\nreturn callback();`)(
    ...Object.values(deps),
  ) as () => void;
  return { wake, cleanup, setHidden(value: boolean) {
    hidden = value;
    visibility.dispatchEvent(new Event("visibilitychange"));
  } };
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("页面真实轮询闭包", () => {
  it("旧请求在途时反复唤醒不并发，旧空列表也不会覆盖活跃档", async () => {
    let resolve!: (value: { items: unknown[] }) => void;
    const refresh = vi.fn().mockImplementationOnce(() => new Promise(r => { resolve = r; }))
      .mockResolvedValue({ items: [] });
    const page = mountLearn(refresh);
    page.wake.current?.();
    page.wake.current?.();
    await vi.advanceTimersByTimeAsync(800);
    expect(refresh).toHaveBeenCalledTimes(1);
    resolve({ items: [] });
    await vi.advanceTimersByTimeAsync(2_999);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(2);
    page.cleanup();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("后台退避后回前台 800 毫秒唤醒，卸载移除计时与监听", async () => {
    const refresh = vi.fn().mockResolvedValue({ items: [] });
    const page = mountLearn(refresh);
    page.setHidden(true);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    page.setHidden(false);
    await vi.advanceTimersByTimeAsync(800);
    expect(refresh).toHaveBeenCalledTimes(2);
    page.cleanup();
    page.setHidden(false);
    await vi.advanceTimersByTimeAsync(180_000);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(page.wake.current).toBeNull();
  });

  it("请求返回前卸载，finally 不会重新排程", async () => {
    let resolve!: (value: { items: unknown[] }) => void;
    const refresh = vi.fn(() => new Promise<{ items: unknown[] }>(r => { resolve = r; }));
    const page = mountLearn(refresh);
    page.cleanup();
    resolve({ items: [] });
    await vi.advanceTimersByTimeAsync(180_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("配乐已确认本地单号但列表刷新失败时，仍以在途档跟进原单", () => {
    const interval = (pending: unknown, rows: unknown) =>
      new Function("bgmPending", "query", `${bgmCallback}\nreturn callback(query);`)(
        pending, { state: { data: rows } },
      );
    expect(interval({ jobId: "bgm-confirmed" }, [])).toBe(5_000);
    expect(interval({ jobId: "bgm-restored" }, undefined)).toBe(5_000);
    expect(interval(null, [{ status: "running" }])).toBe(5_000);
    expect(interval(null, [{ status: "succeeded" }])).toBe(60_000);
    expect(interval(null, [])).toBe(60_000);
  });
});
