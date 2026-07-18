/**
 * 仿真人男女主 A/B 对照（不覆盖正式库，只写入 Downloads 审阅目录）
 *
 *   A = 纯文生（不挂真人样本；接近老人槽那条路）
 *   B = 库图 edit + 实拍只借皮肤（FACE_LOCK 关，SOFT_REF 开）
 *
 *   TRACK=both IDS=char_m_01,char_m_07 pnpm run manhua:photoreal-male-ab
 *   TRACK=A IDS=char_f_01,char_f_02,char_f_06,char_f_07
 *   TRACK=B FORCE=1
 *
 * 输出：
 *   ~/Downloads/2026Jul18/photoreal-review/male-A-natural|female-A-natural/
 *   ~/Downloads/2026Jul18/photoreal-review/male-B-skin-only|female-B-skin-only/
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MANHUA_CHARACTER_ASSET_LIBRARY,
  MANHUA_PHOTOREAL_NAME_ZH,
  getManhuaArtStylePreset,
  getManhuaCharacterLifeStage,
  type ManhuaCharacterTemplate,
} from "../shared/manhuaCharacterAssetLibrary.js";
import {
  PHOTOREAL_ANTI_AI_LOCK_ZH,
  PHOTOREAL_ANTI_BEAUTY_FILTER_ZH,
  PHOTOREAL_LOCK_FACE_NOT_WARDROBE_ZH,
  PHOTOREAL_SKIN_TEXTURE_LOCK_ZH,
  PHOTOREAL_SOFT_REF_SKIN_ONLY_ZH,
  formatPhotorealFaceShapeBlock,
  getPhotorealFaceShapeForId,
} from "../shared/photorealCharacterPrompt.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FLY_ORIGIN = String(process.env.FLY_ORIGIN || "https://mvstudiopro.fly.dev").replace(/\/$/, "");
const LIB_PUBLIC = path.join(ROOT, "client/public/manhua-characters/photoreal");
const REFS_PUBLIC = path.join(LIB_PUBLIC, "refs");
const OUT_ROOT = path.join(os.homedir(), "Downloads", "2026Jul18");
const REVIEW = path.join(OUT_ROOT, "photoreal-review");
const LIB_DL = path.join(OUT_ROOT, "photoreal-library");
const REFS_DL = path.join(LIB_DL, "refs");
const TIMEOUT_MS = Math.min(Math.max(Number(process.env.GEN_TIMEOUT_MS) || 540_000, 120_000), 900_000);
const FORCE = /^(1|true|yes)$/i.test(String(process.env.FORCE || "1"));
const TRACK = String(process.env.TRACK || "both").trim().toLowerCase();

type TrackId = "A" | "B";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function trackDirs(track: TrackId, gender: "female" | "male" = "male") {
  const sex = gender === "female" ? "female" : "male";
  const reviewName = track === "A" ? `${sex}-A-natural` : `${sex}-B-skin-only`;
  const libName = track === "A" ? `${sex}-A` : `${sex}-B`;
  return {
    review: path.join(REVIEW, reviewName),
    lib: path.join(LIB_DL, libName),
    manifest: path.join(REVIEW, reviewName, "manifest.json"),
  };
}

function pickTargets(): ManhuaCharacterTemplate[] {
  const idFilter = String(process.env.IDS || "char_m_01,char_m_07,char_m_11,char_m_14")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  // 男女主均可：由 IDS 决定；仅限 adult 仿真人槽
  return MANHUA_CHARACTER_ASSET_LIBRARY.filter(
    (c) => getManhuaCharacterLifeStage(c) === "adult" && idFilter.includes(c.id),
  );
}

function firstExisting(...candidates: string[]): string | undefined {
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return undefined;
}

function pickSoftRefLocalPaths(c: ManhuaCharacterTemplate): string[] {
  const n = Number((c.id.match(/(\d+)$/) || [])[1] || 0);
  if (c.gender === "female") {
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
  const me = firstExisting(path.join(REFS_DL, "me.jpg"), path.join(REFS_PUBLIC, "me.jpg"));
  const tPool = ["t1.jpg", "t2.jpg", "t3.jpg"]
    .map((f) => firstExisting(path.join(REFS_DL, f), path.join(REFS_PUBLIC, f)))
    .filter((x): x is string => Boolean(x));
  const t = tPool.length ? tPool[n % tPool.length]! : undefined;
  return [me, t].filter((x): x is string => Boolean(x));
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

function shrinkJpgIfNeeded(localPath: string): string {
  const st = fs.statSync(localPath);
  if (st.size <= 1_400_000) return localPath;
  const tmp = path.join(os.tmpdir(), `ab-${path.basename(localPath)}`);
  const r = spawnSync(
    "sips",
    ["-Z", "1536", "-s", "format", "jpeg", "-s", "formatOptions", "85", localPath, "--out", tmp],
    { encoding: "utf8" },
  );
  if (r.status === 0 && fs.existsSync(tmp)) return tmp;
  return localPath;
}

async function uploadLocalJpg(localPath: string, objectHint: string): Promise<string> {
  const uploadPath = shrinkJpgIfNeeded(localPath);
  const buf = fs.readFileSync(uploadPath);
  const fileName = path.basename(localPath);
  const signed = await trpcUploadSignedUrl(`photoreal-ab/${objectHint}-${fileName}`, "image/jpeg");
  const headers: Record<string, string> = {
    "Content-Type": "image/jpeg",
    ...(signed.requiredHeaders || {}),
  };
  const put = await fetch(signed.uploadUrl, { method: "PUT", headers, body: buf });
  if (!put.ok) throw new Error(`GCS PUT HTTP ${put.status}`);
  return resolveReadUrl(signed.gcsUri);
}

async function flyGenerateOnce(prompt: string, imageUrls: string[]): Promise<string> {
  const refs = imageUrls.map((u) => String(u || "").trim()).filter(Boolean).slice(0, 16);
  const body = {
    prompt,
    aspectRatio: "9:16" as const,
    referenceImageUrl: refs[0] || undefined,
    referenceImageUrls: refs.length ? refs : undefined,
    imageMode: refs.length ? "edit" : "generate",
    generalImageEdit: refs.length > 0,
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    console.log(`  · POST canvasGptImage2 refs=${refs.length} t=${new Date().toISOString()}`);
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
      throw new Error(`非 JSON 响应 HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    if (!res.ok || !json.ok || !json.imageUrl) throw new Error(json.error || `HTTP ${res.status}`);
    return String(json.imageUrl);
  } finally {
    clearTimeout(timer);
  }
}

async function flyGenerate(prompt: string, imageUrls: string[] = []): Promise<string> {
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
      console.warn(`  · gen fail attempt ${i}/${retries}: ${msg} · sleep ${waitMs}ms`);
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
    ["-s", "format", "jpeg", "-s", "formatOptions", "90", pngPath, "--out", jpgPath],
    { encoding: "utf8" },
  );
  if (r.status !== 0 || !fs.existsSync(jpgPath)) fs.copyFileSync(pngPath, jpgPath);
  try {
    fs.unlinkSync(pngPath);
  } catch {
    /* keep */
  }
}

