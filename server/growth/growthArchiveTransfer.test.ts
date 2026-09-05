import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";

const guard = path.resolve("scripts/growth-archive-transfer.mjs");
const remote = path.resolve("scripts/growth-archive-offload-remote.sh");
const tempDirs: string[] = [];
async function temp() {
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), "archive-transfer-test-")
  );
  tempDirs.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of tempDirs.splice(0))
    await fs.rm(dir, { recursive: true, force: true });
});
function run(
  command: string,
  args: string[],
  options: {
    env?: NodeJS.ProcessEnv;
    input?: string | Buffer;
    cancelAfterMs?: number;
  } = {}
) {
  return new Promise<{ code: number | null; stdout: Buffer; stderr: string }>(
    (resolve, reject) => {
      const child = spawn(command, args, {
        env: { ...process.env, ...options.env },
        stdio: "pipe",
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      child.stdout.on("data", chunk => stdout.push(chunk));
      child.stderr.on("data", chunk => stderr.push(chunk));
      child.stdin.end(options.input ?? "");
      const cancel = options.cancelAfterMs
        ? setTimeout(() => child.kill("SIGTERM"), options.cancelAfterMs)
        : undefined;
      const deadline = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("测试子进程超时"));
      }, 8000);
      child.on("error", reject);
      child.on("close", code => {
        clearTimeout(deadline);
        if (cancel) clearTimeout(cancel);
        resolve({
          code,
          stdout: Buffer.concat(stdout),
          stderr: Buffer.concat(stderr).toString(),
        });
      });
    }
  );
}
function guarded(
  program: string,
  flags: string[] = [],
  options: Parameters<typeof run>[2] = {}
) {
  return run(
    process.execPath,
    [
      guard,
      "--idle-ms",
      "400",
      "--max-ms",
      "3000",
      "--grace-ms",
      "80",
      ...flags,
      "--",
      process.execPath,
      "-e",
      program,
    ],
    options
  );
}

describe("归档传输实际子进程保护", () => {
  it("保持二进制 gzip 字节与 stdin，不把诊断混入包", async () => {
    const payload = gzipSync(Buffer.from("实际归档内容\u0000\u0001"));
    const result = await guarded(
      `process.stdin.on('data', data => process.stdout.write(data));`,
      [],
      { input: payload }
    );
    expect(result.code).toBe(0);
    expect(gunzipSync(result.stdout).toString()).toBe(
      "实际归档内容\u0000\u0001"
    );
  });
  it("无输出连接挂住时超时，stderr 心跳不能冒充数据进度", async () => {
    const result = await guarded(
      `setInterval(() => process.stderr.write('Connecting...\\n'), 20);`
    );
    expect(result.code).toBe(124);
    expect(result.stderr).toContain("无数据进度时限");
    expect(result.stdout.length).toBe(0);
  });
  it("中途断流并忽略 TERM 时仍强制结束整个本地进程组", async () => {
    const dir = await temp();
    const ticks = path.join(dir, "ticks");
    const descendant = `const fs=require('node:fs');process.on('SIGTERM',()=>{});setInterval(()=>fs.appendFileSync(${JSON.stringify(ticks)},'x'),20);`;
    const result = await guarded(
      `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'inherit'});process.stdout.write('partial');process.on('SIGTERM',()=>{});setInterval(()=>{},50);`
    );
    expect(result.code).toBe(124);
    expect(result.stdout.toString()).toBe("partial");
    const size = (await fs.stat(ticks)).size;
    await new Promise(resolve => setTimeout(resolve, 150));
    expect((await fs.stat(ticks)).size).toBe(size);
  });
  it("持续有字节可超过空闲时限，仍受总时限约束", async () => {
    const result = await guarded(
      `setInterval(()=>process.stdout.write('x'),40);`,
      ["--idle-ms", "250", "--max-ms", "650"]
    );
    expect(result.code).toBe(124);
    expect(result.stdout.length).toBeGreaterThan(5);
    expect(result.stderr).toContain("总时限");
  });
  it("健康慢流持续超过空闲时限仍完整成功", async () => {
    const result = await guarded(
      `let n=0;const timer=setInterval(()=>{process.stdout.write('x');if(++n===12)clearInterval(timer);},60);`
    );
    expect(result.code).toBe(0);
    expect(result.stdout.toString()).toBe("x".repeat(12));
  });
  it("普通失败不伪装前台繁忙；让行标记兼容 flyctl 折叠退出码", async () => {
    expect((await guarded(`process.exit(1)`)).code).toBe(1);
    expect(
      (
        await guarded(
          `process.stderr.write('GROWTH_ARCHIVE_BUSY\\n');process.exit(1)`
        )
      ).code
    ).toBe(75);
    expect(
      (
        await guarded(
          `process.stderr.write('GROWTH_ARCHIVE_BUSY\\n');process.exit(0)`
        )
      ).code
    ).toBe(0);
  });
  it("取消退出143且停止子进程，不进入成功路径", async () => {
    const result = await guarded(
      `setInterval(()=>process.stdout.write('x'),20);`,
      [],
      { cancelAfterMs: 250 }
    );
    expect(result.code).toBe(143);
    expect(result.stderr).toContain("取消信号");
  });
  it("远端真实繁忙输出明确标记；错误目录不能让行", async () => {
    const dir = await temp();
    await fs.mkdir(path.join(dir, "runtime-interactive-workloads"));
    await fs.writeFile(
      path.join(dir, "runtime-interactive-workloads", "busy"),
      "test"
    );
    const busy = await run(
      process.execPath,
      [guard, "--", "sh", remote, "bundle", "test-batch", "2026-09-01-00"],
      { env: { GROWTH_STORE_DIR: dir } }
    );
    expect(busy.code).toBe(75);
    await fs.unlink(path.join(dir, "runtime-interactive-workloads", "busy"));
    const missing = await run(
      process.execPath,
      [guard, "--", "sh", remote, "bundle", "test-batch", "missing"],
      { env: { GROWTH_STORE_DIR: dir } }
    );
    expect(missing.code).toBe(66);
  });
});

