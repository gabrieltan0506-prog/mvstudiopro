import { it, expect } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { backupManhuaGlmEvidence, classifyManhuaGlmStorageError } from "./manhuaGlmEvidenceBackup";

it("永久副本逐字节保留，同内容幂等、不同内容不覆盖", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "glm-backup-test-"));
  try {
    const a = Buffer.from('{"response":"全部原文与末尾"}');
    const b = Buffer.from('{"response":"另一份原文"}');
    await backupManhuaGlmEvidence("call/raw-1.json", a, root);
    await backupManhuaGlmEvidence("call/raw-1.json", a, root);
    await backupManhuaGlmEvidence("call/raw-1.json", b, root);
    const [directory] = await fs.readdir(root);
    const files = await fs.readdir(path.join(root, directory));
    expect(files).toHaveLength(2);
    const buffers = await Promise.all(files.map(file => fs.readFile(path.join(root, directory, file))));
    expect(buffers.some(value => value.equals(a))).toBe(true);
    expect(buffers.some(value => value.equals(b))).toBe(true);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

it("错误分类只保留白名单，不传URL、响应正文或cause凭证", () => {
  expect(classifyManhuaGlmStorageError(new Error("gcs_conditional_upload_failed:403:secret-url"))).toBe("http_403");
  expect(classifyManhuaGlmStorageError(Object.assign(new Error("secret"), { cause: { code: "ECONNRESET" } }))).toBe("ECONNRESET");
  expect(classifyManhuaGlmStorageError(new Error("https://private/?token=secret"))).toBe("unknown_storage_error");
});
