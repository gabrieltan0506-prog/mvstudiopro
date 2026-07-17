/**
 * 方案 1C：用 canvasGptImage2（generalImageEdit）拉开仿真人库下颌/骨相差异。
 * 上传：shrink≤1536 + curl --data-binary（禁 base64）。
 *
 *   FLY_ORIGIN=https://mvstudiopro.fly.dev pnpm run manhua:photoreal-diversify-jaws
 *   IDS=char_f_02,char_m_01 LIMIT=4
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MANHUA_CHARACTER_ASSET_LIBRARY,
  MANHUA_PHOTOREAL_NAME_ZH,
  type ManhuaCharacterTemplate,
} from "../shared/manhuaCharacterAssetLibrary.js";
import {
  PHOTOREAL_ANTI_AI_LOCK_ZH,
  PHOTOREAL_LOCK_FACE_NOT_WARDROBE_ZH,
  PHOTOREAL_SKIN_TEXTURE_LOCK_ZH,
  formatPhotorealFaceShapeBlock,
  getPhotorealFaceShapeForId,
} from "../shared/photorealCharacterPrompt.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FLY_ORIGIN = String(process.env.FLY_ORIGIN || "https://mvstudiopro.fly.dev").replace(/\/$/, "");
const OUT_PUBLIC = path.join(ROOT, "client/public/manhua-characters/photoreal");
const OUT_DL = path.join(os.homedir(), "Downloads", "2026Jul18", "photoreal-library");
const BACKUP = path.join(OUT_DL, "jaw-diversify-backup");
const MANIFEST = path.join(OUT_DL, "jaw-diversify-manifest.json");
const LOG = "/tmp/diversify-photoreal-jaws.log";
const TIMEOUT_MS = Math.min(Math.max(Number(process.env.GEN_TIMEOUT_MS) || 540_000, 120_000), 900_000);

type Row = {
  id: string;
  shapeId: string;
  labelZh: string;
  ok: boolean;
  error?: string;
  at: string;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function log(line: string) {
  const s = String(line);
  console.log(s);
  try {
    fs.appendFileSync(LOG, `${s}\n`);
  } catch {
    /* ignore */
  }
}

function pickTargets(): ManhuaCharacterTemplate[] {
  const idFilter = String(process.env.IDS || "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const skip = new Set(
    String(process.env.SKIP_IDS || "")
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const limit = Math.max(0, Number(process.env.LIMIT || 0) || 0);
  let list = [...MANHUA_CHARACTER_ASSET_LIBRARY].filter((c) => !skip.has(c.id));
  if (idFilter.length) list = list.filter((c) => idFilter.includes(c.id));
  if (limit > 0) list = list.slice(0, limit);
  return list;
}

function loadDone(): Set<string> {
  try {
    const j = JSON.parse(fs.readFileSync(MANIFEST, "utf8")) as { items?: Row[] };
    return new Set((j.items || []).filter((x) => x.ok).map((x) => x.id));
  } catch {
    return new Set();
  }
}

function saveManifest(items: Row[]) {
  fs.mkdirSync(OUT_DL, { recursive: true });
  const payload = { updatedAt: new Date().toISOString(), policy: "1C jaw diversify via image-2-edit", items };
  fs.writeFileSync(MANIFEST, JSON.stringify(payload, null, 2));
  fs.writeFileSync(path.join(OUT_PUBLIC, "jaw-diversify-manifest.json"), JSON.stringify(payload, null, 2));
}

async function trpcUploadSignedUrl(fileName: string, mimeType: string) {
  const url = `${FLY_ORIGIN}/api/trpc/mvAnalysis.getVideoUploadSignedUrl?batch=1`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ "0": { json: { fileName, mimeType } } }),
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`signedUrl 非 JSON: ${text.slice(0, 200)}`);
  }
  const row = Array.isArray(json) ? json[0] : json;
  const data =
    (row as { result?: { data?: { json?: Record<string, string> } } })?.result?.data?.json ||
    (row as { result?: { data?: Record<string, string> } })?.result?.data ||
    (row as Record<string, string>);
  const uploadUrl = String((data as { uploadUrl?: string })?.uploadUrl || "");
  const gcsUri = String((data as { gcsUri?: string })?.gcsUri || "");
  if (!uploadUrl || !gcsUri) throw new Error(`signedUrl 失败: ${text.slice(0, 300)}`);
  return {
    uploadUrl,
    gcsUri,
    requiredHeaders: (data as { requiredHeaders?: Record<string, string> }).requiredHeaders,
  };
}