const workflows = ["growth-backup.yml", "growth-archive-offload.yml"];
function step(text: string, name: string) {
  const body = text
    .split(`      - name: ${name}\n`)[1]
    ?.split(/\n      - (?:name:|uses:)/)[0];
  if (!body) throw new Error(`未找到真实步骤 ${name}`);
  return body
    .split("        run: |\n")[1]
    .split("\n")
    .map(line => line.replace(/^          /, ""))
    .join("\n");
}
async function executable(file: string, source: string) {
  await fs.writeFile(file, `#!${process.execPath}\n${source}`);
  await fs.chmod(file, 0o755);
}

// 执行真实 YAML 中的下载步骤；只把目录和外部程序替换到无凭证临时夹。
async function workflowDownload(name: string, mode: string) {
  const dir = await temp();
  const archive = path.join(dir, "offload");
  const backup = path.join(dir, "backup");
  const bin = path.join(dir, "bin");
  await Promise.all([fs.mkdir(archive), fs.mkdir(backup), fs.mkdir(bin)]);
  await fs.writeFile(path.join(archive, "batch-id.txt"), "test-batch");
  await fs.writeFile(
    path.join(archive, "snapshot.tsv"),
    `2026-09-01-00\t${"a".repeat(64)}\t100\n2026-09-01-01\t${"b".repeat(64)}\t100\n`
  );
  await executable(
    path.join(bin, "flyctl"),
    `const fs=require('node:fs');fs.appendFileSync(${JSON.stringify(path.join(dir, "calls"))},'x');
if(${JSON.stringify(mode)}==='hang'){process.stdout.write('partial');setInterval(()=>{},50);}
else if(${JSON.stringify(mode)}==='fail'){process.stderr.write('connection failed');process.exit(1);}
else if(${JSON.stringify(mode)}==='corrupt'){process.stdout.write('not gzip');}
else {const cp=require('node:child_process');const command=process.argv[process.argv.indexOf('-C')+1];const archiveDir=command.match(/'([^']+)'$/)[1];process.stdout.write(require('node:zlib').gzipSync(cp.execFileSync('tar',['-cf','-', '-C', ${JSON.stringify(dir)}, archiveDir],{stdio:['ignore','pipe',2]}))); }`
  );
  await executable(path.join(bin, "sleep"), "process.exit(0);");
  await executable(
    path.join(bin, "stat"),
    "process.stdout.write(String(require('node:fs').statSync(process.argv.at(-1)).size));"
  );
  await executable(
    path.join(bin, "sha256sum"),
    "process.stdout.write(require('node:crypto').createHash('sha256').update(require('node:fs').readFileSync(process.argv.at(-1))).digest('hex')+'  '+process.argv.at(-1)+'\\n');"
  );
  for (const name of ["2026-09-01-00", "2026-09-01-01"]) {
    await fs.mkdir(path.join(dir, name));
    await fs.writeFile(
      path.join(dir, name, "bilibili-test.json.gz"),
      gzipSync('{"items":[{"id":"test-item"}]}')
    );
  }
  const text = await fs.readFile(
    path.resolve(".github/workflows", name),
    "utf8"
  );
  const script = step(text, "Download and verify archive bundles locally")
    .replaceAll(
      "flyctl ssh",
      `${process.execPath} ${path.join(bin, "flyctl")} ssh`
    )
    .replaceAll("stat -c", `${process.execPath} ${path.join(bin, "stat")} -c`)
    .replaceAll(
      "sha256sum ",
      `${process.execPath} ${path.join(bin, "sha256sum")} `
    )
    .replaceAll("sleep ", `${process.execPath} ${path.join(bin, "sleep")} `)
    .replaceAll("/tmp/growth-archive-offload", archive)
    .replaceAll("/tmp/growth-backup", backup)
    .replaceAll(
      "node scripts/growth-archive-transfer.mjs --",
      `node scripts/growth-archive-transfer.mjs --idle-ms 400 --max-ms 3000 --grace-ms 80 --`
    );
  const result = await run("bash", ["-eo", "pipefail", "-c", script], {
    env: { PATH: `${bin}:${process.env.PATH}` },
  });
  return { ...result, archive, dir };
}

