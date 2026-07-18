/**
 * 改 Jul18/ref 三位名人脸：刘亦菲 / 高圆圆 / 景甜 → 库内原创女主脸
 * 保留版式/华服/妆造；禁止可识别名人脸。
 *
 *   pnpm exec tsx scripts/rewrite-jul18-ref-faces.mts
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PHOTOREAL_ANTI_AI_LOCK_ZH,
  PHOTOREAL_SKIN_TEXTURE_LOCK_ZH,
} from "../shared/photorealCharacterPrompt.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FLY_ORIGIN = String(process.env.FLY_ORIGIN || "https://mvstudiopro.fly.dev").replace(/\/$/, "");
const DL = path.join(os.homedir(), "Downloads", "2026Jul18", "photoreal-library");
const NEED = path.join(DL, "refs", "jul18-ref", "need-adjust");
const OUT = path.join(DL, "refs", "jul18-ref", "adjusted");
const PUB = path.join(ROOT, "client/public/manhua-characters/photoreal/refs/jul18-ref/adjusted");
const TIMEOUT_MS = Math.min(Math.max(Number(process.env.GEN_TIMEOUT_MS) || 540_000, 120_000), 900_000);

type Job = {
  id: string;
  src: string;
  faceHero: string;
  newNameZh: string;
  keepZh: string;
  banZh: string;
  diversifyZh: string;
};

const JOBS: Job[] = [
  {
    id: "r02",
    src: "r02_liu_yifei_typography.jpg",
    faceHero: "char_f_02_hero.jpg",
    newNameZh: "江晚星",
    keepZh:
      "保留文字云/字海拼贴肖像版式、白底、红唇点缀、肩部以上构图；文字纹理可保留正向关键词（梦想/优雅/独立等）。",
    banZh: "禁止刘亦菲脸、禁止「刘亦菲」「神仙姐姐」「LIU YIFEI」任何名条与印章。",
    diversifyZh: "新脸：鹅蛋脸、眼距略宽、浅笑、长发有层次；与参考女主同族裔写实，但不是同一张脸的复制。",
  },
  {
    id: "r03",
    src: "r03_gao_yuanyuan_typography.jpg",
    faceHero: "char_f_05_hero.jpg",
    newNameZh: "林暮雪",
    keepZh: "保留托腮构图、文字马赛克肖像风格、优雅关键词字海、白底排版感。",
    banZh: "禁止高圆圆脸、禁止「高圆圆」「Gao Yuanyuan」任何名条。",
    diversifyZh: "新脸：柔和下颌、温婉浅笑、长发披肩；写实皮肤，禁止网红磨皮。",
  },
  {
    id: "r09",
    src: "r09_jing_tian_jiangsi.jpg",
    faceHero: "char_f_07_hero.jpg",
    newNameZh: "唐听澜",
    keepZh:
      "保留深蓝金绣华服、凤冠珠翠、额间白珠与泪妆点缀、俯视/半俯视构图、宫廷光影；可保留「姜似」角色感但不写真人名。",
    banZh: "禁止景甜脸、禁止「景甜」二字与任何可识别该演员五官。",
    diversifyZh: "新脸：冷艳凤眼、薄唇朱红、宫装妆造；与华服一体，禁止换戏服。",
  },
];

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function log(line: string) {
  const s = String(line);
  console.log(s);
  try {
    fs.appendFileSync("/tmp/rewrite-jul18-ref-faces.log", `${s}\n`);
  } catch {
    /* ignore */
  }
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

/** 压到最长边 ≤1536，仍输出 jpg 二进制（禁止 base64 体积 +33%） */
function shrinkJpgBinary(srcPath: string, hint: string): { path: string; bytes: Buffer } {
  const tmp = path.join(os.tmpdir(), `jul18-ref-${hint}-${Date.now()}.jpg`);
  const r = spawnSync(
    "sips",
    [
      "-Z",
      "1536",
      "-s",
      "format",
      "jpeg",
      "-s",
      "formatOptions",
      "85",
      srcPath,
      "--out",
      tmp,
    ],
    { encoding: "utf8" },
  );
  const usePath = r.status === 0 && fs.existsSync(tmp) ? tmp : srcPath;
  const bytes = fs.readFileSync(usePath);
  return { path: usePath, bytes };
}

/**
 * GCS 签名 URL · curl --data-binary 原始 jpeg（禁止 base64 / data URL）。
 * base64 约 +33% 体积，大图易超时；生图请求只传 HTTPS URL。
 */
