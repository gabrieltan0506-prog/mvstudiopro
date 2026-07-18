/**
 * 方案 1C：用 canvasGptImage2（generalImageEdit）拉开仿真人库下颌/骨相差异。
 * 上传：shrink≤1536 + curl --data-binary（禁 base64）。
 *
 *   FLY_ORIGIN=https://mvstudiopro.fly.dev pnpm run manhua:photoreal-diversify-jaws
 *   IDS=char_f_02,char_m_01 LIMIT=4
 *   FORCE=1 RESTORE_BACKUP=1          # 从备份重跑已成功槽（方案 A 加大骨相）
 *   SOFT_REF=0                         # 关闭 me/t1–t3 / jul18 女像参考
 *   FACE_LOCK=1                        # 成人男主：实拍皮肤+五官轮廓锚（默认开）；女主仍只借皮肤
 *   INCLUDE_AGE_SLOTS=1                # 默认跳过老人/儿童（用 manhua:photoreal-age-slots）
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MANHUA_CHARACTER_ASSET_LIBRARY,
  MANHUA_PHOTOREAL_NAME_ZH,
  getManhuaCharacterLifeStage,
  type ManhuaCharacterTemplate,
} from "../shared/manhuaCharacterAssetLibrary.js";
import {
  PHOTOREAL_ANTI_AI_LOCK_ZH,
  PHOTOREAL_ANTI_BEAUTY_FILTER_ZH,
  PHOTOREAL_FACE_LOCK_BLEND_ZH,
  PHOTOREAL_LOCK_FACE_NOT_WARDROBE_ZH,
  PHOTOREAL_SKIN_TEXTURE_LOCK_ZH,
  PHOTOREAL_SOFT_REF_SKIN_ONLY_ZH,
  formatPhotorealFaceShapeBlock,
  getPhotorealFaceShapeForId,
} from "../shared/photorealCharacterPrompt.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FLY_ORIGIN = String(process.env.FLY_ORIGIN || "https://mvstudiopro.fly.dev").replace(/\/$/, "");
const OUT_PUBLIC = path.join(ROOT, "client/public/manhua-characters/photoreal");
const REFS_PUBLIC = path.join(OUT_PUBLIC, "refs");
const OUT_DL = path.join(os.homedir(), "Downloads", "2026Jul18", "photoreal-library");
const REFS_DL = path.join(OUT_DL, "refs");
const BACKUP = path.join(OUT_DL, "jaw-diversify-backup");
const MANIFEST = path.join(OUT_DL, "jaw-diversify-manifest.json");
const LOG = "/tmp/diversify-photoreal-jaws.log";
const TIMEOUT_MS = Math.min(Math.max(Number(process.env.GEN_TIMEOUT_MS) || 540_000, 120_000), 900_000);
/** 默认开参考图；SOFT_REF=0 可关 */
const USE_SOFT_REF = !/^(0|false|no)$/i.test(String(process.env.SOFT_REF || "1"));
/** 成人男主：皮肤+轮廓锚；FACE_LOCK=0 则退回只借皮肤 */
const USE_FACE_LOCK = !/^(0|false|no)$/i.test(String(process.env.FACE_LOCK || "1"));
const INCLUDE_AGE_SLOTS = /^(1|true|yes)$/i.test(String(process.env.INCLUDE_AGE_SLOTS || ""));

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
  if (!INCLUDE_AGE_SLOTS) {
    list = list.filter((c) => getManhuaCharacterLifeStage(c) === "adult");
  }
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

