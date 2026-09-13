import { describe, expect, it } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runPrevisProcess } from "./manhuaPrevisRender";

// 明确选择本机Blender后执行；不访问上游，所有输入/报告JSON永久保留。
describe.skipIf(!process.env.PREVIS_BLENDER_TEST)(
  "双人互动真实姿态与接触",
  () => {
    it("同一事件驱动攻击和受击/格挡、枚举无关，非法及不可达关闭式拒绝", async () => {
      const output = await mkdtemp(path.join(tmpdir(), "previs-interaction-"));
      await runPrevisProcess(
        process.env.PREVIS_BLENDER_TEST!,
        [
          "--background",
          "--factory-startup",
          "--disable-autoexec",
          "--threads",
          "2",
          "--python-exit-code",
          "1",
          "--python",
          path.resolve("server/scripts/test-previs-interaction.py"),
          "--",
          output,
        ],
        AbortSignal.timeout(90_000)
      );
      const rows = JSON.parse(
        await readFile(path.join(output, "validation.json"), "utf8")
      ) as Array<{
        kind: string;
        rejected?: boolean;
        identicalContact?: boolean;
        reactionDistance?: number;
        report?: {
          actors: Array<{ stanceDrift: number }>;
          interactions: Array<{ contactFrame: number; contactError: number }>;
        };
      }>;
      for (const kind of ["strike_recoil", "strike_guard"]) {
        const row = rows.find(item => item.kind === kind)!;
        expect(row.report?.interactions).toHaveLength(1);
        expect(row.report?.interactions[0].contactFrame).toBe(25);
        expect(row.report?.interactions[0].contactError).toBeLessThanOrEqual(
          0.005
        );
        expect(row.reactionDistance).toBeGreaterThan(0.02);
        expect(
          row.report?.actors.every(actor => actor.stanceDrift <= 0.005)
        ).toBe(true);
      }
      expect(
        rows.find(item => item.kind === "reversed-actor-order")
          ?.identicalContact
      ).toBe(true);
      expect(rows.filter(item => item.rejected)).toHaveLength(8);
      console.log("PREVIS_INTERACTION_EVIDENCE", output);
    }, 100_000);
  }
);
