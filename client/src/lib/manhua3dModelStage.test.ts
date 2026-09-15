import { describe, expect, it } from "vitest";
import { manhua3dModelCounts, manhua3dModelStageOf, runManhua3dBatch } from "@/components/canvas/Manhua3dModelStudio";

const base = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  labelZh: "男",
  eligibility: { eligible: true, sourceVersion: "v1", ...over },
});
const model = (status: string, extra: Record<string, unknown> = {}) => ({
  status, taskId: "m3d_1", sourceImageUrl: "https://x/y.png", sourceVersion: "v1", ...extra,
});

describe("3D 模型工作台 · 阶段判定", () => {
  it("不可建模 → blocked 带原因；无模型 → none", () => {
    expect(manhua3dModelStageOf(base({ eligible: false, reasonZh: "请先确认这张人物参考图" }) as never, false)).toEqual({ stage: "blocked", labelZh: "还不能建模", reasonZh: "请先确认这张人物参考图" });
    expect(manhua3dModelStageOf(base() as never, false).stage).toBe("none");
  });
  it("queued/running → building；reconcile_manual → review；failed → failed 带 errorZh；succeeded → ready", () => {
    expect(manhua3dModelStageOf(base({ currentModel3d: model("queued") }) as never, false).stage).toBe("building");
    expect(manhua3dModelStageOf(base({ currentModel3d: model("running") }) as never, false).stage).toBe("building");
    expect(manhua3dModelStageOf(base({ currentModel3d: model("reconcile_manual") }) as never, false).stage).toBe("review");
    const failed = manhua3dModelStageOf(base({ currentModel3d: model("failed", { errorZh: "上游超时" }) }) as never, false);
    expect(failed).toEqual({ stage: "failed", labelZh: "建模失败", reasonZh: "上游超时" });
    expect(manhua3dModelStageOf(base({ currentModel3d: model("succeeded") }) as never, false).stage).toBe("ready");
  });
  it("已绑骨优先于模型状态；但不可建模的人不会被标成已绑骨", () => {
    expect(manhua3dModelStageOf(base({ currentModel3d: model("succeeded") }) as never, true).stage).toBe("rigged");
    expect(manhua3dModelStageOf(base({ eligible: false, reasonZh: "x" }) as never, true).stage).toBe("blocked");
  });
});

describe("1468 R1 · 批量与计数", () => {
  it("批量串行：中间一人抛错不中断其余，失败名单带原因，成功名单齐", async () => {
    const calls: string[] = [];
    const r = await runManhua3dBatch(["a", "b", "c"], async (id) => {
      calls.push(id);
      if (id === "b") throw new Error("积分不足");
    });
    expect(calls).toEqual(["a", "b", "c"]);
    expect(r.succeeded).toEqual(["a", "c"]);
    expect(r.failed).toEqual([{ id: "b", messageZh: "积分不足" }]);
  });
  it("按钮「就绪 x/y」与面板计数同一口径：ready 或 rigged 算就绪；blocked 的人即使带旧 succeeded 模型也不算", () => {
    const chars = [
      base({ currentModel3d: model("succeeded") }),
      { ...base({ currentModel3d: model("succeeded") }), id: "c2" },
      { ...base({ eligible: false, reasonZh: "图已换", currentModel3d: model("succeeded") }), id: "c3" },
      { ...base({ currentModel3d: model("failed") }), id: "c4" },
    ] as never[];
    expect(manhua3dModelCounts(chars, ["c2"])).toEqual({ total: 4, ready: 2, rigged: 1 });
  });
});
