import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
// 1119 C4：恢复查询在真实 Postgres 语义（PGlite）下对新旧两种任务行的行为。
const state = vi.hoisted(() => ({ db: null as any, texts: new Map<string, string>(), loads: [] as string[], unavailable: false }));
vi.mock("../db", () => ({ getDb: async () => state.db }));
vi.mock("./gcs", async original => ({
  ...await original<any>(),
  getGcsBucketName: () => "test",
  downloadGcsObjectVersioned: async () => { throw new Error("gcs_stat_failed:404"); },
  signGcsObjectPathV4ReadUrl: (bucket: string, path: string) => `https://signed.invalid/${bucket}/${path}`,
}));
vi.mock("./handbookManuscriptStage", async original => ({
  ...await original<any>(),
  loadHandbookManuscript: async (userId: number, digest: string) => {
    state.loads.push(`${userId}:${digest}`);
    if (state.unavailable) { const { HandbookManuscriptError } = await original<any>(); throw new HandbookManuscriptError("暂存原稿暂时读不到", "UNAVAILABLE"); }
    const t = state.texts.get(`${userId}:${digest}`);
    if (t === undefined) { const { HandbookManuscriptError } = await original<any>(); throw new HandbookManuscriptError("未封存", "NOT_FOUND"); }
    return t;
  },
}));
import { getKnowledgeCardRecovery, listKnowledgeCardRecovery } from "./knowledgeCardRecovery";

const sha = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
const pg = new PGlite();
const SMALL = "# 小书\n\n旧形态正文。";
const BIG = `# 大书\r\n${"知识😀".repeat(80_000)}`;
const D = sha(BIG);
const settings = { kind: "single_page_knowledge_card", notePageTotal: 3, distillModel: "glm-5.3-flash", subjectPosition: "left", openaiImageVariant: "sunburst" };
let n = 0;
async function insert(id: string, userId: string, input: unknown, output: unknown, status = "succeeded") {
  await pg.query(`INSERT INTO jobs (id,"userId",type,provider,status,input,output,"createdAt") VALUES ($1,$2,'platform','vertex',$3,$4,$5, now() + ($6 || ' seconds')::interval)`,
    [id, userId, status, JSON.stringify(input), JSON.stringify(output), String(n++)]);
}
const img = (page: number, params: Record<string, unknown>) => ({ action: "platform_composite_sheet_progress", params: { ...settings, notePageIndex: page, ...params } });
const out = (id: string) => ({ compositeImageUrl: `https://storage.googleapis.com/test/${id}.png` });

beforeAll(async () => {
  await pg.exec(`CREATE TABLE jobs (id varchar(64) PRIMARY KEY, "userId" varchar(64) NOT NULL, type text NOT NULL, provider varchar(64) NOT NULL,
    status text NOT NULL DEFAULT 'queued', input json NOT NULL, output json, error text, attempts integer NOT NULL DEFAULT 0,
    "createdAt" timestamp NOT NULL DEFAULT now(), "updatedAt" timestamp NOT NULL DEFAULT now());`);
  state.db = drizzle(pg);
}, 30_000);
afterAll(() => pg.close());
beforeEach(async () => {
  await pg.exec("TRUNCATE jobs"); state.texts.clear(); state.loads.length = 0; n = 0; state.unavailable = false;
  state.texts.set(`7:${D}`, BIG); state.texts.set(`8:${D}`, BIG);
  // 旧形态（main 建的行）
  await insert("old1", "7", img(1, { scriptContext: SMALL }), out("old1"));
  await insert("old2", "7", img(2, { scriptContext: SMALL }), out("old2"));
  // 新形态：只存摘要与本页正文
  await insert("new1", "7", img(1, { manuscriptDigest: D, pageBody: "p1" }), out("new1"));
  await insert("new2", "7", img(2, { manuscriptDigest: D, pageBody: "p2" }), out("new2"));
  // 同稿同设置的旧形态行（形态混合也拼成一套）
  await insert("legacyBig3", "7", img(3, { scriptContext: BIG }), out("legacyBig3"));
  // 干扰：他人同摘要、键缺失、JSON null、摘要相同但版式不同、失败行
  await insert("other8", "8", img(3, { manuscriptDigest: D }), out("other8"));
  await insert("nokeys", "7", img(3, {}), out("nokeys"));
  await insert("nullDigest", "7", img(3, { manuscriptDigest: null, scriptContext: null }), out("nullDigest"));
  await insert("layout", "7", img(3, { manuscriptDigest: D, subjectPosition: "center" }), out("layout"));
  await insert("failed", "7", img(3, { manuscriptDigest: D }), out("failed"), "failed");
  await insert("distill", "7", { action: "knowledge_card_distill", params: {} }, { distilledMarkdown: BIG, detailLevel: "full" });
});

describe("恢复 SQL（PGlite）：新增 manuscriptDigest 分支", () => {
  it("新形态锚点：只拼本人、同稿、同设置、成功的行；旧形态同稿行一起拼入；他人/缺键/null/异版式/失败行都不进", async () => {
    const r = await getKnowledgeCardRecovery("7", "new1");
    expect(r.markdown).toBe(BIG);
    expect(r.images.map(i => [i.page, i.jobId])).toEqual([[1, "new1"], [2, "new2"], [3, "legacyBig3"]]);
    expect(r.detailLevel).toBe("full");
    expect(state.loads.every(k => k.startsWith("7:"))).toBe(true);
  });
  it("读档锚点（distilledMarkdown = 大稿）能找回只存摘要的成品行（sha256 在 JS 端对同一字符串计算）", async () => {
    const r = await getKnowledgeCardRecovery("7", "distill");
    expect(r.markdown).toBe(BIG); expect(r.images).toEqual([]);
  });
  it("旧形态锚点：只拼旧形态同稿行，不读暂存（新增 OR 分支对 NULL/缺键行不放行）", async () => {
    const r = await getKnowledgeCardRecovery("7", "old1");
    expect(r.markdown).toBe(SMALL);
    expect(r.images.map(i => [i.page, i.jobId])).toEqual([[1, "old1"], [2, "old2"]]);
    expect(state.loads).toEqual([]);
  });
  it("列表：新旧两形态各一项，标题来自全文；暂时读不到时报错而不是悄悄少一项", async () => {
    const list = await listKnowledgeCardRecovery("7");
    expect(list.items.some(i => i.title.startsWith("大书"))).toBe(true);
    expect(list.items.map(i => i.title)).toContain("小书");
    state.texts.clear();
    // NOT_FOUND：确定取不回 → 跳过，旧形态与读档项照常
    const partial = await listKnowledgeCardRecovery("7");
    expect(partial.items.some(i => i.jobId === "old2" || i.jobId === "old1")).toBe(true);
    state.unavailable = true;
    await expect(listKnowledgeCardRecovery("7")).rejects.toThrow("暂时读不到");
    await expect(getKnowledgeCardRecovery("7", "distill")).rejects.toThrow("暂时读不到");
  });
});
