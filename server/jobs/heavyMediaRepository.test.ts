import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { jobs } from "../../drizzle/schema-jobs";
const state = vi.hoisted(() => ({ db: null as any, receipt: null as any }));
vi.mock("../db", () => ({ getDb: async () => state.db }));
vi.mock("../services/heavyMediaEvidence", () => ({
  readHeavyMediaResult: async () => state.receipt,
}));
import {
  heavyMediaStore,
  claimHeavyMediaJob,
  writeHeavyMediaProgress,
  finishHeavyMediaJob,
  countHeavyWorkerJobs,
  recoverStaleHeavyMediaJobs,
} from "./heavyMediaRepository";
import {
  claimNextQueuedJob,
  claimNextPostProdJob,
  countPendingBlenderPostProdJobs,
} from "./repository";

const pg = new PGlite();
const input = {
  action: "heavy_media",
  version: 1,
  request: {
    kind: "learn_command",
    command: "ffprobe",
    args: ["https://fixture.invalid/video.mp4"],
    timeoutMs: 20000,
    maxBuffer: 8192,
  },
};
beforeAll(async () => {
  await pg.exec(`CREATE TABLE jobs (id varchar(64) PRIMARY KEY, "userId" varchar(64) NOT NULL, type text NOT NULL, provider varchar(64) NOT NULL,
    status text NOT NULL DEFAULT 'queued', input json NOT NULL, output json, error text, attempts integer NOT NULL DEFAULT 0,
    "createdAt" timestamp NOT NULL DEFAULT now(), "updatedAt" timestamp NOT NULL DEFAULT now());`);
}, 30_000);
beforeEach(async () => {
  state.db = drizzle(pg);
  state.receipt = null;
  await pg.exec("TRUNCATE jobs");
});
afterAll(() => pg.close());

describe("heavy media uses real offline Postgres semantics", () => {
  it("one durable identity survives duplicate submissions and contention; foreign owner cannot replace it", async () => {
    await Promise.all([
      heavyMediaStore.enqueue("media_one", "7", input),
      heavyMediaStore.enqueue("media_one", "7", input),
    ]);
    await expect(
      heavyMediaStore.enqueue("media_one", "8", input)
    ).rejects.toThrow("不一致");
    const claimed = await Promise.all([
      claimHeavyMediaJob("worker-a"),
      claimHeavyMediaJob("worker-b"),
    ]);
    expect(claimed.filter(Boolean)).toHaveLength(1);
    expect(await countHeavyWorkerJobs()).toBe(1);
    expect(await countHeavyWorkerJobs(false)).toBe(0);
    const rows = await pg.query<{ attempts: number }>(
      "select attempts from jobs"
    );
    expect(rows.rows[0].attempts).toBe(1);
  });
  it("main queue excludes internal media; post-prod none cannot claim any action", async () => {
    await heavyMediaStore.enqueue("media_one", "7", input);
    expect(await claimNextQueuedJob()).toBeNull();
    await state.db.insert(jobs).values({
      id: "subtitle",
      userId: "7",
      type: "post_prod",
      provider: "ffmpeg",
      input: { action: "burn_subtitle" },
    });
    expect(await claimNextPostProdJob("none")).toBeNull();
    expect((await claimNextPostProdJob())?.id).toBe("subtitle");
  });
  it("wrong owner cannot heartbeat or settle, cancellation wins a late success without requeue", async () => {
    await heavyMediaStore.enqueue("media_one", "7", input);
    await claimHeavyMediaJob("worker-a");
    await expect(
      writeHeavyMediaProgress("media_one", "worker-b")
    ).rejects.toThrow();
    await expect(
      finishHeavyMediaJob("media_one", "worker-b", { url: "bad" })
    ).rejects.toThrow();
    await heavyMediaStore.cancel("media_one", "8");
    expect(
      (await writeHeavyMediaProgress("media_one", "worker-a")).cancelRequested
    ).not.toBe(true);
    await heavyMediaStore.cancel("media_one", "7");
    expect((await heavyMediaStore.get("media_one"))?.status).toBe("running");
    await finishHeavyMediaJob("media_one", "worker-a", { url: "retained" });
    expect(await heavyMediaStore.get("media_one")).toMatchObject({
      status: "failed",
      output: { result: { url: "retained" } },
    });
    expect(await claimHeavyMediaJob("worker-c")).toBeNull();
  });
  it("queued cancel has no execution or side effects", async () => {
    await heavyMediaStore.enqueue("media_one", "7", input);
    await heavyMediaStore.cancel("media_one", "7");
    expect(await claimHeavyMediaJob("worker-a")).toBeNull();
    expect(await countHeavyWorkerJobs()).toBe(0);
  });
  it("recovers preserved cross-machine output; a crash without output is terminal and never replayed", async () => {
    await heavyMediaStore.enqueue("media_one", "7", input);
    await claimHeavyMediaJob("worker-a");
    await state.db
      .update(jobs)
      .set({ updatedAt: new Date(Date.now() - 12 * 60_000) })
      .where(eq(jobs.id, "media_one"));
    state.receipt = {
      url: "https://fixture.invalid/final.mp4",
      subtitleTimeline: { durationSec: 2.4 },
    };
    await recoverStaleHeavyMediaJobs();
    expect(await heavyMediaStore.get("media_one")).toMatchObject({
      status: "succeeded",
      output: { result: state.receipt },
    });
    await heavyMediaStore.enqueue("media_two", "7", input);
    await claimHeavyMediaJob("worker-b");
    await state.db
      .update(jobs)
      .set({ updatedAt: new Date(Date.now() - 12 * 60_000) })
      .where(eq(jobs.id, "media_two"));
    state.receipt = null;
    await recoverStaleHeavyMediaJobs();
    expect(await heavyMediaStore.get("media_two")).toMatchObject({
      status: "failed",
    });
    expect(await claimHeavyMediaJob("worker-c")).toBeNull();
  });
  it("fresh successful heartbeat extends long tasks; unavailable DB is not an empty queue", async () => {
    await heavyMediaStore.enqueue("media_one", "7", input);
    await claimHeavyMediaJob("worker-a");
    await state.db.update(jobs).set({
      createdAt: new Date(Date.now() - 4 * 3600_000),
      updatedAt: new Date(Date.now() - 12 * 60_000),
    });
    await writeHeavyMediaProgress("media_one", "worker-a", {
      message: "uploading",
      groups: [],
    });
    await recoverStaleHeavyMediaJobs();
    expect((await heavyMediaStore.get("media_one"))?.status).toBe("running");
    state.db = null;
    await expect(countHeavyWorkerJobs()).rejects.toThrow();
    await expect(countPendingBlenderPostProdJobs()).rejects.toThrow();
  });
  it("callback replies are owner checked, merged durably, and do not create a second execution on recovery", async () => {
    await heavyMediaStore.enqueue("media_one", "7", input);
    await claimHeavyMediaJob("worker-a");
    await expect(
      heavyMediaStore.reply!("media_one", "8", { consumedGroups: 1 })
    ).rejects.toThrow();
    await heavyMediaStore.reply!("media_one", "7", { consumedGroups: 1 });
    await heavyMediaStore.reply!("media_one", "7", {
      nodeResponse: { sequence: 1, nodes: [] },
    });
    await heavyMediaStore.enqueue("media_one", "7", input);
    expect((await heavyMediaStore.get("media_one"))?.input).toMatchObject({
      heavyReply: { consumedGroups: 1, nodeResponse: { sequence: 1 } },
    });
    expect(await claimHeavyMediaJob("worker-b")).toBeNull();
  });
});