async function trpcUploadSignedUrlOnce(fileName: string, mimeType: string) {
  const url = `${FLY_ORIGIN}/api/trpc/mvAnalysis.getVideoUploadSignedUrl?batch=1`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ "0": { json: { fileName, mimeType } } }),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`signedUrl 非 JSON HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const row = Array.isArray(json) ? json[0] : json;
  const data =
    (row as { result?: { data?: { json?: Record<string, string> } } })?.result?.data?.json ||
    (row as { result?: { data?: Record<string, string> } })?.result?.data ||
    (row as Record<string, string>);
  const uploadUrl = String((data as { uploadUrl?: string })?.uploadUrl || "");
  const gcsUri = String((data as { gcsUri?: string })?.gcsUri || "");
  if (!uploadUrl || !gcsUri) throw new Error(`signedUrl 失败 HTTP ${res.status}: ${text.slice(0, 300)}`);
  return {
    uploadUrl,
    gcsUri,
    requiredHeaders: (data as { requiredHeaders?: Record<string, string> }).requiredHeaders,
  };
}

async function trpcUploadSignedUrl(fileName: string, mimeType: string) {
  const retries = Math.max(1, Number(process.env.UPLOAD_RETRIES || 5) || 5);
  let lastErr: unknown;
  for (let i = 1; i <= retries; i++) {
    try {
      return await trpcUploadSignedUrlOnce(fileName, mimeType);
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      const waitMs = Math.min(30_000, 1500 * i * i);
      log(`  · signedUrl fail ${i}/${retries}: ${msg.slice(0, 120)} · sleep ${waitMs}ms`);
      await sleep(waitMs);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
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
  try {
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
    const code = String(put.stdout || "").trim();
    if (put.status !== 0 || !/^2\d\d$/.test(code)) {
      throw new Error(`GCS binary PUT fail status=${put.status} http=${code} err=${put.stderr?.slice(0, 200)}`);
    }
    return await resolveReadUrl(signed.gcsUri);
  } finally {
    if (shrunkPath !== localPath) {
      try {
        fs.unlinkSync(shrunkPath);
      } catch {
        /* keep */
      }
    }
  }
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

/** 失败重跑前还原备份，避免半成功 hero 被二次改骨相 */
function restoreFromBackupIfRequested(id: string) {
  if (String(process.env.RESTORE_BACKUP || "").trim() !== "1") return;
  for (const kind of ["hero", "sheet"] as const) {
    const dest = path.join(OUT_DL, `${id}_${kind}.jpg`);
    const src = path.join(BACKUP, `${id}_${kind}.jpg`);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
      log(`  · restore ${kind} from backup`);
    }
  }
}

function firstExisting(...candidates: string[]): string | undefined {
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return undefined;
}

/**
 * 成人男：me + t1–t3 作皮肤/轮廓锚（非网红整容）。
 * 成人女：jul18 ready 女像（只借皮肤）。
 */
function pickSoftRefLocalPaths(c: ManhuaCharacterTemplate): string[] {
  if (!USE_SOFT_REF) return [];
  // 老人/儿童不挂男主实拍脸
  if (getManhuaCharacterLifeStage(c) !== "adult") return [];
  const n = Number((c.id.match(/(\d+)$/) || [])[1] || 0);
  if (c.gender === "male") {
    const me = firstExisting(path.join(REFS_DL, "me.jpg"), path.join(REFS_PUBLIC, "me.jpg"));
    const tPool = ["t1.jpg", "t2.jpg", "t3.jpg"]
      .map((f) => firstExisting(path.join(REFS_DL, f), path.join(REFS_PUBLIC, f)))
      .filter((x): x is string => Boolean(x));
    // 同脸模式：me 必挂；再挂一张 t* 作表情/光线辅锚
    const t = tPool.length ? tPool[n % tPool.length]! : undefined;
    return [me, t].filter((x): x is string => Boolean(x));
  }
  const readyDir = path.join(REFS_PUBLIC, "jul18-ref", "ready");
  let females: string[] = [];
  try {
    females = fs
      .readdirSync(readyDir)
      .filter((f) => /female/i.test(f) && /\.jpe?g$/i.test(f))
      .map((f) => path.join(readyDir, f))
      .sort();
  } catch {
    females = [];
  }
  if (!females.length) return [];
  return [females[n % females.length]!];
}

function refPolicyBlock(c: ManhuaCharacterTemplate, hasSoftRef: boolean): string {
  if (!hasSoftRef) return "";
  if (c.gender === "male" && USE_FACE_LOCK) return PHOTOREAL_FACE_LOCK_BLEND_ZH;
  return PHOTOREAL_SOFT_REF_SKIN_ONLY_ZH;
}

function buildHeroEditPrompt(c: ManhuaCharacterTemplate, hasSoftRef: boolean): string {
  const name = MANHUA_PHOTOREAL_NAME_ZH[c.id] || c.nameZh;
  const shape = getPhotorealFaceShapeForId(c.id, c.gender);
  const faceLock = c.gender === "male" && USE_FACE_LOCK && hasSoftRef;
  return [
    faceLock
      ? "竖屏 9:16 安全向肖像编辑：第一张为库图构图/服装底，其后为实拍参考——只调皮肤质感与五官轮廓，禁止整容成网红美男。"
      : "竖屏 9:16 安全向肖像编辑：保持同一人身份与发型大轮廓，但下颌骨相必须明显拉开（并排放一眼可辨），不是磨皮级微调。",
    `角色「${name}」目标骨相：${shape.labelZh}${faceLock ? "（轮廓微调，勿整容换人）" : "——下颌宽度、下巴形状、下颌角按该目标明显偏移"}。`,
    formatPhotorealFaceShapeBlock(c.id, c.gender),
    faceLock
      ? "皮肤与大轮廓跟实拍气质；服装/背景/构图跟库图；允许普通长相与轻微岁月痕迹。"
      : "眉眼鼻唇可保留可识别连续性；下庭轮廓必须改到与原图有清晰差异；禁止仍是统一小尖下巴/小V脸。",
    "禁止名人脸、禁止暴露服装、禁止性暗示、禁止未成年人形象。",
    PHOTOREAL_SKIN_TEXTURE_LOCK_ZH,
    PHOTOREAL_ANTI_BEAUTY_FILTER_ZH,
    refPolicyBlock(c, hasSoftRef),
    PHOTOREAL_ANTI_AI_LOCK_ZH,
    PHOTOREAL_LOCK_FACE_NOT_WARDROBE_ZH,
    "得体日常服装、干净背景；无文字无水印。全家宜内容。",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildSheetEditPrompt(c: ManhuaCharacterTemplate, hasSoftRef: boolean): string {
  const name = MANHUA_PHOTOREAL_NAME_ZH[c.id] || c.nameZh;
  const faceLock = c.gender === "male" && USE_FACE_LOCK && hasSoftRef;
  return [
    "竖屏设定卡安全向编辑：上半胸像与下半 FRONT/SIDE/BACK 三视图同一张脸、同一骨相。",
    faceLock
      ? `角色「${name}」。第二张为已改皮肤/轮廓的胸像、其后可含实拍锚——三视图须同一人，禁止另长一张网红脸。`
      : `角色「${name}」。第二张参考为已改骨相胸像——三视图对齐该骨相（下颌差异必须保留到三视图）。`,
    formatPhotorealFaceShapeBlock(c.id, c.gender),
    "下颌/下巴须与胸像一致；服装保持得体日常覆盖；禁止暴露、禁止换成别人。",
    PHOTOREAL_SKIN_TEXTURE_LOCK_ZH,
    PHOTOREAL_ANTI_BEAUTY_FILTER_ZH,
    refPolicyBlock(c, hasSoftRef),
    "无文字水印。全家宜内容。",
  ]
    .filter(Boolean)
    .join("\n");
}

async function processOne(
  c: ManhuaCharacterTemplate,
  softRefUrlByPath: Map<string, string>,
): Promise<Row> {
  const shape = getPhotorealFaceShapeForId(c.id, c.gender);
  const heroPath = path.join(OUT_DL, `${c.id}_hero.jpg`);
  const sheetPath = path.join(OUT_DL, `${c.id}_sheet.jpg`);
  if (!fs.existsSync(heroPath)) throw new Error(`缺 hero ${heroPath}`);
  if (!fs.existsSync(sheetPath)) throw new Error(`缺 sheet ${sheetPath}`);

  backupIfNeeded(c.id, "hero");
  backupIfNeeded(c.id, "sheet");
  restoreFromBackupIfRequested(c.id);

  const softPaths = pickSoftRefLocalPaths(c);
  const softUrls = softPaths
    .map((p) => softRefUrlByPath.get(p))
    .filter((u): u is string => Boolean(u));
  const hasSoftRef = softUrls.length > 0;

  const faceLock = c.gender === "male" && USE_FACE_LOCK && hasSoftRef;
  const modeTag = faceLock ? "face-lock" : hasSoftRef ? "soft-ref" : "no-ref";
  log(`\n━━ ${c.id} ${MANHUA_PHOTOREAL_NAME_ZH[c.id] || c.nameZh} · ${shape.labelZh} · ${modeTag} ━━`);
  log("  upload hero…");
  const heroUrl = await uploadLocalJpg(heroPath, `${c.id}-hero`);
  log(faceLock ? "  edit hero face-lock blend…" : "  edit hero jaw…");
  // 第一张=库图底；其后=实拍（男主同脸锚可挂 me+t*）
  const heroRefs = faceLock ? [heroUrl, ...softUrls.slice(0, 2)] : [heroUrl, ...softUrls.slice(0, 1)];
  const newHeroUrl = await flyGenerate(buildHeroEditPrompt(c, hasSoftRef), heroRefs);
  await downloadToJpg(newHeroUrl, path.join(OUT_DL, `${c.id}_hero`));
  fs.copyFileSync(path.join(OUT_DL, `${c.id}_hero.jpg`), path.join(OUT_PUBLIC, `${c.id}_hero.jpg`));

  log("  upload sheet + new hero…");
  const sheetUrl = await uploadLocalJpg(sheetPath, `${c.id}-sheet`);
  const newHeroRead = await uploadLocalJpg(path.join(OUT_DL, `${c.id}_hero.jpg`), `${c.id}-hero2`);
  log(faceLock ? "  edit sheet face-lock…" : "  edit sheet lock jaw…");
  const sheetRefs = faceLock
    ? [sheetUrl, newHeroRead, ...softUrls.slice(0, 1)]
    : [sheetUrl, newHeroRead, ...softUrls.slice(0, 1)];
  const newSheetUrl = await flyGenerate(buildSheetEditPrompt(c, hasSoftRef), sheetRefs);
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
  log(
    `🚀 jaw diversify · ${FLY_ORIGIN} · ${targets.length} to run (done=${done.size}) · softRef=${USE_SOFT_REF ? "on" : "off"} · faceLock=${USE_FACE_LOCK ? "on" : "off"} · strength=A`,
  );

  const softRefUrlByPath = new Map<string, string>();
  if (USE_SOFT_REF && targets.length) {
    const uniq = new Set<string>();
    for (const c of targets) {
      for (const p of pickSoftRefLocalPaths(c)) uniq.add(p);
    }
    log(`↑ 上传软参考 ${uniq.size} 张…`);
    let i = 0;
    for (const p of uniq) {
      i += 1;
      const hint = `soft-${path.basename(p).replace(/\.[^.]+$/, "")}-${i}`;
      const url = await uploadLocalJpg(p, hint);
      softRefUrlByPath.set(p, url);
      log(`  · ${path.basename(p)} ok`);
    }
  }

  let items: Row[] = [];
  try {
    const prev = JSON.parse(fs.readFileSync(MANIFEST, "utf8")) as { items?: Row[] };
    items = Array.isArray(prev.items) ? prev.items : [];
  } catch {
    items = [];
  }

  for (const c of targets) {
    try {
      const row = await processOne(c, softRefUrlByPath);
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
