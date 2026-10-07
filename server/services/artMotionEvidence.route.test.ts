import { expect, it, vi } from "vitest";
import express from "express";
const mocks = vi.hoisted(() => ({
  backup: vi.fn(async () => {}),
  load: vi.fn(async () => ({
    id: "unused",
    userId: "7",
    type: "post_prod",
    input: {
      action: "art_motion",
      requestId: "c1007000-1234-4234-8234-123456789abc",
    },
  })),
}));
vi.mock("./manhuaGlmEvidenceBackup", () => ({
  backupManhuaGlmEvidence: mocks.backup,
}));
vi.mock("../jobs/repository", () => ({ getJobByIdStrict: mocks.load }));
vi.mock("node:fs/promises", async importOriginal => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...real,
    readFile: vi.fn(async (...args: any[]) =>
      args[0] === "/proc/self/mountinfo"
        ? "1 2 0:0 / /data rw - ext4 /dev/x rw"
        : (real.readFile as any)(...args)
    ),
  };
});
import {
  registerArtMotionEvidence,
  artEvidenceSignature,
} from "./artMotionEvidence";
it("registered raw endpoint authenticates and persists before the large JSON parser", async () => {
  vi.stubEnv("JWT_SECRET", "offline-only-authentication-secret");
  vi.stubEnv("FLY_MACHINE_ID", "site");
  vi.stubEnv("MANHUA_HEAVY_MACHINE_ID", "worker");
  const app = express();
  registerArtMotionEvidence(app);
  app.use(express.json({ limit: "650mb" }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(r => server.once("listening", () => r()));
  const port = (server.address() as { port: number }).port;
  const requestId = "c1007000-1234-4234-8234-123456789abc",
    body = Buffer.from(
      JSON.stringify({
        userId: "7",
        requestId,
        objectName: `post-prod/7/art-motion-evidence/${requestId}/request.raw.json`,
        bytes: Buffer.from('{"test":true}').toString("base64"),
      })
    ),
    time = String(Date.now());
  const send = (signature: string, data = body) =>
    fetch(`http://127.0.0.1:${port}/api/internal/art-motion-evidence`, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Art-Evidence-Time": time,
        "X-Art-Evidence-Signature": signature,
      },
      body: data,
    });
  try {
    const sig = artEvidenceSignature(process.env.JWT_SECRET!, time, body);
    expect((await send("0".repeat(64))).status).toBe(403);
    expect(mocks.backup).not.toHaveBeenCalled();
    const ok = await send(sig);
    expect(ok.status).toBe(200);
    expect((await ok.json()).bytes).toBe(13);
    expect(mocks.backup).toHaveBeenCalledTimes(2);
    mocks.load.mockResolvedValueOnce({ userId: "8" } as never);
    expect((await send(sig)).status).toBe(403);
    expect(mocks.backup).toHaveBeenCalledTimes(2);
    vi.stubEnv("FLY_MACHINE_ID", "worker");
    expect((await send(sig)).status).toBe(503);
    expect(mocks.backup).toHaveBeenCalledTimes(2);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(r => server.close(() => r()));
    vi.unstubAllEnvs();
  }
});
