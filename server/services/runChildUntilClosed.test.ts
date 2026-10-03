import { describe, expect, it } from "vitest";
import { mkdtemp, access, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { runChildUntilClosed } from "./runChildUntilClosed";

describe("media child lifecycle", () => {
  it("returns real output and clears the PID only after close", async () => {
    const pids: Array<number | undefined> = [];
    const result = await runChildUntilClosed(process.execPath, ["-e", "console.log('finished')"], new AbortController().signal, pid => pids.push(pid));
    expect(result.stdout.trim()).toBe("finished");
    expect(pids[0]).toBeGreaterThan(0);
    expect(pids.at(-1)).toBeUndefined();
  });
  it("escalates only the cancelled child and waits for actual exit", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "media-close-test-"));
    const ready = path.join(dir, "ready");
    const controller = new AbortController();
    let pid = 0;
    const pending = runChildUntilClosed(process.execPath, ["-e", `process.on('SIGTERM',()=>{}); require('fs').writeFileSync(process.argv[1],'ready'); setInterval(()=>{},1000)`, ready], controller.signal, value => { if (value) pid = value; }, 50);
    const rejected = expect(pending).rejects.toThrow("cancel fixture");
    try {
      for (let i = 0; i < 200; i++) { if (await access(ready).then(() => true, () => false)) break; await delay(10); }
      expect(await access(ready).then(() => true, () => false)).toBe(true);
      controller.abort(new Error("cancel fixture"));
      await rejected;
      expect(() => process.kill(pid, 0)).toThrow();
    } finally { controller.abort(); await pending.catch(() => {}); await rm(dir, { recursive: true, force: true }); }
  });
  it("reports a spawn failure without hanging", async () => {
    await expect(runChildUntilClosed("/nonexistent/media-fixture", [], new AbortController().signal)).rejects.toThrow();
  });
});
