import { describe, expect, it, vi } from "vitest";
import {
  ensureRigStartedForPending,
  maybeStopIdleRig,
  type RigAutoscaleDeps,
} from "./rigAutoscale";
import {
  heavyWorkerSplitEnabled,
  resolvePostProdClaimFilter,
} from "./workerRole";
function deps(patch: Partial<RigAutoscaleDeps> = {}): RigAutoscaleDeps {
  return {
    now: () => 900_000,
    queuedBlenderJobs: async () => 1,
    pendingBlenderJobs: async () => 0,
    selfMachineId: "rig-a",
    idleStopMs: 60_000,
    listRig: async () => [
      { id: "rig-a", processGroup: "rig", state: "started" },
    ],
    listAllMachines: async () => [],
    startMachine: vi.fn(),
    stopMachine: vi.fn(),
    log: vi.fn(),
    onStopDecided: vi.fn(),
    onStopAborted: vi.fn(),
    preserveGateOnStopError: true,
    ...patch,
  };
}
describe("two-machine routing and idle lifecycle", () => {
  it("is opt-in, moves all post production off app, and leaves legacy routing alone", () => {
    expect(heavyWorkerSplitEnabled({})).toBe(false);
    expect(resolvePostProdClaimFilter({ JOB_WORKER_ROLE: "rig" })).toBe(
      "blender"
    );
    expect(resolvePostProdClaimFilter({ MANHUA_HEAVY_WORKER_SPLIT: "1" })).toBe(
      "none"
    );
    expect(
      resolvePostProdClaimFilter({
        JOB_WORKER_ROLE: "rig",
        MANHUA_HEAVY_WORKER_SPLIT: "1",
      })
    ).toBeUndefined();
  });
  it("DB outage cannot stop a machine", async () => {
    const d = deps({
      pendingBlenderJobs: async () => {
        throw new Error("db");
      },
    });
    expect((await maybeStopIdleRig(d, { lastBusyAt: 0 }, false)).action).toBe(
      "error"
    );
    expect(d.stopMachine).not.toHaveBeenCalled();
  });
  it("a task arriving during drain recheck reopens gate without stopping", async () => {
    const d = deps({
      pendingBlenderJobs: vi
        .fn()
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(1),
    });
    expect((await maybeStopIdleRig(d, { lastBusyAt: 0 }, false)).action).toBe(
      "busy"
    );
    expect(d.onStopDecided).toHaveBeenCalledOnce();
    expect(d.onStopAborted).toHaveBeenCalledOnce();
    expect(d.stopMachine).not.toHaveBeenCalled();
  });
  it("a task arriving after the final empty check remains queued and wakes after stop completes", async () => {
    let queued = 0;
    let state = "started";
    const d = deps({
      pendingBlenderJobs: async () => queued,
      queuedBlenderJobs: async () => queued,
      listRig: async () => [{ id: "rig-a", processGroup: "rig", state }],
      stopMachine: vi.fn(async () => {
        queued = 1;
        state = "stopping";
      }),
      startMachine: vi.fn(async () => {
        state = "started";
      }),
    });
    expect((await maybeStopIdleRig(d, { lastBusyAt: 0 }, false)).action).toBe(
      "stopped"
    );
    expect(
      (await ensureRigStartedForPending(d, { lastAttemptAt: 0 })).action
    ).toBe("already_running");
    state = "stopped";
    expect(
      (await ensureRigStartedForPending(d, { lastAttemptAt: 0 })).action
    ).toBe("started");
    expect(d.startMachine).toHaveBeenCalledOnce();
    expect(queued).toBe(1);
  });
  it("upload/result/child still busy prevents stop even after a terminal job status", async () => {
    const d = deps();
    expect(
      (await maybeStopIdleRig(d, { lastBusyAt: 0 }, () => true)).action
    ).toBe("busy");
    expect(d.stopMachine).not.toHaveBeenCalled();
  });
  it("ambiguous stop response keeps claims closed; start failures leave jobs queued", async () => {
    const d = deps({
      stopMachine: vi.fn(async () => {
        throw new Error("timeout after send");
      }),
    });
    expect((await maybeStopIdleRig(d, { lastBusyAt: 0 }, false)).action).toBe(
      "error"
    );
    expect(d.onStopDecided).toHaveBeenCalledOnce();
    expect(d.onStopAborted).not.toHaveBeenCalled();
    const wake = deps({
      listRig: async () => [
        { id: "rig-a", processGroup: "rig", state: "stopped" },
      ],
      startMachine: async () => {
        throw new Error("API unavailable");
      },
    });
    expect(
      (await ensureRigStartedForPending(wake, { lastAttemptAt: 0 })).action
    ).toBe("error");
    expect(await wake.queuedBlenderJobs()).toBe(1);
  });
  it("zero queue never starts workers, and an active worker prevents waking a spare", async () => {
    const empty = deps({ queuedBlenderJobs: async () => 0 });
    expect(
      (await ensureRigStartedForPending(empty, { lastAttemptAt: 0 })).action
    ).toBe("idle");
    expect(empty.startMachine).not.toHaveBeenCalled();
    const d = deps({
      listRig: async () => [
        { id: "rig-a", state: "started", processGroup: "rig" },
        { id: "rig-spare", state: "stopped", processGroup: "rig" },
      ],
    });
    expect(
      (await ensureRigStartedForPending(d, { lastAttemptAt: 0 })).action
    ).toBe("already_running");
    expect(d.startMachine).not.toHaveBeenCalled();
  });
});
