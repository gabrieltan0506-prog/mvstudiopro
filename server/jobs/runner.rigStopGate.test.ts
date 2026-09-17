import { afterEach, describe, expect, it, vi } from "vitest";

const repo = vi.hoisted(() => ({ claim: vi.fn(async () => null) }));
vi.mock("./repository", async (load) => ({
  ...(await load<Record<string, unknown>>()),
  claimNextPostProdJob: repo.claim,
}));
vi.mock("./repository.js", async (load) => ({
  ...(await load<Record<string, unknown>>()),
  claimNextPostProdJob: repo.claim,
}));

import { processPostProdJobsOnce, rigStopGate } from "./runner";

describe("rig 停机闸（审查 P1：停机要跨一次网络往返，这期间不能再领单）", () => {
  afterEach(() => {
    rigStopGate.requested = false;
    repo.claim.mockClear();
  });

  it("闸没关时照常领单（反例对照：不能因为加了闸就整条通道不干活了）", async () => {
    await processPostProdJobsOnce();
    expect(repo.claim).toHaveBeenCalled();
  });

  it("停机决定一发出就不再领单；停机失败复位后恢复领单", async () => {
    rigStopGate.requested = true;
    await processPostProdJobsOnce();
    expect(repo.claim).not.toHaveBeenCalled();

    rigStopGate.requested = false;
    await processPostProdJobsOnce();
    expect(repo.claim).toHaveBeenCalled();
  });
});
