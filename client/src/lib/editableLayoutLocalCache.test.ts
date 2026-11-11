import { expect, it } from "vitest";
import { layoutFromSource, type LayoutLibrary } from "@shared/editableLayout";
import {
  compactLayoutCache, legacyCacheSafeToDrop, mergeCompactWithCloud, parseCompactLayoutCache, parseLegacyLayoutCache,
  provisionalFromCompact, syncedLayoutVersions,
} from "./editableLayoutLocalCache";

const doc = (title: string, body = "正文".repeat(2000)) => ({ ...layoutFromSource({ owner: "7", sourceId: title, title, body }), updatedAt: "2026-11-10T00:00:00.000Z" });
const library = (docs: ReturnType<typeof doc>[]): LayoutLibrary => ({ version: 1, owner: "7", documents: docs });

it("瘦身：只完整保存当前打开的稿，其他稿只留索引，体积远小于整库", () => {
  const docs = Array.from({ length: 20 }, (_, i) => doc(`稿${i}`));
  const state = { library: library(docs), generation: "100", dirty: false, activeId: docs[3].id };
  const compact = compactLayoutCache(state, syncedLayoutVersions(state.library));
  expect(compact.documents.map(d => d.id)).toEqual([docs[3].id]);
  expect(compact.index).toHaveLength(20);
  expect(compact.index[0]).toEqual({ id: docs[0].id, title: "稿0", updatedAt: docs[0].updatedAt });
  const full = JSON.stringify({ library: state.library, generation: "100", dirty: false, activeId: "" }).length;
  expect(JSON.stringify(compact).length).toBeLessThan(full / 10);
  expect(parseCompactLayoutCache(JSON.stringify(compact), "7")).toEqual(compact);
  expect(() => parseCompactLayoutCache(JSON.stringify(compact), "8")).toThrow("账号");
});
it("未同步的修改稿即使不在打开状态也完整保存，云端已同步的稿不重复保存", () => {
  const [a, b, c] = [doc("甲"), doc("乙"), doc("丙")];
  const syncedLib = library([a, b, c]);
  const synced = syncedLayoutVersions(syncedLib);
  const editedB = { ...b, title: "乙改", updatedAt: "2026-11-11T00:00:00.000Z" };
  const compact = compactLayoutCache({ library: library([a, editedB, c]), generation: "5", dirty: true, activeId: c.id }, synced);
  expect(compact.documents.map(d => d.title).sort()).toEqual(["丙", "乙改"]);
});
it("云端读回：本机无修改以云端为准；有修改且同版本叠加本机稿；版本不同保留旧版本号使保存冲突而非覆盖", () => {
  const [a, b] = [doc("甲"), doc("乙")];
  const cloud = { library: library([a, b]), generation: "9" };
  const clean = compactLayoutCache({ library: library([a, b]), generation: "9", dirty: false, activeId: a.id });
  expect(mergeCompactWithCloud(clean, cloud, "7")).toEqual({ state: { library: cloud.library, generation: "9", dirty: false, activeId: "" }, conflict: false });
  const edited = { ...a, title: "甲改" };
  const dirty = compactLayoutCache({ library: library([edited, b]), generation: "9", dirty: true, activeId: a.id });
  const same = mergeCompactWithCloud(dirty, cloud, "7");
  expect(same.conflict).toBe(false);
  expect(same.state.library.documents.map(d => d.title)).toEqual(["甲改", "乙"]);
  expect(same.state).toMatchObject({ generation: "9", dirty: true, activeId: a.id });
  const moved = mergeCompactWithCloud(dirty, { ...cloud, generation: "12" }, "7");
  expect(moved).toMatchObject({ conflict: true, state: { generation: "9", dirty: true } });
});
it("云端未读回前的暂存库不完整（调用方据此禁止整库保存）", () => {
  const a = doc("甲"), lib = library([a, doc("乙")]);
  const compact = compactLayoutCache({ library: lib, generation: "3", dirty: true, activeId: a.id }, syncedLayoutVersions(lib));
  expect(provisionalFromCompact(compact, "7")).toMatchObject({ generation: "3", dirty: true, activeId: a.id, library: { documents: [a] } });
});
it("旧完整库迁移：云端同版本或更新且本机无未保存修改才可删除；否则原样保留", () => {
  expect(legacyCacheSafeToDrop({ generation: "1731300000000000", dirty: false }, { generation: "1731300000000000", hasLibrary: true })).toBe(true);
  expect(legacyCacheSafeToDrop({ generation: "1731300000000000", dirty: false }, { generation: "1731300000000001", hasLibrary: true })).toBe(true);
  expect(legacyCacheSafeToDrop({ generation: "1731300000000002", dirty: false }, { generation: "1731300000000001", hasLibrary: true })).toBe(false);
  expect(legacyCacheSafeToDrop({ generation: "5", dirty: true }, { generation: "9", hasLibrary: true })).toBe(false);
  expect(legacyCacheSafeToDrop({ generation: "5", dirty: false }, { generation: "0", hasLibrary: false })).toBe(false);
  const lib = library([doc("甲")]);
  expect(parseLegacyLayoutCache(JSON.stringify({ library: lib, generation: "5", dirty: true }), "7")).toEqual({ library: lib, generation: "5", dirty: true, activeId: "" });
  expect(() => parseLegacyLayoutCache(JSON.stringify({ library: lib, generation: "5" }), "8")).toThrow();
});
