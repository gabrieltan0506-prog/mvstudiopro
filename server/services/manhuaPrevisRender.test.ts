import { it, expect } from "vitest";
import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { createManhuaPrevisStudio } from "../../shared/manhuaPrevis";
import {
  renderManhuaPrevis,
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
                { id: "actor-1", bones: 16, contactError: 0, stanceDrift: 0 },
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