describe.each(workflows)("%s 真实步骤离线回归", name => {
  it.each(["hang", "fail", "corrupt"])(
    "%s 不发布最终清单、不误让行、不重复打包",
    async mode => {
      const result = await workflowDownload(name, mode);
      expect(result.code).not.toBe(0);
      expect(
        await fs
          .readFile(path.join(result.dir, "calls"), "utf8")
          .catch(() => "MISSING: " + result.stderr + result.stdout.toString())
      ).toBe("x");
      await expect(
        fs.stat(path.join(result.archive, "archives.tsv"))
      ).rejects.toThrow();
      await expect(
        fs.stat(path.join(result.archive, "DELETE_READY"))
      ).rejects.toThrow();
      expect(
        gunzipSync(
          await fs.readFile(
            path.join(result.dir, "2026-09-01-00", "bilibili-test.json.gz")
          )
        ).toString()
      ).toContain("test-item");
      if (mode === "hang") expect(result.stderr).toContain("无数据进度时限");
    }
  );
  it("两目录真实gzip/tar/SHA成功后清单完整，不被stdin吞掉下一目录", async () => {
    const result = await workflowDownload(name, "success");
    expect(result.code, result.stderr + result.stdout.toString()).toBe(0);
    expect(
      await fs
        .readFile(path.join(result.dir, "calls"), "utf8")
        .catch(() => "MISSING: " + result.stderr + result.stdout.toString())
    ).toBe("xx");
    const rows = (
      await fs.readFile(path.join(result.archive, "archives.tsv"), "utf8")
    )
      .trim()
      .split("\n");
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const [, asset, bytes, sha] = row.split("\t");
      const body = await fs.readFile(
        path.join(result.archive, "assets", asset)
      );
      expect(body.length).toBe(Number(bytes));
      expect(sha).toBe(createHash("sha256").update(body).digest("hex"));
      expect(
        gunzipSync(body).includes(Buffer.from("bilibili-test.json.gz"))
      ).toBe(true);
    }
  });
});
