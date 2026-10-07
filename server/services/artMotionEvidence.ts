import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import express, { type Express } from "express";
import { z } from "zod";
import { backupManhuaGlmEvidence } from "./manhuaGlmEvidenceBackup";
import { listFlyMachines, resolveFlyMachinesConfig } from "./flyMachines";
import { getJobByIdStrict } from "../jobs/repository";
import { artMotionTaskId } from "./artMotionTask";

const ROOT = "/data/growth/art-motion-evidence";
const ROUTE = "/api/internal/art-motion-evidence";
const MAX = 4 * 1024 * 1024;
const names = new Set([
  "request.raw.json",
  "request.normalized.json",
  "frames.json",
  "frames.partial.json",
  "probe.raw.json",
  "probe.parsed.json",
]);
const requestSchema = z
  .object({
    userId: z.string().regex(/^[1-9][0-9]*$/),
    requestId: z.string().uuid(),
    objectName: z.string().max(240),
    bytes: z.string().max(MAX),
  })
  .strict();
export function artEvidenceSignature(
  secret: string,
  timestamp: string,
  body: Buffer
) {
  return createHmac("sha256", secret)
    .update(`art-motion-evidence-v1\n${timestamp}\n`)
    .update(body)
    .digest("hex");
}
export function validArtEvidenceSignature(
  secret: string,
  timestamp: string,
  signature: string,
  body: Buffer,
  now = Date.now()
) {
  if (
    secret.length < 24 ||
    !/^\d{13}$/.test(timestamp) ||
    Math.abs(now - Number(timestamp)) > 60000 ||
    !/^[a-f0-9]{64}$/.test(signature) ||
    body.length > MAX
  )
    return false;
  return timingSafeEqual(
    Buffer.from(signature, "hex"),
    Buffer.from(artEvidenceSignature(secret, timestamp, body), "hex")
  );
}
export function decodeArtEvidence(body: Buffer) {
  const input = requestSchema.parse(JSON.parse(body.toString("utf8")));
  const match =
    /^post-prod\/([1-9][0-9]*)\/art-motion-evidence\/([a-f0-9-]{36})\/([a-z.]+)$/.exec(
      input.objectName
    );
  if (!match || match[1] !== input.userId || !names.has(match[3]))
    throw new Error("Invalid evidence identity");
  const bytes = Buffer.from(input.bytes, "base64");
  if (
    !bytes.length ||
    bytes.length > 2 * 1024 * 1024 ||
    bytes.toString("base64") !== input.bytes
  )
    throw new Error("Invalid evidence bytes");
  return { ...input, bytes };
}
async function assertPersistentVolume() {
  const mounts = await readFile("/proc/self/mountinfo", "utf8");
  if (!mounts.split("\n").some(row => row.split(" ")[4] === "/data"))
    throw new Error("Persistent evidence volume unavailable");
}
async function spoolEvidence(objectName: string, bytes: Buffer, root: string) {
  await backupManhuaGlmEvidence(objectName, bytes, root);
  await backupManhuaGlmEvidence(
    `${objectName}.receipt`,
    Buffer.from(
      JSON.stringify({
        objectName,
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      })
    ),
    root
  );
}
/** Mounted before the large JSON parser; no public user token grants write access. */
export function registerArtMotionEvidence(app: Express) {
  app.post(
    ROUTE,
    express.raw({ type: "application/octet-stream", limit: MAX }),
    async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (
        !validArtEvidenceSignature(
          process.env.JWT_SECRET || "",
          String(req.headers["x-art-evidence-time"] || ""),
          String(req.headers["x-art-evidence-signature"] || ""),
          body
        )
      )
        return res.status(403).json({ error: "forbidden" });
      try {
        if (process.env.FLY_MACHINE_ID === process.env.MANHUA_HEAVY_MACHINE_ID)
          throw new Error("Evidence must reach the persistent website machine");
        await assertPersistentVolume();
        const input = decodeArtEvidence(body);
        const job = await getJobByIdStrict(
          artMotionTaskId(input.userId, input.requestId)
        );
        const params = job?.input as
          | { action?: string; requestId?: string }
          | undefined;
        if (
          !job ||
          job.userId !== input.userId ||
          job.type !== "post_prod" ||
          params?.action !== "art_motion" ||
          params.requestId !== input.requestId
        )
          return res.status(403).json({ error: "forbidden" });
        await spoolEvidence(input.objectName, input.bytes, ROOT);
        return res.json({
          bytes: input.bytes.length,
          sha256: createHash("sha256").update(input.bytes).digest("hex"),
        });
      } catch {
        return res.status(503).json({ error: "evidence not persisted" });
      }
    }
  );
}
/** Existing Fly credentials remain only server-side; this never starts or changes a machine. */
export async function backupArtMotionEvidence(
  userId: string,
  requestId: string,
  objectName: string,
  bytes: Buffer
) {
  if (!process.env.FLY_MACHINE_ID) {
    // Isolated development needs an explicit durable directory; tests inject a separate archival double.
    const root = process.env.ART_MOTION_EVIDENCE_DIR;
    if (!root)
      throw new Error("Development evidence directory is not configured");
    await spoolEvidence(objectName, bytes, root);
    return;
  }
  if (process.env.FLY_MACHINE_ID !== process.env.MANHUA_HEAVY_MACHINE_ID) {
    await assertPersistentVolume();
    await spoolEvidence(objectName, bytes, ROOT);
    return;
  }
  const config = resolveFlyMachinesConfig();
  if (!config || !process.env.JWT_SECRET || process.env.JWT_SECRET.length < 24)
    throw new Error("Permanent evidence transfer unavailable");
  const sites = (await listFlyMachines(config)).filter(
    m =>
      m.state === "started" &&
      m.id !== process.env.MANHUA_HEAVY_MACHINE_ID &&
      m.processGroup === "app"
  );
  if (sites.length !== 1)
    throw new Error("Persistent website machine is ambiguous");
  const body = Buffer.from(
    JSON.stringify({
      userId,
      requestId,
      objectName,
      bytes: bytes.toString("base64"),
    })
  );
  decodeArtEvidence(body);
  const timestamp = String(Date.now());
  const response = await fetch(`https://${config.appName}.fly.dev${ROUTE}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "Fly-Force-Instance-Id": sites[0].id,
      "X-Art-Evidence-Time": timestamp,
      "X-Art-Evidence-Signature": artEvidenceSignature(
        process.env.JWT_SECRET,
        timestamp,
        body
      ),
    },
    body,
    signal: AbortSignal.timeout(30000),
    redirect: "error",
  });
  if (!response.ok) throw new Error("Permanent evidence transfer failed");
  const receipt = (await response.json()) as {
    bytes?: number;
    sha256?: string;
  };
  if (
    receipt.bytes !== bytes.length ||
    receipt.sha256 !== createHash("sha256").update(bytes).digest("hex")
  )
    throw new Error("Permanent evidence receipt mismatch");
}
