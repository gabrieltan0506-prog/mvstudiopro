/**
 * 后期工坊纯逻辑测试:
 * 用户级缓存 key / 异常结构清理 / 服务端为主的合并恢复 /
 * 产物进入下一道工序(gcsUri 优先) / 终态只提示一次。
 */
import { describe, expect, it } from "vitest";
import {
  buildPostProdClipOptions,
  jobsStorageKey,
  loadStoredJobs,
  mergeClipOptions,
  mergeRemoteJobs,
  normalizeStoredJobs,
  persistJobs,
  shouldNotifyTerminal,
  type TrackedJob,
} from "./postProdWorkshop";

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    dump: () => map,
  };
}

const job = (over: Partial<TrackedJob>): TrackedJob => ({
  jobId: "j1",
  action: "concat",
  label: "拼接 2 段",
  status: "succeeded",
  createdAt: 1_755_700_000_000,
  output: null,
  error: null,
  ...over,
});

describe("用户级缓存 key", () => {
  it("用户 A 与用户 B 使用不同 localStorage key,互不串单", () => {
    const storage = fakeStorage();
    persistJobs(jobsStorageKey("7"), [job({ jobId: "a-1" })], storage);
    persistJobs(jobsStorageKey("8"), [job({ jobId: "b-1" })], storage);
    expect(jobsStorageKey("7")).not.toBe(jobsStorageKey("8"));
    expect(loadStoredJobs(jobsStorageKey("7"), storage).map((j) => j.jobId)).toEqual(["a-1"]);
    expect(loadStoredJobs(jobsStorageKey("8"), storage).map((j) => j.jobId)).toEqual(["b-1"]);
  });
});

describe("异常缓存结构清理", () => {
  it("非数组/坏条目/未知 action 一律丢弃", () => {
    expect(normalizeStoredJobs("not-array")).toEqual([]);
    expect(normalizeStoredJobs({ a: 1 })).toEqual([]);
    expect(
      normalizeStoredJobs([
        null,
        42,
        { jobId: "ok", action: "concat", status: "queued", label: "x", createdAt: 1 },
        { jobId: "bad-action", action: "nope", status: "queued" },
        { jobId: 123, action: "concat", status: "queued" },
      ]).map((j) => j.jobId),
    ).toEqual(["ok"]);
  });

  it("坏 JSON 缓存返回空列表", () => {
    const storage = fakeStorage({ [jobsStorageKey("7")]: "{broken" });
    expect(loadStoredJobs(jobsStorageKey("7"), storage)).toEqual([]);
  });
});

describe("服务端为主的恢复合并", () => {
  it("localStorage 清空后可从服务端 jobs 恢复任务(label 用默认动作名)", () => {
    const merged = mergeRemoteJobs(
      [],
      [
        {
          jobId: "r1",
          action: "bgm_mount",
          status: "succeeded",
          output: { gcsUri: "gs://b/post-prod/7/x.mp4" },
          error: null,
          createdAt: "2026-08-21T10:00:00Z",
        },
      ],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].label).toBe("BGM 贴装");
    expect(merged[0].status).toBe("succeeded");
  });

  it("本地展示字段保留,状态/产物以服务端为准;本地独有的终态任务不保留", () => {
    const merged = mergeRemoteJobs(
      [
        job({ jobId: "r1", status: "queued", label: "拼接 3 段(720p)" }),
        // 终态且服务端没有 → 不保留(进行中的保留场景见"合并时序缺口"组)
        job({ jobId: "local-done", status: "succeeded" }),
      ],
      [
        {
          jobId: "r1",
          action: "concat",
          status: "succeeded",
          output: { gcsUri: "gs://b/post-prod/7/y.mp4" },
          error: null,
          createdAt: "2026-08-21T10:00:00Z",
        },
      ],
    );
    expect(merged.map((j) => j.jobId)).toEqual(["r1"]);
    expect(merged[0].label).toBe("拼接 3 段(720p)");
    expect(merged[0].status).toBe("succeeded");
    expect((merged[0].output as { gcsUri?: string }).gcsUri).toBe("gs://b/post-prod/7/y.mp4");
  });
});