function writeBoth(
  srcBase: string,
  track: TrackId,
  c: ManhuaCharacterTemplate,
  kind: "hero" | "sheet",
) {
  const dirs = trackDirs(track, c.gender);
  const src = `${srcBase}.jpg`;
  const name = `${c.id}_${kind}.jpg`;
  fs.mkdirSync(dirs.review, { recursive: true });
  fs.mkdirSync(dirs.lib, { recursive: true });
  fs.copyFileSync(src, path.join(dirs.review, name));
  fs.copyFileSync(src, path.join(dirs.lib, name));
}

function alreadyOk(track: TrackId, c: ManhuaCharacterTemplate): boolean {
  if (FORCE) return false;
  const dirs = trackDirs(track, c.gender);
  return (
    fs.existsSync(path.join(dirs.review, `${c.id}_hero.jpg`)) &&
    fs.existsSync(path.join(dirs.review, `${c.id}_sheet.jpg`))
  );
}

function buildAHeroPrompt(c: ManhuaCharacterTemplate): string {
  const name = MANHUA_PHOTOREAL_NAME_ZH[c.id] || c.nameZh;
  const style = getManhuaArtStylePreset("photoreal");
  const role = c.gender === "female" ? "女主" : "男主";
  const life =
    c.gender === "female"
      ? "自然生成生活感成年女性，允许普通长相，禁止网红整容脸。"
      : "自然生成生活感成年男性，允许普通长相，禁止网红美男脸。";
  return [
    `竖屏9:16半身肖像写真，东亚成年${role}「${name}」${c.age ? `约${c.age}岁` : ""}，${c.jobZh}，气质${c.temperamentTags.join("·")}。`,
    "",
    `【线路 A·纯文生】不使用任何真人照片参考；${life}`,
    PHOTOREAL_SKIN_TEXTURE_LOCK_ZH,
    PHOTOREAL_ANTI_BEAUTY_FILTER_ZH,
    formatPhotorealFaceShapeBlock(c.id, c.gender),
    PHOTOREAL_LOCK_FACE_NOT_WARDROBE_ZH,
    "",
    `外形锚点（转写实）：${c.promptZh}`,
    "构图：半身偏上，自然光，浅景深干净背景；禁止名人脸、无文字无水印。",
    "",
    `【画风】${style.labelZh}`,
    style.promptZh,
    "",
    PHOTOREAL_ANTI_AI_LOCK_ZH,
  ].join("\n");
}

