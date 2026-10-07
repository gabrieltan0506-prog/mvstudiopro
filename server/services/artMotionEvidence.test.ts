import { expect, it, vi, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import {
  backupArtMotionEvidence,
  decodeArtEvidence,
  artEvidenceSignature,
  validArtEvidenceSignature,
} from "./artMotionEvidence";
const requestId = "c1007000-1234-4234-8234-123456789abc";
const objectName = `post-prod/7/art-motion-evidence/${requestId}/request.raw.json`;
afterEach(() => vi.unstubAllEnvs());
it("internal evidence authentication binds exact bytes, timestamp and fixed artifact identity", () => {
  const secret = "offline-credential-only-for-test-32",
    time = String(Date.now()),
    body = Buffer.from(
      JSON.stringify({
        userId: "7",
        requestId,
        objectName,
        bytes: Buffer.from('{"original":true}').toString("base64"),
      })
    );
  const signature = artEvidenceSignature(secret, time, body);
  expect(validArtEvidenceSignature(secret, time, signature, body)).toBe(true);
  expect(
    validArtEvidenceSignature(secret, time, signature, Buffer.from("changed"))
  ).toBe(false);
  expect(
    validArtEvidenceSignature(
      secret,
      time,
      signature,
      body,
      Number(time) + 60001
    )
  ).toBe(false);
  expect(validArtEvidenceSignature("", time, signature, body)).toBe(false);
  expect(decodeArtEvidence(body).bytes.toString()).toBe('{"original":true}');
  for (const name of [
    "../secret.json",
    objectName.replace("post-prod/7/", "post-prod/8/"),
    objectName.replace("request.raw.json", "other.json"),
  ])
    expect(() =>
      decodeArtEvidence(
        Buffer.from(
          JSON.stringify({
            userId: "7",
            requestId,
            objectName: name,
            bytes: "e30=",
          })
        )
      )
    ).toThrow();
});
it("durable content-addressed copy survives a failed cloud write and retains differing versions", async () => {
  vi.stubEnv("FLY_MACHINE_ID", "");
  vi.stubEnv(
    "ART_MOTION_EVIDENCE_DIR",
    "/tmp/creative-studio-evidence-1007/permanent"
  );
  const a = Buffer.from('{"raw":"original"}'),
    b = Buffer.from('{"raw":"second"}');
  await backupArtMotionEvidence("7", requestId, objectName, a);
  await backupArtMotionEvidence("7", requestId, objectName, b);
  await backupArtMotionEvidence("7", requestId, objectName, a);
  const folder = `/tmp/creative-studio-evidence-1007/permanent/${createHash("sha256").update(objectName).digest("hex")}`;
  expect((await readdir(folder)).length).toBe(2);
  expect(
    await readFile(
      `${folder}/${createHash("sha256").update(a).digest("hex")}.json`
    )
  ).toEqual(a);
});