async function resolveReadUrl(gcsUri: string): Promise<string> {
  const res = await fetch(
    `${FLY_ORIGIN}/api/google?op=omniMaterialUrl&gcsUri=${encodeURIComponent(gcsUri)}`,
  );
  const json = (await res.json()) as { ok?: boolean; url?: string; error?: string };
  if (!res.ok || !json.ok || !json.url) throw new Error(json.error || "omniMaterialUrl 失败");
  return String(json.url);
}

function shrinkJpgBinary(srcPath: string, hint: string): { path: string; bytes: Buffer } {
  const tmp = path.join(os.tmpdir(), `jaw-div-${hint}-${Date.now()}.jpg`);
  const r = spawnSync(
    "sips",
    ["-Z", "1536", "-s", "format", "jpeg", "-s", "formatOptions", "85", srcPath, "--out", tmp],
    { encoding: "utf8" },
  );
  const usePath = r.status === 0 && fs.existsSync(tmp) ? tmp : srcPath;
  return { path: usePath, bytes: fs.readFileSync(usePath) };
}

async function uploadLocalJpg(localPath: string, objectHint: string): Promise<string> {
  const { path: shrunkPath, bytes } = shrinkJpgBinary(localPath, objectHint);
  const fileName = path.basename(localPath).replace(/\.[^.]+$/, ".jpg");
  log(`  · binary PUT ${bytes.length} bytes`);
  const signed = await trpcUploadSignedUrl(`jaw-div/${objectHint}-${fileName}`, "image/jpeg");
  const headerArgs: string[] = ["-H", "Content-Type: image/jpeg"];
  for (const [k, v] of Object.entries(signed.requiredHeaders || {})) {
    headerArgs.push("-H", `${k}: ${v}`);
  }
  const put = spawnSync(
    "curl",
    [
      "-sS",
      "-o",
      "/dev/null",
      "-w",
      "%{http_code}",
      "-X",
      "PUT",
      ...headerArgs,
      "--data-binary",
      `@${shrunkPath}`,
      signed.uploadUrl,
    ],
    { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
  );
  if (shrunkPath !== localPath) {
    try {
      fs.unlinkSync(shrunkPath);
    } catch {
      /* keep */
    }
  }
  const code = String(put.stdout || "").trim();
  if (put.status !== 0 || !/^2\d\d$/.test(code)) {
    throw new Error(`GCS binary PUT fail status=${put.status} http=${code} err=${put.stderr?.slice(0, 200)}`);
  }
  return resolveReadUrl(signed.gcsUri);
}

async function flyGenerateOnce(prompt: string, imageUrls: string[]): Promise<string> {
  const refs = imageUrls.map((u) => String(u || "").trim()).filter(Boolean).slice(0, 16);
  const body = {
    prompt,
    aspectRatio: "9:16" as const,
    referenceImageUrl: refs[0] || undefined,
    referenceImageUrls: refs.length ? refs : undefined,
    imageMode: "edit" as const,
    generalImageEdit: true,
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    log(`  · POST canvasGptImage2 refs=${refs.length}`);
    const res = await fetch(`${FLY_ORIGIN}/api/jobs?op=canvasGptImage2`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json: { ok?: boolean; imageUrl?: string; error?: string } = {};
    try {
      json = JSON.parse(text) as typeof json;
    } catch {
      throw new Error(`非 JSON HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    if (!res.ok || !json.ok || !json.imageUrl) throw new Error(json.error || `HTTP ${res.status}`);
    return String(json.imageUrl);
  } finally {
    clearTimeout(timer);
  }
}

async function flyGenerate(prompt: string, imageUrls: string[]): Promise<string> {
  const retries = Math.max(1, Number(process.env.GEN_RETRIES || 5) || 5);
  let lastErr: unknown;
  for (let i = 1; i <= retries; i++) {
    try {
      return await flyGenerateOnce(prompt, imageUrls);
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      const transient = /fetch failed|aborted|ECONNRESET|ETIMEDOUT|socket|503|502|429/i.test(msg);
      const waitMs = transient ? Math.min(45_000, 4000 * i * i) : 2000 * i;
      log(`  · fail ${i}/${retries}: ${msg} · sleep ${waitMs}ms`);
      await sleep(waitMs);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function downloadToJpg(url: string, destBaseNoExt: string): Promise<void> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`download HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const pngPath = `${destBaseNoExt}.png`;
  const jpgPath = `${destBaseNoExt}.jpg`;
  fs.mkdirSync(path.dirname(destBaseNoExt), { recursive: true });
  fs.writeFileSync(pngPath, buf);
  const r = spawnSync(
    "sips",
    ["-s", "format", "jpeg", "-s", "formatOptions", "92", pngPath, "--out", jpgPath],
    { encoding: "utf8" },
  );
  if (r.status !== 0 || !fs.existsSync(jpgPath)) fs.copyFileSync(pngPath, jpgPath);
  try {
    fs.unlinkSync(pngPath);
  } catch {
    /* keep */
  }
}

function backupIfNeeded(id: string, kind: "hero" | "sheet") {
  fs.mkdirSync(BACKUP, { recursive: true });
  const src = path.join(OUT_DL, `${id}_${kind}.jpg`);
  const dest = path.join(BACKUP, `${id}_${kind}.jpg`);
  if (fs.existsSync(src) && !fs.existsSync(dest)) fs.copyFileSync(src, dest);
}

function buildHeroEditPrompt(c: ManhuaCharacterTemplate): string {
  const name = MANHUA_PHOTOREAL_NAME_ZH[c.id] || c.nameZh;
  const shape = getPhotorealFaceShapeForId(c.id, c.gender);
  return [
    "竖屏 9:16 图像编辑：只改骨相/下颌轮廓，保持同一人身份与发型大轮廓、服装、背景构图。",
    `角色「${name}」目标骨相：${shape.labelZh}。`,
    formatPhotorealFaceShapeBlock(c.id, c.gender),
    "保留眼睛/眉毛/鼻梁/唇形的可识别连续性，但下颌宽度与下巴形状必须按目标明显改变，拉开与网红尖下巴的差距。",
    "禁止换人、禁止名人脸、禁止改成全员同一张小V脸。",
    PHOTOREAL_SKIN_TEXTURE_LOCK_ZH,
    PHOTOREAL_ANTI_AI_LOCK_ZH,
    PHOTOREAL_LOCK_FACE_NOT_WARDROBE_ZH,
    "无文字无水印。",
  ].join("\n");
}

function buildSheetEditPrompt(c: ManhuaCharacterTemplate): string {
  const name = MANHUA_PHOTOREAL_NAME_ZH[c.id] || c.nameZh;
  return [
    "竖屏设定卡图像编辑：上半胸像与下半 FRONT/SIDE/BACK 三视图必须同一张脸、同一骨相。",
    `角色「${name}」。第二张参考为已改骨相的胸像——三视图与上半必须对齐该骨相。`,
    formatPhotorealFaceShapeBlock(c.id, c.gender),
    "可微调下颌使三视图一致；禁止换装大改、禁止换人。",
    PHOTOREAL_SKIN_TEXTURE_LOCK_ZH,
    PHOTOREAL_ANTI_AI_LOCK_ZH,
    "无文字水印杂讯。",
  ].join("\n");
}

async function processOne(c: ManhuaCharacterTemplate): Promise<Row> {
  const shape = getPhotorealFaceShapeForId(c.id, c.gender);
  const heroPath = path.join(OUT_DL, `${c.id}_hero.jpg`);
  const sheetPath = path.join(OUT_DL, `${c.id}_sheet.jpg`);
  if (!fs.existsSync(heroPath)) throw new Error(`缺 hero ${heroPath}`);
  if (!fs.existsSync(sheetPath)) throw new Error(`缺 sheet ${sheetPath}`);

  backupIfNeeded(c.id, "hero");
  backupIfNeeded(c.id, "sheet");

  log(`\n━━ ${c.id} ${MANHUA_PHOTOREAL_NAME_ZH[c.id] || c.nameZh} · ${shape.labelZh} ━━`);
  log("  upload hero…");
  const heroUrl = await uploadLocalJpg(heroPath, `${c.id}-hero`);
  log("  edit hero jaw…");
  const newHeroUrl = await flyGenerate(buildHeroEditPrompt(c), [heroUrl]);
  await downloadToJpg(newHeroUrl, path.join(OUT_DL, `${c.id}_hero`));
  fs.copyFileSync(path.join(OUT_DL, `${c.id}_hero.jpg`), path.join(OUT_PUBLIC, `${c.id}_hero.jpg`));

  log("  upload sheet + new hero…");
  const sheetUrl = await uploadLocalJpg(sheetPath, `${c.id}-sheet`);
  const newHeroRead = await uploadLocalJpg(path.join(OUT_DL, `${c.id}_hero.jpg`), `${c.id}-hero2`);
  log("  edit sheet lock jaw…");
  const newSheetUrl = await flyGenerate(buildSheetEditPrompt(c), [sheetUrl, newHeroRead]);
  await downloadToJpg(newSheetUrl, path.join(OUT_DL, `${c.id}_sheet`));
  fs.copyFileSync(path.join(OUT_DL, `${c.id}_sheet.jpg`), path.join(OUT_PUBLIC, `${c.id}_sheet.jpg`));

  log("  ok");
  return {
    id: c.id,
    shapeId: shape.id,
    labelZh: shape.labelZh,
    ok: true,
    at: new Date().toISOString(),
  };
}

async function main() {
  fs.writeFileSync(LOG, `start ${new Date().toISOString()}\n`);
  const done = loadDone();
  const force = String(process.env.FORCE || "").trim() === "1";
  const targets = pickTargets().filter((c) => force || !done.has(c.id));
  log(`🚀 jaw diversify · ${FLY_ORIGIN} · ${targets.length} to run (done=${done.size})`);

  let items: Row[] = [];
  try {
    const prev = JSON.parse(fs.readFileSync(MANIFEST, "utf8")) as { items?: Row[] };
    items = Array.isArray(prev.items) ? prev.items : [];
  } catch {
    items = [];
  }

  for (const c of targets) {
    try {
      const row = await processOne(c);
      items = items.filter((x) => x.id !== c.id).concat(row);
      saveManifest(items);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`  FAIL ${c.id}: ${msg}`);
      const shape = getPhotorealFaceShapeForId(c.id, c.gender);
      items = items.filter((x) => x.id !== c.id).concat({
        id: c.id,
        shapeId: shape.id,
        labelZh: shape.labelZh,
        ok: false,
        error: msg,
        at: new Date().toISOString(),
      });
      saveManifest(items);
    }
    await sleep(2000);
  }

  const ok = items.filter((x) => x.ok).length;
  log(`\n完成 ok=${ok} / tracked=${items.length} · backup=${BACKUP}`);
  if (ok < MANHUA_CHARACTER_ASSET_LIBRARY.length && targets.length) {
    // 部分失败不强制 exit 1，方便续跑；全失败才 1
    if (ok === 0) process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
