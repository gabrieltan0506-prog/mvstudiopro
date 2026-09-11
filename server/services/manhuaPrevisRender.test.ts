import { it, expect } from "vitest";
import {
  mkdir,
  mkdtemp,
  readFile,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import path from "node:path";
import { createManhuaPrevisStudio } from "../../shared/manhuaPrevis";
import {
  renderManhuaPrevis,
  runPrevisProcess,
  type PrevisRenderDeps,
} from "./manhuaPrevisRender";

for (const failure of [
  "准备失败",
  "准备超时",
  "报告格式错误",
  "报告门禁拒绝",
]) {
  it(`${failure}仍先保全原报告和字节校验信息，不重跑`, async () => {
    const controller = new AbortController();
    const report =
      failure === "报告格式错误"
        ? "{broken-json"
        : JSON.stringify({ frames: 1, fps: 24, actors: [] });
    const stored = new Map<string, Buffer>();
    let runs = 0;
    const deps: PrevisRenderDeps = {
      blender: "test-blender",
      useXvfb: false,
      run: async (_command, args) => {
        runs++;
        await writeFile(
          path.join(args[args.length - 1], "report.json"),
          report
        );
        if (failure === "准备超时") {
          controller.abort();
          throw new DOMException("停止", "AbortError");
        }
        if (failure === "准备失败") throw new Error("准备失败");
        return "";
      },
      upload: async ({ objectName, buffer, signal }) => {
        expect(signal?.aborted).toBe(false);
        stored.set(path.basename(objectName), buffer);
        return {
          bucket: "test-bucket",
          objectName,
          gcsUri: `gs://test-bucket/${objectName}`,
        };
      },
    };
    const studio = createManhuaPrevisStudio(
      2,
      "11111111-1111-4111-8111-111111111111"
    );
    await expect(
      renderManhuaPrevis(
        {
          requestId: "22222222-2222-4222-8222-222222222222",
          scopeId: studio.scopeId,
          clipId: "clip-test",
          spec: studio.spec,
        },
        "7",
        { signal: controller.signal },
        deps
      )
    ).rejects.toThrow();
    expect(runs).toBe(1);
    expect(Array.from(stored.keys())).toEqual([
      "request.json",
      "report.json",
      "evidence.json",
      ...(failure === "报告门禁拒绝"
        ? ["report.parsed.json", "report.parsed-evidence.json"]
        : []),
    ]);
    expect(stored.get("report.json")?.toString()).toBe(report);
    const evidence = JSON.parse(stored.get("evidence.json")!.toString());
    expect(evidence.report.bytes).toBe(Buffer.byteLength(report));
    expect(evidence.report.sha256).toBe(
      createHash("sha256").update(report).digest("hex")
    );
  });
}

for (const abort of [false, true]) {
  it(`长时渲染${abort ? "中止" : "失败"}之前已永久保存报告和受控场景`, async () => {
    const stored: string[] = [];
    const controller = new AbortController();
    const studio = createManhuaPrevisStudio(
      2,
      "11111111-1111-4111-8111-111111111111"
    );
    let runs = 0;
    const d: PrevisRenderDeps = {
      blender: "test-blender",
      useXvfb: false,
      upload: async ({ objectName }) => {
        stored.push(path.basename(objectName));
        return {
          bucket: "test-bucket",
          objectName,
          gcsUri: `gs://test-bucket/${objectName}`,
        };
      },
      run: async (_command, args) => {
        runs++;
        if (runs === 1) {
          const dir = args[args.length - 1];
          await writeFile(
            path.join(dir, "report.json"),
            JSON.stringify({
              frames: 48,
              fps: 24,
              actors: [
                {
                  id: "actor-1",
                  nameZh: studio.spec.actors[0].nameZh,
                  bones: 16,
                  contactError: 0,
                  stanceDrift: 0,
                  offscreenFrames: [],
                },
              ],
              warnings: [],
            })
          );
          await writeFile(path.join(dir, "scene.blend"), Buffer.alloc(1024));
          return "";
        }
        expect(stored).toEqual([
          "request.json",
          "report.json",
          "evidence.json",
          "report.parsed.json",
          "report.parsed-evidence.json",
          "scene.blend",
        ]);
        expect(args).toContain("--disable-autoexec");
        expect(args).toContain("--render-anim");
        expect(args).not.toContain("--python");
        if (abort) controller.abort();
        throw new Error("长时渲染终止");
      },
    };
    await expect(
      renderManhuaPrevis(
        {
          requestId: "22222222-2222-4222-8222-222222222222",
          scopeId: studio.scopeId,
          clipId: "clip-test",
          spec: studio.spec,
        },
        "7",
        { signal: controller.signal },
        d
      )
    ).rejects.toThrow("长时渲染终止");
    expect(runs).toBe(2);
    expect(stored).not.toContain("preview.mp4");
  });
}

function fixture() {
  const studio = createManhuaPrevisStudio(
    2,
    "11111111-1111-4111-8111-111111111111"
  );
  const stored = new Map<string, Buffer>();
  const report = {
    frames: 48,
    fps: 24,
    actors: [
      {
        id: "actor-1",
        nameZh: studio.spec.actors[0].nameZh,
        bones: 16,
        contactError: 0,
        stanceDrift: 0,
        offscreenFrames: [],
      },
    ],
    warnings: [],
  };
  let dir = "";
  let runs = 0;
  const d: PrevisRenderDeps = {
    blender: "test-blender",
    useXvfb: false,
    upload: async ({ objectName, buffer }) => {
      stored.set(path.basename(objectName), buffer);
      return {
        bucket: "test-bucket",
        objectName,
        gcsUri: `gs://test-bucket/${objectName}`,
      };
    },
    run: async (command, args) => {
      runs++;
      if (runs === 1) {
        dir = args.at(-1)!;
        await writeFile(path.join(dir, "report.json"), JSON.stringify(report));
        await writeFile(path.join(dir, "scene.blend"), Buffer.alloc(1024));
      } else if (runs === 2) {
        await mkdir(path.join(dir, "frames"));
        await Promise.all(
          Array.from({ length: 48 }, (_, i) =>
            writeFile(
              path.join(
                dir,
                "frames",
                `frame-${String(i + 1).padStart(4, "0")}.png`
              ),
              "test-frame"
            )
          )
        );
      } else if (command === "ffmpeg")
        await writeFile(path.join(dir, "preview.mp4"), Buffer.alloc(1024));
      else
        return JSON.stringify({
          streams: [{ width: 960, height: 540, nb_read_frames: "48" }],
          format: { duration: "2" },
        });
      return "";
    },
  };
  return {
    d,
    stored,
    report,
    directory: () => dir,
    runs: () => runs,
    run: () =>
      renderManhuaPrevis(
        {
          requestId: "22222222-2222-4222-8222-222222222222",
          scopeId: studio.scopeId,
          clipId: "clip-test",
          spec: studio.spec,
        },
        "7",
        { signal: AbortSignal.timeout(10_000) },
        d
      ),
  };
}

it("原始及解析证据分存、条数与实际视频身份闭合", async () => {
  const f = fixture();
  const result = await f.run();
  expect(result.width).toBe(960);
  expect(result.height).toBe(540);
  expect(result.bytes).toBe(1024);
  const manifest = JSON.parse(
    f.stored.get("validation-evidence.json")!.toString()
  );
  for (const [key, file] of [
    ["report", "report.json"],
    ["parsedReport", "report.parsed.json"],
    ["probe", "probe.json"],
    ["parsedProbe", "probe.parsed.json"],
  ]) {
    const bytes = f.stored.get(file)!;
    expect(manifest[key].bytes).toBe(bytes.length);
    expect(manifest[key].sha256).toBe(
      createHash("sha256").update(bytes).digest("hex")
    );
  }
  expect(manifest.report.actors).toBe(manifest.parsedReport.actors);
  const resultBytes = f.stored.get("result.json")!;
  expect(JSON.parse(resultBytes.toString())).toEqual(result);
  const resultEvidence = JSON.parse(
    f.stored.get("result-evidence.json")!.toString()
  );
  expect(resultEvidence.result.bytes).toBe(resultBytes.length);
  expect(resultEvidence.result.sha256).toBe(
    createHash("sha256").update(resultBytes).digest("hex")
  );
  expect(resultEvidence.userId).toBe("7");
});

for (const defect of [
  "missing-bones",
  "negative-contact",
  "wrong-name",
  "offscreen-range",
]) {
  it(`报告 ${defect} 拒收前保留完整原始与解析报告`, async () => {
    const f = fixture();
    const actor = f.report.actors[0];
    if (defect === "missing-bones")
      delete (actor as Partial<typeof actor>).bones;
    if (defect === "negative-contact") actor.contactError = -1;
    if (defect === "wrong-name") actor.nameZh = "错误人物";
    if (defect === "offscreen-range")
      (actor.offscreenFrames as number[]).push(49);
    await expect(f.run()).rejects.toThrow();
    expect(f.runs()).toBe(1);
    expect(f.stored.has("report.json")).toBe(true);
    expect(f.stored.has("report.parsed.json")).toBe(true);
    expect(f.stored.has("preview.mp4")).toBe(false);
  });
}

for (const probe of [
  "{broken",
  JSON.stringify({
    streams: [{ width: 960, height: 540, nb_read_frames: "48" }],
    format: {},
  }),
  JSON.stringify({
    streams: [{ width: 540, height: 960, nb_read_frames: "48" }],
    format: { duration: "2" },
  }),
]) {
  it(`解码证据异常拒收且保留原始字节 ${probe}`, async () => {
    const f = fixture();
    const original = f.d.run;
    f.d.run = async (command, args, signal) =>
      command === "ffprobe" ? probe : original(command, args, signal);
    await expect(f.run()).rejects.toThrow();
    expect(f.stored.get("probe.json")?.toString()).toBe(probe);
    expect(f.stored.has("preview.mp4")).toBe(false);
  });
}

it("超大场景读入前拒绝，原始JSON不随媒体清理删除", async () => {
  const f = fixture();
  const original = f.d.run;
  f.d.run = async (command, args, signal) => {
    const output = await original(command, args, signal);
    await truncate(
      path.join(f.directory(), "scene.blend"),
      64 * 1024 * 1024 + 1
    );
    return output;
  };
  await expect(f.run()).rejects.toThrow("白模场景体积不正确");
  expect(f.runs()).toBe(1);
  expect(f.stored.has("scene.blend")).toBe(false);
  expect(
    JSON.parse(await readFile(path.join(f.directory(), "report.json"), "utf8"))
      .frames
  ).toBe(48);
});

it("超大视频读取上传前拒绝，不产生可恢复成功回执", async () => {
  const f = fixture();
  const original = f.d.run;
  f.d.run = async (command, args, signal) => {
    const output = await original(command, args, signal);
    if (command === "ffmpeg")
      await truncate(
        path.join(f.directory(), "preview.mp4"),
        64 * 1024 * 1024 + 1
      );
    return output;
  };
  await expect(f.run()).rejects.toThrow("白模产物体积不正确");
  expect(f.stored.has("preview.mp4")).toBe(false);
  expect(f.stored.has("result.json")).toBe(false);
  expect(f.stored.has("probe.json")).toBe(true);
});

it("完整回执存证失败不能向worker谎报成功，视频和证据不删除", async () => {
  const f = fixture();
  const original = f.d.upload;
  f.d.upload = async input => {
    if (input.objectName.endsWith("/result.json"))
      throw new Error("存证暂不可用");
    return original(input);
  };
  await expect(f.run()).rejects.toThrow("存证暂不可用");
  expect(f.stored.has("preview.mp4")).toBe(true);
  expect(f.stored.has("validation-evidence.json")).toBe(true);
  expect(f.stored.has("result.json")).toBe(false);
});

it("子进程仅继承白名单，不继承父进程凭证", async () => {
  const prior = process.env.PREVIS_TEST_SECRET;
  process.env.PREVIS_TEST_SECRET = "test-key";
  try {
    const output = await runPrevisProcess(
      process.execPath,
      ["-e", "process.stdout.write(JSON.stringify(Object.keys(process.env)))"],
      AbortSignal.timeout(5_000)
    );
    expect(JSON.parse(output)).not.toContain("PREVIS_TEST_SECRET");
  } finally {
    if (prior === undefined) delete process.env.PREVIS_TEST_SECRET;
    else process.env.PREVIS_TEST_SECRET = prior;
  }
});

it("stderr洪泛也触发有界退出", async () => {
  await expect(
    runPrevisProcess(
      process.execPath,
      [
        "-e",
        "for(let i=0;i<128;i++)process.stderr.write('x'.repeat(65536));setInterval(()=>{},1000)",
      ],
      AbortSignal.timeout(5_000)
    )
  ).rejects.toThrow("白模渲染日志超过上限");
});

it("不存在的程序返回业务错误而非内部路径", async () => {
  await expect(
    runPrevisProcess(
      "/does-not-exist/test-blender",
      [],
      AbortSignal.timeout(5_000)
    )
  ).rejects.toThrow("白模渲染程序暂不可用");
});

it("中止等待子进程实际关闭后才拒绝", async () => {
  const controller = new AbortController();
  const promise = runPrevisProcess(
    process.execPath,
    ["-e", "setInterval(()=>{},1000)"],
    controller.signal
  );
  controller.abort();
  await expect(promise).rejects.toMatchObject({ name: "AbortError" });
});

it.skipIf(process.platform === "win32")(
  "中止会清掉同组孙进程，不留下后台渲染",
  async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "previs-process-test-"));
    const pidFile = path.join(dir, "child.pid");
    const controller = new AbortController();
    const promise = runPrevisProcess(
      process.execPath,
      [
        "-e",
        `const {spawn}=require('node:child_process');const {writeFileSync}=require('node:fs');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});writeFileSync(${JSON.stringify(pidFile)},String(child.pid));setInterval(()=>{},1000);`,
      ],
      controller.signal
    );
    // 立即挂拒绝处理，避免中止与测试读取之间出现未处理拒绝。
    const outcome = promise.catch(error => error);
    let pid = 0;
    try {
      for (let attempt = 0; attempt < 100 && !pid; attempt++) {
        try {
          pid = Number(await readFile(pidFile, "utf8"));
        } catch {}
        if (!pid) await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(pid).toBeGreaterThan(0);
    } finally {
      controller.abort();
    }
    expect(await outcome).toMatchObject({ name: "AbortError" });
    let alive = true;
    for (let attempt = 0; attempt < 100 && alive; attempt++) {
      try {
        process.kill(pid, 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") alive = false;
        else throw error;
      }
      if (alive) await new Promise(resolve => setTimeout(resolve, 20));
    }
    expect(alive).toBe(false);
  }
);