function buildASheetPrompt(c: ManhuaCharacterTemplate): string {
  const name = MANHUA_PHOTOREAL_NAME_ZH[c.id] || c.nameZh;
  const style = getManhuaArtStylePreset("photoreal");
  const role = c.gender === "female" ? "女主" : "男主";
  return [
    "生成一张竖版【漫剧角色设定卡】单图（白底或浅灰干净背景）：",
    "上半半身人像 + 下半 FRONT/SIDE/BACK 三视图同一人同一骨相；禁止水印与名人脸。",
    `角色：${role}「${name}」·${c.jobZh}·气质 ${c.temperamentTags.join("·")}`,
    `外形锚点：${c.promptZh}`,
    "【线路 A】锁与胸像同一张自然生成的脸；不挂真人样本。",
    formatPhotorealFaceShapeBlock(c.id, c.gender),
    PHOTOREAL_ANTI_BEAUTY_FILTER_ZH,
    PHOTOREAL_ANTI_AI_LOCK_ZH,
    `【画风】${style.labelZh}`,
    style.promptZh,
  ].join("\n");
}

function buildBHeroEditPrompt(c: ManhuaCharacterTemplate): string {
  const name = MANHUA_PHOTOREAL_NAME_ZH[c.id] || c.nameZh;
  const shape = getPhotorealFaceShapeForId(c.id, c.gender);
  return [
    "竖屏 9:16 安全向肖像编辑：第一张为库图构图/服装底；其后实拍仅作皮肤与光感参考。",
    `角色「${name}」目标骨相：${shape.labelZh}——拉开下颌差异，但禁止把实拍整脸融进库图。`,
    formatPhotorealFaceShapeBlock(c.id, c.gender),
    PHOTOREAL_SOFT_REF_SKIN_ONLY_ZH,
    PHOTOREAL_SKIN_TEXTURE_LOCK_ZH,
    PHOTOREAL_ANTI_BEAUTY_FILTER_ZH,
    PHOTOREAL_ANTI_AI_LOCK_ZH,
    PHOTOREAL_LOCK_FACE_NOT_WARDROBE_ZH,
    "【线路 B】只借皮肤质感，禁止轮廓融脸/同脸复制；禁止网红美男整容感。",
    "得体日常服装；无文字无水印。",
  ].join("\n");
}

function buildBSheetEditPrompt(c: ManhuaCharacterTemplate): string {
  const name = MANHUA_PHOTOREAL_NAME_ZH[c.id] || c.nameZh;
  return [
    "竖屏设定卡安全向编辑：上半胸像与下半 FRONT/SIDE/BACK 同一张脸、同一骨相。",
    `角色「${name}」。第二张为已改骨相/皮肤的胸像；可含实拍皮肤软参考——禁止另融成实拍同脸。`,
    formatPhotorealFaceShapeBlock(c.id, c.gender),
    PHOTOREAL_SOFT_REF_SKIN_ONLY_ZH,
    PHOTOREAL_ANTI_BEAUTY_FILTER_ZH,
    "无文字水印。全家宜内容。",
  ].join("\n");
}

async function runTrackA(c: ManhuaCharacterTemplate): Promise<void> {
  const name = MANHUA_PHOTOREAL_NAME_ZH[c.id] || c.nameZh;
  console.log(`\n━━ [A 纯文生] ${c.id} ${name} ━━`);
  const tmp = path.join(os.tmpdir(), `male-A-${c.id}`);
  fs.mkdirSync(tmp, { recursive: true });
  const heroUrl = await flyGenerate(buildAHeroPrompt(c), []);
  console.log("  hero ok");
  await downloadToJpg(heroUrl, path.join(tmp, "hero"));
  writeBoth(path.join(tmp, "hero"), "A", c, "hero");
  const sheetUrl = await flyGenerate(buildASheetPrompt(c), [heroUrl]);
  console.log("  sheet ok");
  await downloadToJpg(sheetUrl, path.join(tmp, "sheet"));
  writeBoth(path.join(tmp, "sheet"), "A", c, "sheet");
}

