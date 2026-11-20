/**
 * 1121 真实阻断复现：归属扫描把整份 output 拉回来，大书任务的数 MB 正文让单次查询超出数据库响应上限，排版稿保存 503。
 * 改为只取产物字段后：结果与取整份 output 完全相同，且查询不再返回正文。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
const state = vi.hoisted(() => ({ db: null as any }));
vi.mock("../db", () => ({ getDb: async () => state.db }));
vi.mock("./canvasVideoTask.js", () => ({ loadSucceededCanvasVideoOutputObjects: async () => new Set<string>() }));
import { collectDeclaredMediaSources, extractSystemObjectName, loadSucceededJobOutputSources, loadSucceededJobOutputSourcesForJobs } from "./postProdMediaSource";

const pg = new PGlite();
const rowsReturned: unknown[][] = [];
beforeAll(async () => {
  await pg.exec(`CREATE TABLE jobs (id varchar(64) PRIMARY KEY, "userId" varchar(64) NOT NULL, type text NOT NULL, provider varchar(64) NOT NULL,
    status text NOT NULL DEFAULT 'queued', input json NOT NULL, output json, error text, attempts integer NOT NULL DEFAULT 0,
    "createdAt" timestamp NOT NULL DEFAULT now(), "updatedAt" timestamp NOT NULL DEFAULT now());`);
}, 30_000);
beforeEach(async () => { state.db = drizzle(pg); rowsReturned.length = 0; await pg.exec("TRUNCATE jobs"); });
afterAll(() => pg.close());

const BUCKET = "bucket-x";
const insert = (id: string, userId: string, status: string, output: unknown, raw = false) =>
  pg.query(`INSERT INTO jobs (id, "userId", type, provider, status, input, output) VALUES ($1,$2,'platform','evolink',$3,'{}'::json,$4::json)`,
    [id, userId, status, output === null ? null : raw ? String(output) : JSON.stringify(output)]);
/** 原实现：取整份 output 后在进程内挑字段。 */
const legacy = async (userId: string) => {
  const objects = new Set<string>(), urls = new Set<string>();
  const rows = (await pg.query<any>(`SELECT output FROM jobs WHERE "userId"=$1 AND status='succeeded'`, [userId])).rows;
  for (const row of rows) for (const source of collectDeclaredMediaSources(row.output)) {
    const name = extractSystemObjectName(source, BUCKET);
    if (name) objects.add(name); else if (/^https:\/\//i.test(source)) urls.add(source);
  }
  return { objects: Array.from(objects).sort(), urls: Array.from(urls).sort() };
};
const sorted = (v: { objects: ReadonlySet<string>; urls: ReadonlySet<string> }) => ({ objects: Array.from(v.objects).sort(), urls: Array.from(v.urls).sort() });

describe("归属扫描只取产物字段", () => {
  it("与取整份 output 的结果相同：各类产物字段、数组字段、大正文、空 output、字符串形态旧行、别人的与未成功的任务", async () => {
    const big = "正".repeat(3_000_000);
    await insert("kc_a", "1", "succeeded", { compositeImageUrl: `gs://${BUCKET}/users/1/a.png`, distilledMarkdown: big, fullEditionMarkdown: big, pages: [big.slice(0, 1000)] });
    await insert("kc_b", "1", "succeeded", { imageUrl: `https://storage.googleapis.com/${BUCKET}/users/1/b.png`, imageUrls: [`gs://${BUCKET}/users/1/c.png`, "https://cdn.example.com/d.png"], message: "https://not-a-product.example.com/x.png" });
    await insert("kc_c", "1", "succeeded", { videoUrl: "https://cdn.example.com/v.mp4", urls: ["https://cdn.example.com/u1.png"], nested: { imageUrl: `gs://${BUCKET}/users/1/nested.png` } });
    await insert("kc_d", "1", "succeeded", null);
    await insert("kc_e", "1", "succeeded", JSON.stringify(JSON.stringify({ imageUrl: `gs://${BUCKET}/users/1/legacy.png` })), true);
    await insert("kc_f", "1", "failed", { imageUrl: `gs://${BUCKET}/users/1/failed.png` });
    await insert("kc_g", "2", "succeeded", { imageUrl: `gs://${BUCKET}/users/2/other.png` });
    const expected = await legacy("1");
    expect(expected.objects).toContain("users/1/a.png");
    expect(expected.objects).not.toContain("users/1/nested.png");
    expect(sorted(await loadSucceededJobOutputSources("1", BUCKET))).toEqual(expected);
    const targeted = sorted(await loadSucceededJobOutputSourcesForJobs("1", BUCKET, ["kc_a", "kc_b", "kc_f", "kc_g", "kc_e"]));
    expect(targeted.objects).toEqual(["users/1/a.png", "users/1/b.png", "users/1/c.png", "users/1/legacy.png"]);
    expect(targeted.objects).not.toContain("users/2/other.png");
  });

  it("查询不再把正文带回来：200 个各带 1MB 正文的任务，返回数据远小于正文总量", async () => {
    const big = "文".repeat(1_000_000);
    for (let i = 0; i < 200; i++) await insert(`kc_${String(i).padStart(4, "0")}`, "1", "succeeded", { compositeImageUrl: `gs://${BUCKET}/users/1/p${i}.png`, distilledMarkdown: big });
    let bytes = 0;
    state.db = drizzle(pg, { logger: { logQuery: () => {} } });
    const original = pg.query.bind(pg);
    (pg as any).query = async (...args: any[]) => { const result = await (original as any)(...args); bytes += JSON.stringify(result.rows ?? []).length; return result; };
    try {
      const result = await loadSucceededJobOutputSources("1", BUCKET);
      expect(result.objects.size).toBe(200);
      expect(bytes).toBeGreaterThan(0);
      expect(bytes).toBeLessThan(200_000);
    } finally { (pg as any).query = original; }
  }, 120_000);
});
