/**
 * 冷备「让路」判定回归（0911）。真跑脚本 + 本地桩 API，不连 GitHub。
 *
 * 两种情况本来就不是备份故障：前台任务占着机器等不到让开、正式机镜像比工作流旧（部署在途）。
 * 但让路不能变成无声停摆——所以只在「最近确实成功过」时才让路，久了仍要标红。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

let server: Server;
let apiUrl = "";
/** 桩返回的「最近一次成功」时间；null＝查不到 */
let lastSuccessIso: string | null = null;
let httpStatus = 200;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (!/\/actions\/workflows\/.+\/runs/.test(req.url || "")) {
      res.writeHead(404).end("{}");
      return;
    }
    if (httpStatus !== 200) {
      res.writeHead(httpStatus).end("{}");
      return;
    }
    res.writeHead(200, { "content-type": "application/json" }).end(
      JSON.stringify({
        workflow_runs: lastSuccessIso ? [{ id: 999, updated_at: lastSuccessIso }] : [],
      }),
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  apiUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

async function defer(reason: string, maxHours?: string) {
  const dir = await mkdtemp(nodePath.join(tmpdir(), "defer-"));
  const summaryFile = nodePath.join(dir, "summary.md");
  const args = ["scripts/growth-backup-defer.mjs", reason, ...(maxHours ? [maxHours] : [])];
  const env = {
    ...process.env,
    GITHUB_API_URL: apiUrl,
    GITHUB_REPOSITORY: "owner/repo",
    GH_TOKEN: "t",
    GITHUB_RUN_ID: "1",
    GITHUB_STEP_SUMMARY: summaryFile,
  };
  try {
    const { stdout } = await run("node", args, { env, cwd: process.cwd() });
    return { code: 0, out: stdout, summary: await readFile(summaryFile, "utf8").catch(() => "") };
  } catch (err) {
    const e = err as { code?: number; stderr?: string; stdout?: string };
    return {
      code: e.code ?? 1,
      out: `${e.stdout || ""}${e.stderr || ""}`,
      summary: await readFile(summaryFile, "utf8").catch(() => ""),
    };
  }
}

describe("冷备让路判定", () => {
  it("最近成功过：本轮让路（退出 0），并写清原因与距上次成功多久", async () => {
    lastSuccessIso = new Date(Date.now() - 3 * 3_600_000).toISOString();
    httpStatus = 200;
    const r = await defer("前台平台任务持续占用，等待 30 分钟仍未让开");
    expect(r.code).toBe(0);
    expect(r.out).toContain("::warning::");
    expect(r.out).toContain("前台平台任务持续占用");
    expect(r.summary).toContain("本轮让路");
    expect(r.summary).toMatch(/3\.\d 小时前/);
  }, 30_000);

  it("太久没成功：仍然标红（退出 1），不许无声停摆", async () => {
    lastSuccessIso = new Date(Date.now() - 30 * 3_600_000).toISOString();
    httpStatus = 200;
    const r = await defer("正式机镜像比工作流旧，等待部署落地超时");
    expect(r.code).toBe(1);
    expect(r.out).toContain("::error::");
    expect(r.out).toMatch(/30\.\d 小时前/);
    expect(r.summary).toContain("冷备失败");
  }, 30_000);

  it("阈值可调：24 小时内默认让路的场景，传 2 小时就该标红", async () => {
    lastSuccessIso = new Date(Date.now() - 3 * 3_600_000).toISOString();
    const r = await defer("前台占用", "2");
    expect(r.code).toBe(1);
  }, 30_000);

  it("查不到上次成功：不敢让路，标红让人看一眼", async () => {
    lastSuccessIso = null;
    httpStatus = 200;
    const r = await defer("前台占用");
    expect(r.code).toBe(1);
    expect(r.out).toContain("查不到上次成功备份的时间");
  }, 30_000);

  it("查询本身失败（API 出错）：同样标红，不当成让路", async () => {
    lastSuccessIso = new Date().toISOString();
    httpStatus = 500;
    const r = await defer("前台占用");
    expect(r.code).toBe(1);
  }, 30_000);
});

describe("工作流接线", () => {
  it("让路后续步骤全部被 BACKUP_DEFERRED 守住，不会半途上传半份备份", async () => {
    const yml = await readFile(".github/workflows/growth-backup.yml", "utf8");
    const steps = yml.split(/^      - name: /m).slice(1);
    const afterGate = steps.slice(steps.findIndex((s) => s.startsWith("Verify deployed cold-store routing")) + 1);
    const unguarded = afterGate
      .filter((s) => !/if: env\.BACKUP_DEFERRED != 'true'/.test(s))
      .filter((s) => !/if: always\(\)/.test(s) && !/if: \$\{\{ false \}\}/.test(s))
      .map((s) => s.split("\n")[0]);
    expect(unguarded).toEqual([]);
  }, 30_000);

  it("闸门会等部署落地再判，不是一次就红", async () => {
    const yml = await readFile(".github/workflows/growth-backup.yml", "utf8");
    const gate = yml.split("- name: Verify deployed cold-store routing")[1]?.split("- name: ")[0] || "";
    expect(gate).toContain("seq 1 20");
    expect(gate).toContain("growth-backup-defer.mjs");
  }, 30_000);
});