async function runTrackB(
  c: ManhuaCharacterTemplate,
  softRefUrlByPath: Map<string, string>,
): Promise<void> {
  const name = MANHUA_PHOTOREAL_NAME_ZH[c.id] || c.nameZh;
  const heroSrc =
    firstExisting(path.join(LIB_DL, `${c.id}_hero.jpg`), path.join(LIB_PUBLIC, `${c.id}_hero.jpg`)) ||
    "";
  const sheetSrc =
    firstExisting(
      path.join(LIB_DL, `${c.id}_sheet.jpg`),
      path.join(LIB_PUBLIC, `${c.id}_sheet.jpg`),
    ) || "";
  if (!heroSrc || !sheetSrc) throw new Error(`缺库图 hero/sheet：${c.id}`);

  console.log(`\n━━ [B 只借皮肤] ${c.id} ${name} ━━`);
  const softPaths = pickSoftRefLocalPaths(c);
  const softUrls = softPaths
    .map((p) => softRefUrlByPath.get(p))
    .filter((u): u is string => Boolean(u));
  const tmp = path.join(os.tmpdir(), `male-B-${c.id}`);
  fs.mkdirSync(tmp, { recursive: true });

  const heroUrl = await uploadLocalJpg(heroSrc, `${c.id}-b-hero`);
  const newHeroUrl = await flyGenerate(buildBHeroEditPrompt(c), [
    heroUrl,
    ...softUrls.slice(0, 1),
  ]);
  console.log("  hero ok");
  await downloadToJpg(newHeroUrl, path.join(tmp, "hero"));
  writeBoth(path.join(tmp, "hero"), "B", c, "hero");

  const sheetUrl = await uploadLocalJpg(sheetSrc, `${c.id}-b-sheet`);
  const newHeroRead = await uploadLocalJpg(path.join(tmp, "hero.jpg"), `${c.id}-b-hero2`);
  const newSheetUrl = await flyGenerate(buildBSheetEditPrompt(c), [
    sheetUrl,
    newHeroRead,
    ...softUrls.slice(0, 1),
  ]);
  console.log("  sheet ok");
  await downloadToJpg(newSheetUrl, path.join(tmp, "sheet"));
  writeBoth(path.join(tmp, "sheet"), "B", c, "sheet");
}

async function main() {
  const tracks: TrackId[] =
    TRACK === "a" ? ["A"] : TRACK === "b" ? ["B"] : TRACK === "both" || TRACK === "ab" ? ["A", "B"] : [];
  if (!tracks.length) throw new Error(`未知 TRACK=${TRACK}（用 A / B / both）`);

  const targets = pickTargets();
  console.log(
    `🚀 male A/B compare · ${FLY_ORIGIN} · tracks=${tracks.join("+")} · slots=${targets.map((c) => c.id).join(",") || "(none)"} · force=${FORCE ? "on" : "off"}`,
  );
  if (!targets.length) throw new Error("无目标成人槽");

  for (const t of tracks) {
    for (const g of ["male", "female"] as const) {
      const d = trackDirs(t, g);
      fs.mkdirSync(d.review, { recursive: true });
      fs.mkdirSync(d.lib, { recursive: true });
    }
  }

  let softRefUrlByPath = new Map<string, string>();
  if (tracks.includes("B")) {
    const uniq = new Set<string>();
    for (const c of targets) for (const p of pickSoftRefLocalPaths(c)) uniq.add(p);
    console.log(`↑ B 线上传皮肤软参考 ${uniq.size} 张…`);
    for (const p of uniq) {
      try {
        softRefUrlByPath.set(p, await uploadLocalJpg(p, `soft-${path.basename(p)}`));
        console.log(`  · ${path.basename(p)} ok`);
      } catch (e) {
        console.warn(`  · ${path.basename(p)} fail: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  const rows: Array<{ track: TrackId; id: string; ok: boolean; error?: string; at: string }> = [];
  for (const track of tracks) {
    for (const c of targets) {
      if (alreadyOk(track, c)) {
        console.log(`⏭ skip ${track}/${c.id}`);
        rows.push({ track, id: c.id, ok: true, at: new Date().toISOString() });
        continue;
      }
      try {
        if (track === "A") await runTrackA(c);
        else await runTrackB(c, softRefUrlByPath);
        rows.push({ track, id: c.id, ok: true, at: new Date().toISOString() });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`❌ ${track}/${c.id}: ${msg}`);
        rows.push({ track, id: c.id, ok: false, error: msg, at: new Date().toISOString() });
      }
      const d = trackDirs(track, c.gender);
      fs.writeFileSync(
        d.manifest,
        JSON.stringify(
          {
            track,
            gender: c.gender,
            policy: track === "A" ? "text-to-image natural" : "edit + soft-ref skin only",
            updatedAt: new Date().toISOString(),
            items: rows.filter((r) => r.track === track),
          },
          null,
          2,
        ),
      );
      await sleep(1200);
    }
  }

  const ok = rows.filter((r) => r.ok).length;
  console.log(`\n完成：ok=${ok}/${rows.length}`);
  console.log(
    `审阅目录：\n  ${path.join(REVIEW, "male-A-natural")}\n  ${path.join(REVIEW, "female-A-natural")}\n  ${path.join(REVIEW, "male-B-skin-only")}\n  ${path.join(REVIEW, "female-B-skin-only")}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
