import { it, expect, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql, type SQL } from "drizzle-orm";
import * as databaseModule from "../db";
import { createManhuaPrevisStudio } from "../../shared/manhuaPrevis";
import {
  getPrevisTask,
  submitPrevisTask,
  type PrevisTaskDeps,
  listPrevisTasks,
  parsePrevisCursor,
  previsTaskId,
  type PrevisListDeps,
} from "./manhuaPrevisTask";
it("并发同编号只占一个任务，内容冲突拒绝，跨用户不可读取", async () => {
  const rows = new Map<string, any>();
  const d: PrevisTaskDeps = {
    load: async id => rows.get(id) ?? null,
    insert: vi.fn(async (id, userId, input) => {
      if (!rows.has(id))
        rows.set(id, {
          id,
          userId: String(userId),
          type: "post_prod",
          status: "queued",
          input: { action: "manhua_previs", params: input },
          output: null,
          error: null,
          provider: "blender-previs",
          createdAt: new Date(),
          updatedAt: new Date(),
        });
    }),
    sign: uri => uri,
  };
  const s = createManhuaPrevisStudio(2, "11111111-1111-4111-8111-111111111111");
  const input = {
    requestId: "22222222-2222-4222-8222-222222222222",
    scopeId: s.scopeId,
    clipId: "clip-1",
    spec: s.spec,
  };
  const [a, b] = await Promise.all([
    submitPrevisTask(7, input, d),
    submitPrevisTask(7, input, d),
  ]);
  expect(a.jobId).toBe(b.jobId);
  expect(rows.size).toBe(1);
  expect(await getPrevisTask(8, input.requestId, d)).toBeNull();
  await expect(
    submitPrevisTask(7, { ...input, clipId: "clip-2" }, d)
  ).rejects.toThrow("不同配置");
});

it("61条同毫秒历史用双键游标跨三页无丢失或重复", async () => {
  const studio = createManhuaPrevisStudio(
    2,
    "11111111-1111-4111-8111-111111111111"
  );
  const rows = Array.from({ length: 61 }, (_, index) => ({
    id: previsTaskId(7, String(index)),
    userId: "7",
    type: "post_prod",
    status: "queued",
    output: null,
    error: null,
    provider: "blender-previs",
    createdAt: new Date("2026-09-11T01:02:03.123Z"),
    updatedAt: new Date(),
    input: {
      action: "manhua_previs",
      params: {
        requestId: "22222222-2222-4222-8222-222222222222",
        scopeId: studio.scopeId,
        clipId: "clip-1",
        spec: studio.spec,
      },
    },
  })).sort((a, b) => b.id.localeCompare(a.id));
  const d: PrevisListDeps = {
    sign: uri => uri,
    list: vi.fn(async (userId, scopeId, clipId, cursor) => {
      expect([userId, scopeId, clipId]).toEqual([7, studio.scopeId, "clip-1"]);
      return rows
        .filter(
          row =>
            !cursor ||
            row.createdAt.toISOString() < cursor.createdAt ||
            (row.createdAt.toISOString() === cursor.createdAt &&
              row.id < cursor.id)
        )
        .slice(0, 31);
    }),
  };
  const first = await listPrevisTasks(
    7,
    studio.scopeId,
    "clip-1",
    undefined,
    d
  );
  expect(first.items).toHaveLength(30);
  expect(parsePrevisCursor(first.nextCursor!)).toEqual({
    createdAt: rows[29].createdAt.toISOString(),
    id: rows[29].id,
  });
  const second = await listPrevisTasks(
    7,
    studio.scopeId,
    "clip-1",
    first.nextCursor!,
    d
  );
  const third = await listPrevisTasks(
    7,
    studio.scopeId,
    "clip-1",
    second.nextCursor!,
    d
  );
  expect([second.items.length, third.items.length, third.nextCursor]).toEqual([
    30,
    1,
    null,
  ]);
  expect(
    [...first.items, ...second.items, ...third.items].map(row => row.jobId)
  ).toEqual(rows.map(row => row.id));
});

it("坏游标在查询数据库前拒绝，不退回第一页", async () => {
  const d: PrevisListDeps = { sign: uri => uri, list: vi.fn() };
  for (const before of [
    "",
    "bad-json",
    "2026-09-11T01:02:03.123Z",
    JSON.stringify({ createdAt: "bad-date", id: previsTaskId(7, "1") }),
    JSON.stringify({ createdAt: "2026-09-11T01:02:03.123Z", id: "foreign" }),
  ]) {
    await expect(
      listPrevisTasks(
        7,
        "11111111-1111-4111-8111-111111111111",
        "clip-1",
        before,
        d
      )
    ).rejects.toThrow();
  }
  expect(d.list).not.toHaveBeenCalled();
});

it("真实查询生成相同毫秒精度的双键SQL且保留用户项目过滤", async () => {
  let condition: SQL | undefined;
  let ordering: SQL[] = [];
  const limit = vi.fn(async () => []);
  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn((value: SQL) => {
      condition = value;
      return chain;
    }),
    orderBy: vi.fn((...values: SQL[]) => {
      ordering = values;
      return chain;
    }),
    limit,
  };
  const stub = vi
    .spyOn(databaseModule, "getDb")
    .mockResolvedValue({ select: () => chain } as never);
  const scope = "11111111-1111-4111-8111-111111111111";
  const id = previsTaskId(7, "1");
  try {
    await listPrevisTasks(
      7,
      scope,
      "clip-1",
      JSON.stringify({ createdAt: "2026-09-11T01:02:03.123Z", id })
    );
    const dialect = new PgDialect();
    const where = dialect.sqlToQuery(condition!);
    expect(where.sql).toContain("date_trunc('milliseconds'");
    expect(where.sql).toMatch(/\) < \(/);
    expect(where.params).toContain("7");
    expect(where.params).toContain(scope);
    expect(where.params).toContain("clip-1");
    expect(where.params).toContain(id);
    expect(dialect.sqlToQuery(sql.join(ordering, sql`, `)).sql).toMatch(
      /date_trunc\('milliseconds'.*desc, .*"id" desc/
    );
    expect(limit).toHaveBeenCalledWith(31);
  } finally {
    stub.mockRestore();
  }
});
