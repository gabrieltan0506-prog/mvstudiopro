import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureManhuaLearnPageOwnership, filterManhuaLearnPageJobs, readManhuaLearnPageJobId, writeManhuaLearnPageJobId } from "./manhuaLearnPageScope";
import { readManhuaLearnFocusSeriesKey, writeManhuaLearnFocusSeriesKey } from "./manhuaLearnResultUi";
function pageStorage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
}
afterEach(() => { Reflect.deleteProperty(globalThis, "sessionStorage"); vi.unstubAllGlobals(); });
describe("不同网页学习面板隔离", () => {
  it("两页同账号分别绑定各自job与焦点，刷新恢复不交叉；新页不接管别页", () => {
    const pageA = pageStorage(); const pageB = pageStorage();
    Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: pageA });
    writeManhuaLearnPageJobId("owner", "job-a"); writeManhuaLearnFocusSeriesKey("owner", "series-a");
    Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: pageB });
    expect(readManhuaLearnPageJobId("owner")).toBe(""); expect(readManhuaLearnFocusSeriesKey("owner")).toBe("");
    writeManhuaLearnPageJobId("owner", "job-b"); writeManhuaLearnFocusSeriesKey("owner", "series-b");
    const jobs = [{ jobId: "job-a", status: "running" }, { jobId: "job-b", status: "failed" }];
    expect(filterManhuaLearnPageJobs(jobs, readManhuaLearnPageJobId("owner"))).toEqual([jobs[1]]);
    Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: pageA });
    expect(readManhuaLearnFocusSeriesKey("owner")).toBe("series-a");
    expect(filterManhuaLearnPageJobs(jobs, readManhuaLearnPageJobId("owner"))).toEqual([jobs[0]]);
    expect(readManhuaLearnPageJobId("other-owner")).toBe("");
  });
  it("空页面绑定不使用全局唯一活跃任务兜底", () => {
    expect(filterManhuaLearnPageJobs([{ jobId: "other-page" }], "")).toEqual([]);
  });  it("复制标签页继承的job绑定被清除，原页刷新仍恢复原job，不碰原页任务", async () => {
    const channels: any[] = [];
    vi.stubGlobal("BroadcastChannel", class {
      onmessage: ((event: { data: unknown }) => void) | null = null;
      constructor(_name: string) { channels.push(this); }
      postMessage(data: unknown) { for (const channel of channels) if (channel !== this) queueMicrotask(() => channel.onmessage?.({ data })); }
      close() { channels.splice(channels.indexOf(this), 1); }
    });
    const valuesA = new Map<string, string>();
    const storage = (values: Map<string, string>) => ({ getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
    const original = storage(valuesA);
    vi.stubGlobal("sessionStorage", original);
    await ensureManhuaLearnPageOwnership("owner-duplicate");
    writeManhuaLearnPageJobId("owner-duplicate", "job-original"); writeManhuaLearnFocusSeriesKey("owner-duplicate", "series-original");
    const copied = storage(new Map(valuesA));
    vi.stubGlobal("sessionStorage", copied);
    await ensureManhuaLearnPageOwnership("owner-duplicate");
    expect(readManhuaLearnPageJobId("owner-duplicate")).toBe(""); expect(readManhuaLearnFocusSeriesKey("owner-duplicate")).toBe("");
    vi.stubGlobal("sessionStorage", original);
    await ensureManhuaLearnPageOwnership("owner-duplicate");
    expect(readManhuaLearnPageJobId("owner-duplicate")).toBe("job-original");
    expect(readManhuaLearnFocusSeriesKey("owner-duplicate")).toBe("series-original");
  });
  it.each(["navigate", "reload", "back_forward"])("新导航清继承绑定，%s 按真实导航类型恢复", async type => {
    vi.stubGlobal("BroadcastChannel", class { onmessage = null; postMessage() {} close() {} });
    vi.stubGlobal("performance", { getEntriesByType: () => [{ type }] });
    const storage = pageStorage(); vi.stubGlobal("sessionStorage", storage);
    storage.setItem("mvs-manhua-learn-page-owner-v1:navigation-owner", "inherited-tab");
    writeManhuaLearnPageJobId("navigation-owner", "previous-page-job");
    await ensureManhuaLearnPageOwnership("navigation-owner");
    expect(readManhuaLearnPageJobId("navigation-owner")).toBe(type === "navigate" ? "" : "previous-page-job");
  });

});