describe("后期产物进入下一道工序", () => {
  it("拼接结果进入成片选项;BGM 结果进入响度选项(同一 clipOptions)", () => {
    const options = buildPostProdClipOptions([
      job({ jobId: "c1", action: "concat", output: { gcsUri: "gs://b/post-prod/7/concat.mp4" } }),
      job({ jobId: "b1", action: "bgm_mount", output: { gcsUri: "gs://b/post-prod/7/bgm.mp4" } }),
      job({ jobId: "l1", action: "loudness_check", output: { status: "ok" } }),
      job({ jobId: "pending", action: "concat", status: "running", output: null }),
    ]);
    expect(options.map((o) => o.url)).toEqual([
      "gs://b/post-prod/7/concat.mp4",
      "gs://b/post-prod/7/bgm.mp4",
    ]);
  });

  it("gcsUri 优先于旧读取地址 url", () => {
    const options = buildPostProdClipOptions([
      job({
        jobId: "c1",
        output: { gcsUri: "gs://b/post-prod/7/x.mp4", url: "https://stale.example/x" },
      }),
    ]);
    expect(options[0].url).toBe("gs://b/post-prod/7/x.mp4");
  });

  it("与画布成片合并去重,后期产物排前", () => {
    const merged = mergeClipOptions(
      [{ id: "post-prod:c1", url: "gs://b/1.mp4", label: "拼接" }],
      [
        { id: "blk-1", url: "gs://b/1.mp4", label: "重复的" },
        { id: "blk-2", url: "gs://b/2.mp4", label: "画布片" },
      ],
    );
    expect(merged.map((o) => o.id)).toEqual(["post-prod:c1", "blk-2"]);
  });
});

describe("终态提示只弹一次", () => {
  it("同一终态只提示一次;非终态不提示", () => {
    const notified = new Set<string>();
    expect(shouldNotifyTerminal(notified, "j1", "running")).toBe(false);
    expect(shouldNotifyTerminal(notified, "j1", "succeeded")).toBe(true);
    expect(shouldNotifyTerminal(notified, "j1", "succeeded")).toBe(false);
    expect(shouldNotifyTerminal(notified, "j2", "failed")).toBe(true);
    expect(shouldNotifyTerminal(notified, "j2", "failed")).toBe(false);
  });
});

describe("合并时序缺口(复审三轮)", () => {
  it("较早返回的空列表不移除刚入队的本地任务", () => {
    const merged = mergeRemoteJobs([job({ jobId: "fresh", status: "queued" })], []);
    expect(merged.map((j) => j.jobId)).toEqual(["fresh"]);
  });

  it("服务端没有的本地终态任务不保留;进行中的保留并排前", () => {
    const merged = mergeRemoteJobs(
      [
        job({ jobId: "done-local", status: "succeeded", createdAt: 3 }),
        job({ jobId: "fresh", status: "running", createdAt: 1 }),
      ],
      [
        {
          jobId: "r1",
          action: "concat",
          status: "succeeded",
          output: { gcsUri: "gs://b/post-prod/7/x.mp4" },
          error: null,
          createdAt: "2026-08-21T10:00:00Z",
        },
      ],
    );
    expect(merged[0].jobId).toBe("fresh");
    expect(merged.map((j) => j.jobId)).toEqual(["fresh", "r1"]);
  });

  it("服务端明确返回 output=null 时清除旧缓存产物", () => {
    const merged = mergeRemoteJobs(
      [job({ jobId: "r1", output: { gcsUri: "gs://b/stale.mp4" } })],
      [{ jobId: "r1", action: "concat", status: "running", output: null, error: null, createdAt: 1 }],
    );
    expect(merged[0].output).toBeNull();
  });
});
