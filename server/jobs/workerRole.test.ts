import { describe, expect, it } from "vitest";
import { isBlenderPostProdAction, resolveJobWorkerRole, resolvePostProdClaimFilter } from "./workerRole";

describe("0917 Blender 独立进程组角色", () => {
  it("角色只认 rig，其余都是 app", () => {
    expect(resolveJobWorkerRole({ JOB_WORKER_ROLE: "rig" })).toBe("rig");
    expect(resolveJobWorkerRole({ JOB_WORKER_ROLE: "RIG " })).toBe("rig");
    expect(resolveJobWorkerRole({ JOB_WORKER_ROLE: "worker" })).toBe("app");
    expect(resolveJobWorkerRole({})).toBe("app");
  });
  it("领单过滤：rig 只领 Blender；app 开分流不领 Blender；不开分流全领", () => {
    expect(resolvePostProdClaimFilter({ JOB_WORKER_ROLE: "rig" })).toBe("blender");
    expect(resolvePostProdClaimFilter({ MANHUA_RIG_WORKER_SPLIT: "1" })).toBe("non_blender");
    expect(resolvePostProdClaimFilter({})).toBeUndefined();
    // rig 角色不受分流开关影响
    expect(resolvePostProdClaimFilter({ JOB_WORKER_ROLE: "rig", MANHUA_RIG_WORKER_SPLIT: "0" })).toBe("blender");
  });
  it("Blender 动作集合", () => {
    expect(isBlenderPostProdAction("manhua_auto_rig")).toBe(true);
    expect(isBlenderPostProdAction("manhua_previs")).toBe(true);
    expect(isBlenderPostProdAction("audio_trim")).toBe(false);
    expect(isBlenderPostProdAction(undefined)).toBe(false);
  });
});
