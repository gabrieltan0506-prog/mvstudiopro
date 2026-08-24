import { describe, expect, it } from "vitest";
import {
  MANHUA_BGM_PENDING_TTL_MS,
  canSubmitManhuaBgm,
  manhuaBgmJobStorageKey,
  readManhuaBgmVariants,
  readPendingManhuaBgmJob,
  restoreManhuaBgmFromServer,
} from "./manhuaBgmCardState";

const job = {
  jobId: "bgm_3f2504e0-4f89-11d3-9a0c-0305e82c3301",
  billingRequestId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
  titleZh: "悬疑权谋·配乐",
  durationSec: 21,
  createdAtMs: 1000,
};
const store = (v: string | null) => ({ getItem: () => v });
const UID = "42";

describe("刷新后恢复未完成任务", () => {
  it("读得回 jobId —— 恢复不了用户只会再点一次，那就是再付一次", () => {
    expect(readPendingManhuaBgmJob(store(JSON.stringify(job)), 2000, UID)?.jobId).toBe(job.jobId);
  });

  it("超过 TTL 当过期，让用户重新起草", () => {
    expect(
      readPendingManhuaBgmJob(store(JSON.stringify(job)), 1000 + MANHUA_BGM_PENDING_TTL_MS + 1, UID),
    ).toBeNull();
  });

  it("坏数据不抛，返回 null", () => {
    expect(readPendingManhuaBgmJob(store("not json"), 2000, UID)).toBeNull();
    expect(readPendingManhuaBgmJob(store(null), 2000, UID)).toBeNull();
    expect(readPendingManhuaBgmJob(store(JSON.stringify({ jobId: "x" })), 2000, UID)).toBeNull();
  });

  it("存储键按 userId 分 —— 不分键换账号会读到别人的任务，用户以为没跑成就再点一次", () => {
    expect(manhuaBgmJobStorageKey("42")).toBe("mv-manhua-bgm-job-v1:42");
    expect(manhuaBgmJobStorageKey("7")).not.toBe(manhuaBgmJobStorageKey("42"));
  });
});

describe("能不能点生成", () => {
  it("没起草过不许发 —— 用户得先看过要发什么", () => {
    const r = canSubmitManhuaBgm({ hasDraft: false, pending: null, durationSec: 21 });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reasonZh).toContain("提示词");
  });

  it("已有任务在跑不许再发 —— 那就是重复付费", () => {
    const r = canSubmitManhuaBgm({ hasDraft: true, pending: job, durationSec: 21 });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reasonZh).toContain("已有配乐任务");
  });

  it("时长越界不许发 —— 上游判参数错误就白花一次", () => {
    for (const d of [9, 361, 20.5]) {
      expect(canSubmitManhuaBgm({ hasDraft: true, pending: null, durationSec: d }).ok).toBe(false);
    }
  });

  it("都满足才放行", () => {
    expect(canSubmitManhuaBgm({ hasDraft: true, pending: null, durationSec: 21 })).toEqual({
      ok: true,
    });
  });
});

describe("变体读取", () => {
  it("全部变体都拿得到，供先量再听", () => {
    const v = readManhuaBgmVariants({
      variants: [
        { index: 0, gcsUri: "gs://b/a.mp3", previewUrl: "u0", bytes: 1 },
        { index: 1, gcsUri: "gs://b/b.mp3", previewUrl: "u1", bytes: 2 },
      ],
    });
    expect(v).toHaveLength(2);
    expect(v[1]!.gcsUri).toBe("gs://b/b.mp3");
  });

  it("非 gs:// 的丢掉 —— 进 bgm_mount 的必须是站内素材", () => {
    expect(readManhuaBgmVariants({ variants: [{ gcsUri: "https://x/a.mp3" }] })).toEqual([]);
  });

  it("形状不对当没有，不硬凑", () => {
    expect(readManhuaBgmVariants(null)).toEqual([]);
    expect(readManhuaBgmVariants({ variants: "nope" })).toEqual([]);
  });
});

describe("以服务端为任务主来源", () => {
  it("有未完成任务就恢复成 pending，继续轮询", () => {
    const r = restoreManhuaBgmFromServer([
      { jobId: "bgm_abc", status: "running", output: null },
    ]);
    expect(r.pending?.jobId).toBe("bgm_abc");
  });

  it("最近一条成功的变体也恢复 —— 用户还没选就刷新时不至于全丢", () => {
    const r = restoreManhuaBgmFromServer([
      { jobId: "bgm_x", status: "succeeded", output: { variants: [{ gcsUri: "gs://b/a.mp3" }] } },
    ]);
    expect(r.pending).toBeNull();
    expect(r.variants).toHaveLength(1);
  });

  it("未完成的优先于已完成的", () => {
    const r = restoreManhuaBgmFromServer([
      { jobId: "bgm_run", status: "queued", output: null },
      { jobId: "bgm_ok", status: "succeeded", output: { variants: [{ gcsUri: "gs://b/a.mp3" }] } },
    ]);
    expect(r.pending?.jobId).toBe("bgm_run");
  });

  it("空列表给干净状态", () => {
    expect(restoreManhuaBgmFromServer([])).toEqual({ pending: null, variants: [] });
  });
});