async function uploadLocalJpg(localPath: string, objectHint: string): Promise<string> {
  const { path: shrunkPath, bytes } = shrinkJpgBinary(localPath, objectHint);
  const fileName = path.basename(localPath).replace(/\.[^.]+$/, ".jpg");
  log(`  · binary PUT ${bytes.length} bytes (${shrunkPath === localPath ? "orig" : "shrunk≤1536"})`);
  const signed = await trpcUploadSignedUrl(`jul18-ref-adj/${objectHint}-${fileName}`, "image/jpeg");
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
    console.log(`  · POST canvasGptImage2 refs=${refs.length}`);
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
  const retries = Math.max(1, Number(process.env.GEN_RETRIES || 4) || 4);
  let lastErr: unknown;
  for (let i = 1; i <= retries; i++) {
    try {
      return await flyGenerateOnce(prompt, imageUrls);
    } catch (e) {
      lastErr = e;
      console.warn(`  · fail ${i}/${retries}: ${e instanceof Error ? e.message : e}`);
      await sleep(2500 * i);
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

function buildPrompt(job: Job): string {
  return [
    "竖屏 9:16 图像编辑任务：在第一张参考图（版式/服装底图）上替换人脸，输出可直接入库的漫剧参考图。",
    "",
    `新角色展示名可用「${job.newNameZh}」（原创库名，非真人）。`,
    job.keepZh,
    job.banZh,
    job.diversifyZh,
    "第二张参考图：只借写实皮肤与五官气质作软参考，禁止复制成同一张脸，禁止名人脸。",
    "若原图有大字真人姓名，改为空白或中性字纹，勿写任何明星真名。",
    "",
    PHOTOREAL_SKIN_TEXTURE_LOCK_ZH,
    PHOTOREAL_ANTI_AI_LOCK_ZH,
    "无水印、无 App UI、无二维码。",
  ].join("\n");
}

async function main() {
  fs.writeFileSync("/tmp/rewrite-jul18-ref-faces.log", `start ${new Date().toISOString()}\n`);
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(PUB, { recursive: true });
  const results: Array<{ id: string; ok: boolean; out?: string; error?: string }> = [];

  for (const job of JOBS) {
    const srcPath = path.join(NEED, job.src);
    const facePath = path.join(DL, job.faceHero);
    if (!fs.existsSync(srcPath)) throw new Error(`缺底图 ${srcPath}`);
    if (!fs.existsSync(facePath)) throw new Error(`缺脸参考 ${facePath}`);

    log(`\n━━ ${job.id} → ${job.newNameZh} ━━`);
    try {
      log("  upload base…");
      const baseUrl = await uploadLocalJpg(srcPath, `${job.id}-base`);
      log("  upload face…");
      const faceUrl = await uploadLocalJpg(facePath, `${job.id}-face`);
      log("  uploaded");
      log("  generate…");
      const imageUrl = await flyGenerate(buildPrompt(job), [baseUrl, faceUrl]);
      const baseName = `${job.id}_${job.newNameZh}_adjusted`;
      const outDl = path.join(OUT, baseName);
      const outPub = path.join(PUB, baseName);
      await downloadToJpg(imageUrl, outDl);
      fs.copyFileSync(`${outDl}.jpg`, `${outPub}.jpg`);
      log(`  ok → ${outDl}.jpg`);
      results.push({ id: job.id, ok: true, out: `${baseName}.jpg` });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`  FAIL ${job.id}: ${msg}`);
      results.push({ id: job.id, ok: false, error: msg });
    }
    await sleep(2000);
  }

  const manifest = {
    adjustedAt: new Date().toISOString(),
    policy: "去刘亦菲/高圆圆/景甜可识别脸；保留版式与华服",
    results,
  };
  fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(PUB, "manifest.json"), JSON.stringify(manifest, null, 2));
  const ok = results.filter((r) => r.ok).length;
  log(`\n完成 ${ok}/${results.length} · ${OUT}`);
  if (ok < results.length) process.exit(1);
}

main().catch((e) => {
  const msg = e instanceof Error ? e.stack || e.message : String(e);
  try {
    fs.appendFileSync("/tmp/rewrite-jul18-ref-faces.log", `FATAL ${msg}\n`);
  } catch {
    /* ignore */
  }
  console.error(e);
  process.exit(1);
});

