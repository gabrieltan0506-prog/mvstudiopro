import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  return { ...fs, readFileSync: (...args: Parameters<typeof fs.readFileSync>) =>
    args[0] === "/proc/sys/kernel/random/boot_id" ? "test-boot" : fs.readFileSync(...args) };
});
import { executePrune } from "../../scripts/vercel-prune-preview-deployments.mjs";

const PROJECT = "prj_7y3mwOmGqVDHRkQYWZLmmBinkSvI";
function setup() {
  const root = mkdtempSync(join(tmpdir(), "vercel-runtime-test-"));
  let active = false;
  const requests: { method: string; url: URL }[] = [];
  const fetch = vi.fn(async (raw: URL, init: RequestInit) => {
    const url = new URL(raw); const method = init.method || "GET";
    requests.push({ method, url });
    init.signal?.throwIfAborted();
    if (url.pathname.startsWith("/v9/projects/")) return Response.json({ id: PROJECT, name: "mvstudiopro", targets: { production: { id: "prod" } } });
    if (url.pathname === "/v6/deployments" && url.searchParams.has("state")) return Response.json({ deployments: active ? [{ uid: "building" }] : [] });
    if (url.pathname === "/v6/deployments") return Response.json({ deployments: [{ uid: "old", target: null, readyState: "READY", created: Date.now() - 30 * 86400000 }], pagination: { next: null } });
    if (url.pathname === "/v13/deployments/old" && method === "GET") return Response.json({ id: "old", projectId: PROJECT, target: null, readyState: "READY", alias: [], env: { secret: "must-not-be-audited" } });
    if (url.pathname === "/v13/deployments/old" && method === "DELETE") return Response.json({});
    throw Error("未模拟请求");
  });
  vi.stubGlobal("fetch", fetch);
  return { root, requests, fetch, active: () => { active = true; },
    audit: () => readdirSync(root).filter(f => f.endsWith(".jsonl")).flatMap(f => readFileSync(join(root, f), "utf8").trim().split("\n").map(line => JSON.parse(line))) };
}
beforeEach(() => {
  vi.stubEnv("FLY_APP_NAME", "mvstudiopro"); vi.stubEnv("FLY_MACHINE_ID", "test-machine"); vi.stubEnv("VERCEL_TOKEN", "test-key");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("清理运行器整体路径（仅内存HTTP替身）", () => {
  it("空跑读取真实编排但零DELETE，输出计划回执并释放锁", async () => {
    const f = setup(); const r = await executePrune({ root: f.root });
    expect(r).toMatchObject({ dryRun: true, candidates: 1, deleted: 0 });
    expect(f.requests.filter(x => x.method === "DELETE")).toHaveLength(0);
    expect(f.audit().some(e => e.event === "plan")).toBe(true);
    expect(existsSync(join(f.root, "active.lock"))).toBe(false);
  });
  it("应用运行器完整执行删除并持久回执，所有请求固定正确团队", async () => {
    const f = setup(); const r = await executePrune({ root: f.root, apply: true });
    expect(r).toMatchObject({ attempted: 1, deleted: 1, dryRun: false });
    expect(f.requests.filter(x => x.method === "DELETE").map(x => x.url.pathname)).toEqual(["/v13/deployments/old"]);
    expect(f.requests.every(x => x.url.searchParams.get("teamId") === "team_Ufhs4eiVYHpuryokmvrlzHIf")).toBe(true);
    expect(f.audit().map(e => e.event)).toContain("delete-result");
    expect(JSON.stringify(f.audit())).not.toMatch(/must-not-be-audited|test-key/);
  });
  it("活跃构建返回可延期且零删除，锁正常释放", async () => {
    const f = setup(); f.active();
    await expect(executePrune({ root: f.root, apply: true })).rejects.toMatchObject({ code: "PRUNE_DEFERRED", attemptedDelete: false });
    expect(f.requests.filter(x => x.method === "DELETE")).toHaveLength(0);
    expect(existsSync(join(f.root, "active.lock"))).toBe(false);
  });
  it("缺token仍有失败回执，绝不请求网络", async () => {
    const f = setup(); vi.stubEnv("VERCEL_TOKEN", "");
    await expect(executePrune({ root: f.root, apply: true })).rejects.toThrow(/缺少/);
    expect(f.fetch).not.toHaveBeenCalled(); expect(f.audit().at(-1)).toMatchObject({ reason: "missing-token" });
  });
  it("停机信号阻止后续请求并保留中止证据", async () => {
    const f = setup(); const controller = new AbortController(); controller.abort();
    await expect(executePrune({ root: f.root, apply: true, signal: controller.signal })).rejects.toBeDefined();
    expect(f.requests.some(x => x.method === "DELETE")).toBe(false);
    expect(f.audit().at(-1)).toMatchObject({ event: "aborted" });
  });
});
