/** 显式选择本机后使用真实Blender/FFmpeg；只替换云存储和测试模型来源，不访问生产。 */
import { describe, expect, it } from "vitest";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import {
  createManhuaPrevisStudio,
  manhuaPrevisRequestSchema,
} from "../../shared/manhuaPrevis";
import { renderManhuaPrevis, runPrevisProcess } from "./manhuaPrevisRender";
import {
  recoverPrevisResult,
  type PrevisRecoveryRow,
} from "./manhuaPrevisRecovery";

const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
describe.skipIf(!process.env.PREVIS_JOINT_E2E)("主渲染链离线联合验收", () => {
  it.each(["双人四尾黑翼", "带骨表演"])(
    "%s：真实48帧到MP4与原字节恢复",
    async kind => {
      const blender = process.env.PREVIS_BLENDER_TEST!;
      const root = process.env.PREVIS_JOINT_OUTPUT!;
      expect(blender).toBeTruthy();
      expect(root).toBeTruthy();
      await mkdir(root, { recursive: true });
      const output = await mkdtemp(path.join(root, kind + "-"));
      console.log("PREVIS_JOINT_EVIDENCE", output);
      const studio = createManhuaPrevisStudio(2);
      const actor = studio.spec.actors[0];
      actor.start = [0, 0];
      actor.end = [0, 0];
      actor.actions = [];
      studio.spec.cameras = [
        {
          startSec: 0,
          endSec: 2,
          position: [3, -6, 2.5],
          target: [0, 0, 0.9],
          lens: 45,
        },
      ];
      if (kind === "双人四尾黑翼") {
        actor.start = [-0.35, -1.5];
        actor.end = [-0.35, -1.5];
        actor.facingDeg = 0;
        const target = {
          ...structuredClone(actor),
          id: "actor-2",
          nameZh: "受方",
          start: [0.35, -1.5] as [number, number],
          end: [0.35, -1.5] as [number, number],
          facingDeg: 180,
        };
        const horse = {
          ...structuredClone(actor),
          id: "horse",
          nameZh: "四尾黑翼马",
          shape: "horse" as const,
          start: [0, 2] as [number, number],
          end: [0, 2] as [number, number],
          creature: {
            preset: "four_tail_black_wings" as const,
            transformStartSec: 0.5,
            transformEndSec: 1.5,
          },
        };
        studio.spec.actors.push(target, horse);
        studio.spec.interactions = [
          {
            id: "pair",
            kind: "strike_guard",
            actorId: actor.id,
            targetActorId: target.id,
            startSec: 0,
            contactSec: 1,
            endSec: 2,
          },
        ];
        studio.spec.cameras = [
          {
            startSec: 0,
            endSec: 2,
            position: [5, -9, 5],
            target: [0, 0.7, 1],
            lens: 40,
          },
        ];
      } else {
        actor.assetRef = "TEST_ONLY-box-rig";
        actor.riggedModel = {
          sourceJobId: "m3d_TEST_ONLY_box_rig",
          forwardAxis: "+X",
          targetHeight: 1.7,
          performance: {
            controller: {
              eyeBones: { left: "Eye.L", right: "Eye.R" },
              expressions: {
                calm: { Relax: 1 },
                tense: { Tense: 1 },
                surprised: { Surprise: 1 },
              },
            },
            cues: (["calm", "tense", "surprised"] as const).map(
              (expression, index) => ({
                startSec: (index * 2) / 3,
                endSec: ((index + 1) * 2) / 3,
                gazeTarget: [3, 1, 1.8],
                headYawDeg: 25,
                headPitchDeg: 10,
                breathAmplitude: 0.025,
                breathHz: 0.5,
                expression,
                intensity: 0.8,
              })
            ),
          },
        };
      }
      const input = manhuaPrevisRequestSchema.parse({
        requestId: randomUUID(),
        scopeId: studio.scopeId,
        clipId: kind,
        spec: studio.spec,
      });
      const files = new Map<string, Buffer>();
      let workDir = "",
        runs = 0;
      const result = await renderManhuaPrevis(
        input,
        "7",
        { signal: AbortSignal.timeout(600000) },
        {
          blender,
          useXvfb: false,
          prepareModels: async (_spec, _userId, dir) => {
            const source = process.env.PREVIS_TEST_RIG_GLB!;
            expect(path.basename(source)).toMatch(/^TEST_ONLY/);
            const bytes = await readFile(source),
              localPath = path.join(dir, "actor-model-0.glb");
            await writeFile(localPath, bytes, { flag: "wx" });
            const manifest = {
              actorId: actor.id,
              sourceJobId: actor.riggedModel!.sourceJobId,
              sha256: sha(bytes),
              bytes: bytes.length,
              localPath,
            };
            await writeFile(
              path.join(output, "model-source.json"),
              JSON.stringify(
                { ...manifest, testOnly: true, originalFixture: source },
                null,
                2
              )
            );
            return [manifest];
          },
          run: async (command, args, signal) => {
            const step = ++runs;
            if (args.includes("--python")) {
              const offset = args.indexOf("--");
              workDir = args[offset + 2];
              await cp(args[offset + 1], path.join(output, "spec.json"));
            }
            await writeFile(
              path.join(output, `command-${step}.json`),
              JSON.stringify({ command, args }, null, 2)
            );
            try {
              const stdout = await runPrevisProcess(command, args, signal);
              await writeFile(path.join(output, `command-${step}.log`), stdout);
              return stdout;
            } catch (error) {
              await writeFile(
                path.join(output, `command-${step}.failure.txt`),
                String(error)
              );
              throw error;
            } finally {
              if (args.includes("--render-anim"))
                await cp(
                  path.join(workDir, "frames"),
                  path.join(output, "frames"),
                  { recursive: true }
                ).catch(() => {});
            }
          },
          upload: async ({ objectName, buffer }) => {
            files.set(objectName, Buffer.from(buffer));
            await writeFile(
              path.join(output, path.basename(objectName)),
              buffer
            );
            return {
              bucket: "offline-test",
              objectName,
              gcsUri: `gs://offline-test/${objectName}`,
            };
          },
        }
      );
      expect(runs).toBe(4);
      expect(result.report.frames).toBe(48);
      expect([result.width, result.height]).toEqual([960, 540]);
      expect(result.bytes).toBeGreaterThan(1000);
      if (kind === "双人四尾黑翼") {
        expect(
          result.report.interactions?.[0].contactError
        ).toBeLessThanOrEqual(0.005);
        expect(result.report.creatures?.[0].stages).toHaveLength(48);
      } else {
        expect(result.report.models?.[0].contactValidated).toBe(false);
        expect(result.report.models?.[0].performance?.qualityAccepted).toBe(
          false
        );
      }
      const row: PrevisRecoveryRow = {
        id: `prv_${createHash("sha256").update(`7:${input.requestId}`).digest("hex").slice(0, 48)}`,
        userId: "7",
        type: "post_prod",
        status: "failed",
        provider: "blender-previs",
        input: { action: "manhua_previs", params: input },
        output: null,
        error: "离线测试模拟产物生成后落库失败",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const recovered = await recoverPrevisResult(row, 7, {
        bucket: () => "offline-test",
        inspect: async args => {
          const objectName = args.gcsUri.replace("gs://offline-test/", "");
          const bytes = files.get(objectName)!;
          if (!bytes || bytes.length > args.maxBytes)
            throw new Error("离线产物缺失");
          args.onChunk?.(bytes);
          return {
            bucket: "offline-test",
            objectName,
            byteLength: bytes.length,
            header: bytes.subarray(0, 12),
            sha256: sha(bytes),
          };
        },
        save: async (previous, recoveredOutput) => ({
          ...previous,
          status: "succeeded",
          output: recoveredOutput,
        }),
      });
      expect(recovered.status).toBe("succeeded");
      await writeFile(
        path.join(output, "acceptance.json"),
        JSON.stringify(
          {
            kind,
            runs,
            frames: result.report.frames,
            sha256: result.sha256,
            recovered: recovered.status,
            storage: "仅本地注入，不含真实云或数据库",
            visualQualityAccepted: false,
          },
          null,
          2
        )
      );
    },
    610000
  );
});
