/**
 * 冷备「让路」判定回归（0911）。真跑脚本 + 本地桩 API，不连 GitHub。
 *
 * 两种情况本来就不是备份故障：前台任务占着机器等不到让开、正式机镜像比工作流旧（部署在途）。
 * 但让路不能变成无声停摆——所以只在「最近确实成功过」时才让路，久了仍要标红。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile, utimes, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

let server: Server;
let apiUrl = "";
/** 桩返回的「最近一次成功」时间；null＝查不到 */
let lastSuccessIso: string | null = null;
let httpStatus = 200;
let newestWasDeferred = false;
let includeLegacyArtifact = false;
let publicationSucceeded = true;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (/\/actions\/runs\/\d+\/jobs/.test(req.url || "")) {
      const deferred = newestWasDeferred && req.url?.includes("/1000/jobs");
      res.writeHead(httpStatus, { "content-type": "application/json" }).end(JSON.stringify({ jobs: [{ steps: [
        ...(includeLegacyArtifact ? [{ name: "Upload GitHub backup artifact", conclusion: deferred ? "skipped" : "success" }] : []),
        { name: "Publish cold-store restore assets", conclusion: deferred || !publicationSucceeded ? "skipped" : "success" },
      ] }] }));
      return;
    }
    if (!/\/actions\/workflows\/growth-backup\.yml\/runs/.test(req.url || "")) {
      res.writeHead(404).end("{}");
      return;
    }
    if (httpStatus !== 200) {
      res.writeHead(httpStatus).end("{}");
      return;
    }
    res.writeHead(200, { "content-type": "application/json" }).end(
      JSON.stringify({
        workflow_runs: lastSuccessIso ? [
          ...(newestWasDeferred ? [{ id: 1000, updated_at: new Date().toISOString() }] : []),
          { id: 999, updated_at: lastSuccessIso },
        ] : [],
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
    GITHUB_WORKFLOW_REF: "owner/repo/.github/workflows/growth-backup.yml@refs/heads/main",
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
  it("私有发布成功且没有旧artifact步骤：本轮让路并记录最近成功时间", async () => {
    lastSuccessIso = new Date(Date.now() - 3 * 3_600_000).toISOString();
    httpStatus = 200;
    const r = await defer("前台平台任务持续占用，等待 30 分钟仍未让开");
    expect(r.code).toBe(0);
    expect(r.out).toContain("::warning::");
    expect(r.out).toContain("前台平台任务持续占用");
    expect(r.summary).toContain("本轮让路");
    expect(r.summary).toMatch(/3\.\d 小时前/);
  }, 30_000);

  it("只有旧artifact成功、私有发布跳过：不能计为成功备份", async () => {
    lastSuccessIso = new Date().toISOString();
    httpStatus = 200;
    includeLegacyArtifact = true;
    publicationSucceeded = false;
    try {
      const r = await defer("采集锁繁忙");
      expect(r.code).toBe(1);
      expect(r.out).toContain("查不到上次成功备份的时间");
    } finally {
      includeLegacyArtifact = false;
      publicationSucceeded = true;
    }
  });

  it("历史artifact与发布均成功的备份仍可识别", async () => {
    lastSuccessIso = new Date(Date.now() - 3 * 3_600_000).toISOString();
    httpStatus = 200;
    includeLegacyArtifact = true;
    try {
      expect((await defer("采集锁繁忙")).code).toBe(0);
    } finally { includeLegacyArtifact = false; }
  });

  it("太久没成功：仍然标红（退出 1），不许无声停摆", async () => {
    lastSuccessIso = new Date(Date.now() - 30 * 3_600_000).toISOString();
    httpStatus = 200;
    const r = await defer("正式机镜像比工作流旧，等待部署落地超时");
    expect(r.code).toBe(1);
    expect(r.out).toContain("::error::");
    expect(r.out).toMatch(/30\.\d 小时前/);
    expect(r.summary).toContain("冷备失败");
  }, 30_000);

  it("绿色让路不能刷新成功时钟：跳过新run，超过24小时仍失败", async () => {
    newestWasDeferred = true;
    httpStatus = 200;
    lastSuccessIso = new Date(Date.now() - 30 * 3_600_000).toISOString();
    try {
      const r = await defer("采集锁繁忙");
      expect(r.code).toBe(1);
      expect(r.out).toMatch(/30\.\d 小时前/);
    } finally { newestWasDeferred = false; }
  });

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
      .filter((s) => !/if: (?:env\.BACKUP_DEFERRED != 'true'|\$\{\{ success\(\) && env\.BACKUP_DEFERRED != 'true' \}\})/.test(s))
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

// 执行工作流内的真实锁获取函数，外部命令只替换为无副作用的本地桩。
describe("备份锁等待", () => {
  async function lane(mode: "busy" | "error" | "ready") {
    const yml = await readFile(".github/workflows/growth-backup.yml", "utf8");
    const fn = yml.slice(yml.indexOf("          acquire_backup_lane()"), yml.indexOf("          wait_for_interactive_workload()"));
    const dir = await mkdtemp(nodePath.join(tmpdir(), "backup-lane-"));
    const script = `set -e
mkdir -p "${dir}/growth-backup"
wait_for_started_vm() { return 0; }
sleep() { :; }
timeout() { shift 2; "$@"; }
flyctl() {
  if [ "${mode}" = ready ]; then return 0; fi
  if [ "${mode}" = busy ]; then echo GROWTH_BACKUP_LANE_BUSY=collection >&2; else echo 'network error' >&2; fi
  return 1
}
${fn.replace(/^          /gm, "").replaceAll("/tmp/", `${dir}/`)}
if acquire_backup_lane; then echo RESULT=0; else echo RESULT=$?; fi
`;
    return (await run("bash", ["-c", script])).stdout;
  }
  it("明确繁忙耗尽返回75供让路判定", async () => { expect(await lane("busy")).toContain("RESULT=75"); });
  it("SSH错误返回1不冒充采集繁忙", async () => { expect(await lane("error")).toContain("RESULT=1"); });
  it("成功取得锁直接继续", async () => { expect(await lane("ready")).toContain("RESULT=0"); });
  it("锁失败在启动心跳与传输前退出且仅75可让路", async () => {
    const yml = await readFile(".github/workflows/growth-backup.yml", "utf8");
    const gate = yml.split("          if acquire_backup_lane; then")[1]?.split("          BACKUP_REMOTE_WORK_STARTED=false")[0] || "";
    expect(gate).toContain('if [ "$lane_status" -ne 75 ]');
    expect(gate).toContain('exit "$lane_status"');
    expect(gate).toContain("growth-backup-defer.mjs");
    expect(gate).toContain('echo "BACKUP_DEFERRED=true"');
    expect(gate).toContain("exit 0");
  });
});


describe("远端锁保护真实脚本", () => {
  it("未来mtime冻结锁返回明确busy且原锁内容不变", async () => {
    const yml = await readFile(".github/workflows/growth-backup.yml", "utf8");
    const remote = yml.split("<<'SH'\n")[1]?.split("          SH")[0].replace(/^          /gm, "");
    expect(remote).toContain("GROWTH_BACKUP_LANE_BUSY=collection");
    const root = await mkdtemp(nodePath.join(tmpdir(), "backup-freeze-"));
    await mkdir(nodePath.join(root, "runtime-interactive-workloads"));
    const lock = nodePath.join(root, ".growth-platform-collection.lock");
    await writeFile(lock, "existing-freeze");
    const future = new Date(Date.now() + 7 * 86400_000);
    await utimes(lock, future, future);
    try {
      await run("sh", ["-c", remote!.replace("ROOT=/data/growth", `ROOT=${root}`)]);
      throw new Error("冻结锁被错误接受");
    } catch (err) {
      expect((err as { code: number }).code).toBe(43);
      expect((err as { stderr: string }).stderr).toContain("GROWTH_BACKUP_LANE_BUSY=collection");
    }
    expect(await readFile(lock, "utf8")).toBe("existing-freeze");
  });
});
