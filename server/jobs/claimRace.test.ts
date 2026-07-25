import { beforeEach, describe, expect, it, vi } from "vitest";

const getDb = vi.fn();
vi.mock("../db", () => ({ getDb: () => getDb() }));
vi.mock("../services/platformImageChineseStaging.js", () => ({
  omitChineseStagingFromJobOutput: (o: unknown) => o,
}));
vi.mock("../services/drProSecondaryStaging.js", () => ({
  deleteDrProSecondaryStagingByJobId: async () => {},
}));

import { claimNextQueuedJobExcluding } from "./repository";

const QUEUED_ROW = {
  id: "job-1",
  userId: "u1",
  type: "video",
  provider: "seedance",
  status: "queued",
  input: {},
  output: null,
  error: null,
  attempts: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
};

/** rowsAffected：每次 update...returning 影响的行数，按调用顺序取 */
function fakeDb(rowsAffected: number[]) {
  let updateCall = 0;
  const selectChain = {
    from: () => selectChain,
    where: () => selectChain,
    orderBy: () => selectChain,
    limit: async () => [QUEUED_ROW],
  };
  return {
    select: () => selectChain,
    update: () => ({
      set: () => ({
        where: () => ({
          returning: async () => {
            const n = rowsAffected[updateCall] ?? 0;
            updateCall += 1;
            return n > 0 ? [{ id: QUEUED_ROW.id }] : [];
          },
        }),
      }),
    }),
  };
}

describe("queued 任务抢占", () => {
  beforeEach(() => getDb.mockReset());

  it("抢到（影响 1 行）时返回任务", async () => {
    const db = fakeDb([1]);
    getDb.mockResolvedValue(db);
    const job = await claimNextQueuedJobExcluding([]);
    expect(job?.id).toBe("job-1");
  });

  /**
   * 两个 worker 同时 select 到同一条，第二个的条件 UPDATE 一行没改。
   * 旧代码不看这个就往下 getJobById，同一个视频任务会被执行两遍，钱烧两次。
   */
  it("被别人抢走（影响 0 行）时返回 null，而不是照样开跑", async () => {
    const db = fakeDb([0]);
    getDb.mockResolvedValue(db);
    expect(await claimNextQueuedJobExcluding([])).toBeNull();
  });
});
