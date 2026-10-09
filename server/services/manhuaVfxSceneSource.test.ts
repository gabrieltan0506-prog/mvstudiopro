import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { createManhuaPrevisStudio } from "../../shared/manhuaPrevis";
import { MANHUA_VFX_BULLET_DEFAULTS } from "../../shared/manhuaVfxPixelParameters";
import { prepareManhuaVfxScene, resolveManhuaVfxSceneSource } from "./manhuaVfxSceneSource";

function fixture() {
  const sceneJobId = `prv_${"a".repeat(48)}`, scopeId = "10090000-1234-4234-8234-123456789abc";
  const params = { requestId: "10091111-1234-4234-8234-123456789abc", scopeId, clipId: "clip", spec: createManhuaPrevisStudio(2).spec };
  // 仅伪造字节验证下载/SHA与身份门禁，不打开blend、不渲染媒体。
  const bytes = Buffer.concat([Buffer.from("BLENDER-v300"), Buffer.alloc(1024)]), sha256 = createHash("sha256").update(bytes).digest("hex");
  const output = { gcsUri: "gs://test/post-prod/7/previs/request/preview.mp4", sceneGcsUri: "gs://test/post-prod/7/previs/request/scene.blend", sceneSha256: sha256 };
  const job = { id: sceneJobId, userId: "7", type: "post_prod", provider: "blender-previs", status: "succeeded", input: { action: "manhua_previs", params }, output };
  const bullet = { ...MANHUA_VFX_BULLET_DEFAULTS, sceneJobId, sceneScopeId: scopeId, clipId: "clip" };
  return { bytes, sha256, job, bullet };
}
it("三维输入只接受本人成功场景与当前scope/clip，不能读任意blend或跨用户", async () => {
  const f = fixture(); expect(await resolveManhuaVfxSceneSource(f.bullet, "7", async () => f.job)).toMatchObject({ sha256: f.sha256, sourceClipId: "clip" });
  for (const patch of [{ userId: "8" }, { status: "running" }, { provider: "other" }, { output: { ...f.job.output, sceneGcsUri: "gs://test/other.blend" } }]) await expect(resolveManhuaVfxSceneSource(f.bullet, "7", async () => ({ ...f.job, ...patch }))).rejects.toThrow("回执");
  await expect(resolveManhuaVfxSceneSource({ ...f.bullet, clipId: "another" }, "7", async () => f.job)).rejects.toThrow("片段");
  await expect(resolveManhuaVfxSceneSource({ ...f.bullet, sceneScopeId: "10092222-1234-4234-8234-123456789abc" }, "7", async () => f.job)).rejects.toThrow("片段");
  await expect(resolveManhuaVfxSceneSource({ ...f.bullet, freezeSec: 2 }, "7", async () => f.job)).rejects.toThrow("冻结");
});
it("worker下载仅落当前请求scenes目录，核对真实字节SHA；变化和取消均不进入渲染", async () => {
  const f = fixture(), root = await mkdtemp(path.join(tmpdir(), "vfx-scene-contract-"));
  const deps = { load: async () => f.job, fetch: async (_uri: string, target: string, options: { signal: AbortSignal; budget?: { remainingBytes: number } }) => { expect(options.budget?.remainingBytes).toBe(512 * 1024 * 1024); options.signal.throwIfAborted(); await writeFile(target, f.bytes); return f.bytes.length; } };
  const saved = await prepareManhuaVfxScene(f.bullet, "orbit", "7", root, new AbortController().signal, deps);
  expect(saved.scenePath).toBe(path.join(root, "scenes", "scene-orbit.blend")); expect(await readFile(saved.scenePath)).toEqual(f.bytes); expect(saved.sceneSha256).toBe(f.sha256);
  await expect(prepareManhuaVfxScene(f.bullet, "bad", "7", root, new AbortController().signal, { ...deps, fetch: async (_uri, target) => { await writeFile(target, Buffer.alloc(1024)); return 1024; } })).rejects.toThrow("SHA");
  await expect(prepareManhuaVfxScene(f.bullet, "cancel", "7", root, AbortSignal.abort(), deps)).rejects.toThrow();
});
