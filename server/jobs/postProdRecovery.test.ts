import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const repo = vi.hoisted(() => ({ completePostProdJob: vi.fn(), getJobByIdStrict: vi.fn(), failPostProdJob: vi.fn() }));
vi.mock("./repository", () => repo);
let dir: string;
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks();
  dir = await mkdtemp(path.join(tmpdir(), "post-prod-recovery-test-"));
  vi.stubEnv("POST_PROD_RECOVERY_DIR", dir);
  repo.completePostProdJob.mockResolvedValue(true);
  repo.failPostProdJob.mockResolvedValue(true);
  repo.getJobByIdStrict.mockImplementation(async id => ({ id, userId: "7", type: "post_prod", status: "running", updatedAt: new Date(0) }));
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(dir, { recursive: true, force: true }); });
describe("post-production recovery without rerendering", () => {
  it("settles an uploaded result from the still-live owner, retains permanent receipt", async () => {
    const m = await import("./postProdRecovery");
    const result = { output: { gcsUri: "gs://test/output.mp4" }, provider: "ffmpeg-post-prod" };
    await m.savePostProdReceipt({ version: 1, jobId: "done", userId: "7", owner: await m.postProdOwner(), result });
    expect(await m.recoverPostProdReceipts()).toEqual({ recovered: 1, interrupted: 0 });
    expect(repo.completePostProdJob).toHaveBeenCalledWith("done", result.output, result.provider);
    expect(repo.failPostProdJob).not.toHaveBeenCalled();
    const archived = await readdir(path.join(dir, "completed"));
    expect(JSON.parse(await readFile(path.join(dir, "completed", archived[0]), "utf8")).result).toEqual(result);
  });
  it("DB outage and corrupt neighbour preserve the result for a later pass", async () => {
    const m = await import("./postProdRecovery");
    await writeFile(path.join(dir, "corrupt.json"), "{");
    await m.savePostProdReceipt({ version: 1, jobId: "done", userId: "7", owner: await m.postProdOwner(), result: { output: {}, provider: "ffmpeg" } });
    repo.completePostProdJob.mockRejectedValueOnce(new Error("DB offline"));
    expect((await m.recoverPostProdReceipts()).recovered).toBe(0);
    expect(await readdir(dir)).toContain("done.json");
    expect((await m.recoverPostProdReceipts()).recovered).toBe(1);
  });
  it("does not interrupt a live owner or touch a cancelled task", async () => {
    const m = await import("./postProdRecovery"); const owner = await m.postProdOwner();
    await m.savePostProdReceipt({ version: 1, jobId: "live", userId: "7", owner });
    await m.savePostProdReceipt({ version: 1, jobId: "cancelled", userId: "7", owner, result: { output: {}, provider: "ffmpeg" } });
    repo.getJobByIdStrict.mockResolvedValue({ id: "cancelled", userId: "7", type: "post_prod", status: "cancelled" });
    await m.recoverPostProdReceipts();
    expect(repo.failPostProdJob).not.toHaveBeenCalled(); expect(repo.completePostProdJob).not.toHaveBeenCalled();
  });
  it("requires machine and boot evidence, never guesses PID identity", async () => {
    const m = await import("./postProdRecovery");
    const current = { machineId: "same", bootId: "new-boot", pid: process.pid, startTicks: "" };
    expect(await m.isPostProdOwnerGone({ ...current, bootId: "old-boot" }, current)).toBe(true);
    expect(await m.isPostProdOwnerGone({ ...current, machineId: "other", bootId: "old-boot" }, current)).toBe(false);
    expect(await m.isPostProdOwnerGone(current, current)).toBe(false);
  });
});
