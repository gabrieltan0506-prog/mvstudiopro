/**
 * Postgres 实现的 SQL 形状测试：**本仓没有可用的离线 Postgres**（无 pglite / 无 Docker），
 * 所以这里用假 `execute` 捕获语句文本与参数，断言排他与 CAS 确实落在 SQL 谓词里，
 * 而不是在 JS 里先读后写。真实数据库的原子性由唯一索引 + RETURNING 保证——
 * **该层离线未验，交审材料必须如实标注。**
 */
import { describe, expect, it } from "vitest";
import { PgCanvasIntentStore, type CanvasIntentRow } from "./canvasIntentStore";

/** 把 drizzle 的 sql 模板还原成可读文本 + 参数列表（只认 StringChunk / Param / 嵌套 SQL） */
function render(q: unknown): { text: string; params: unknown[] } {
  const params: unknown[] = [];
  const walk = (node: unknown): string => {
    if (node == null) return "";
    // drizzle 的模板把插值原样留在 queryChunks 里（数字/字符串），构建时才包成 Param
    if (typeof node !== "object") {
      params.push(node);
      return `$${params.length}`;
    }
    const n = node as { queryChunks?: unknown[]; value?: unknown };
    if (Array.isArray(n.queryChunks)) return n.queryChunks.map(walk).join("");
    if (Array.isArray(n.value)) return (n.value as unknown[]).map(String).join(""); // StringChunk
    if ("value" in n) {
      params.push(n.value); // Param
      return `$${params.length}`;
    }
    return "";
  };
  return { text: walk(q).replace(/\s+/g, " ").trim(), params };
}

function fakeDb(rowsOrThrow: Record<string, unknown>[] | Error) {
  const calls: Array<{ text: string; params: unknown[] }> = [];
  const db = {
    execute: async (q: unknown) => {
      calls.push(render(q));
      if (rowsOrThrow instanceof Error) throw rowsOrThrow;
      return { rows: rowsOrThrow };
    },
  };
  return { db: db as never, calls };
}

const row: CanvasIntentRow = {
  intentId: "gi_1", userId: 7, operation: "clip", requestDigest: "d1", stage: "reserved",
  taskId: "cv_t1", holderId: "H", leaseExpiresAt: "2026-09-15T10:00:00.000Z",
  createdAt: "2026-09-15T09:59:00.000Z", updatedAt: "2026-09-15T09:59:00.000Z",
};

describe("PgCanvasIntentStore：排他与 CAS 在 SQL 里", () => {
  it("占位 = INSERT … ON CONFLICT (userId,intentId) DO NOTHING RETURNING；有行=inserted，无行=exists", async () => {
    const a = fakeDb([{ intentId: "gi_1" }]);
    expect((await new PgCanvasIntentStore(a.db).insertIfAbsent(row)).kind).toBe("inserted");
    expect(a.calls[0]!.text).toMatch(/INSERT INTO "canvas_generation_intents"/);
    expect(a.calls[0]!.text).toMatch(/ON CONFLICT \("userId", "intentId"\) DO NOTHING RETURNING "intentId"/);
    const b = fakeDb([]);
    expect((await new PgCanvasIntentStore(b.db).insertIfAbsent(row)).kind).toBe("exists");
  });

  it("接管/推进 = 单条 UPDATE，holderId 与租约谓词都在 WHERE 里，RETURNING 判命中", async () => {
    const a = fakeDb([{ ...row, holderId: "B" }]);
    const res = await new PgCanvasIntentStore(a.db).casUpdate({
      userId: 7, intentId: "gi_1", expectHolderId: "H", requireLeaseExpiredBefore: "2026-09-15T10:00:01.000Z",
      patch: { holderId: "B", leaseExpiresAt: "2026-09-15T10:01:00.000Z", updatedAt: "2026-09-15T10:00:01.000Z" },
    });
    expect(res.kind).toBe("updated");
    const { text, params } = a.calls[0]!;
    expect(text).toMatch(/^UPDATE "canvas_generation_intents" SET/);
    expect(text).toMatch(/WHERE "userId" = \$\d+ AND "intentId" = \$\d+ AND "holderId" = \$\d+ AND "leaseExpiresAt" < \$\d+::timestamptz RETURNING/);
    expect(params).toContain("H"); // 期望的旧持有者进了谓词
    expect(text).not.toMatch(/SELECT/); // 不是先读再写
  });

  it("不带租约条件时不出现租约谓词（普通阶段推进只认 holderId）", async () => {
    const a = fakeDb([row]);
    await new PgCanvasIntentStore(a.db).casUpdate({
      userId: 7, intentId: "gi_1", expectHolderId: "H",
      patch: { stage: "charged", chargeKey: "ck", leaseExpiresAt: "L", updatedAt: "U" },
    });
    expect(a.calls[0]!.text).not.toMatch(/"leaseExpiresAt" </);
    expect(a.calls[0]!.text).toMatch(/"holderId" = \$\d+ RETURNING/);
  });

  it("UPDATE 影响 0 行 → no_match（不是错误，也不是 null 混同）", async () => {
    const a = fakeDb([]);
    const res = await new PgCanvasIntentStore(a.db).casUpdate({
      userId: 7, intentId: "gi_1", expectHolderId: "H", patch: { leaseExpiresAt: "L", updatedAt: "U" },
    });
    expect(res.kind).toBe("no_match");
  });

  it("任何 SQL 报错 → unreadable，带原因；绝不映射成 none/exists", async () => {
    const boom = fakeDb(new Error("connection reset"));
    const s = new PgCanvasIntentStore(boom.db);
    expect((await s.insertIfAbsent(row)).kind).toBe("unreadable");
    expect((await s.get(7, "gi_1")).kind).toBe("unreadable");
    const u = await s.casUpdate({ userId: 7, intentId: "gi_1", expectHolderId: "H", patch: { leaseExpiresAt: "L", updatedAt: "U" } });
    expect(u.kind).toBe("unreadable");
    if (u.kind === "unreadable") expect(u.reasonZh).toContain("connection reset");
  });

  it("读到的行字段残缺（stage 非法/缺 taskId）→ unreadable，不猜", async () => {
    const a = fakeDb([{ ...row, stage: "weird" }]);
    expect((await new PgCanvasIntentStore(a.db).get(7, "gi_1")).kind).toBe("unreadable");
    const b = fakeDb([{ ...row, taskId: "" }]);
    expect((await new PgCanvasIntentStore(b.db).get(7, "gi_1")).kind).toBe("unreadable");
  });

  it("timestamptz 回来是 Date 时转 ISO；chargeKey 为 null 时字段不出现", async () => {
    const a = fakeDb([{ ...row, chargeKey: null, leaseExpiresAt: new Date("2026-09-15T10:00:00Z") }]);
    const got = await new PgCanvasIntentStore(a.db).get(7, "gi_1");
    expect(got.kind).toBe("ok");
    if (got.kind !== "ok") return;
    expect(got.row.leaseExpiresAt).toBe("2026-09-15T10:00:00.000Z");
    expect("chargeKey" in got.row).toBe(false);
  });
});
