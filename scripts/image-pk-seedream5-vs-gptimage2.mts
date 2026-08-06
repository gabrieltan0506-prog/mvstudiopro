/**
 * Seedream 5.0 Pro vs GPT-Image-2 对照生成。
 *
 * 同一句提示词、同一比例，两个模型各出一张，记录耗时与计费，图片存到
 * ~/Downloads/2026Aug06/pk/。三组题目分别压中文字排版、人物一致性、复杂版面。
 *
 * 用法：EVOLINK_API_KEY 放进 .env.local，然后 `pnpm tsx scripts/image-pk-seedream5-vs-gptimage2.mts`
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const API = "https://api.evolink.ai";
const OUT_DIR = path.join(homedir(), "Downloads", "2026Aug06", "pk");

function readKey(): string {
  const fromEnv = String(process.env.EVOLINK_API_KEY || "").trim();
  if (fromEnv) return fromEnv;
  const candidates = [
    ".env.local",
    ".env",
    path.join(homedir(), ".codex/worktrees/974b/mvstudiopro/.env.local"),
  ];
  for (const f of candidates) {
    if (!existsSync(f)) continue;
    const m = readFileSync(f, "utf8").match(/^EVOLINK_API_KEY=(.+)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  throw new Error("找不到 EVOLINK_API_KEY，请写进 .env.local");
}

const KEY = readKey();

type Case = { id: string; label: string; ratio: string; prompt: string };

/**
 * 三组题目对应三种真实用途，不是随手挑的风景照：
 * 封面压中文排版，人物压 CG 质感与身份稳定，导演板压多区块复杂版面。
 */
const CASES: Case[] = [
  {
    id: "cover",
    label: "竖屏封面·中文标题排版",
    ratio: "9:16",
    prompt: `小红书风格竖屏封面图。
主体：一位三十岁上下的亚洲女性坐在窗边的木餐桌前，低头看着面前一碗白米饭，神情犹豫，手停在筷子上方。
自然晨光从左侧窗户斜射进来，暖调，浅景深，画面干净。
画面上方留出标题区，用醒目的中文黑体写：「想吃瘦，别减主食」
下方偏右用较小字号写副标题：「先做三件事」
文字必须清晰、笔画完整、无错字、无变形；除这两行外不要出现任何其他文字、水印或标志。
整体色调温暖偏米白，构图留白充足，不要贴纸感，不要廉价滤镜。`,
  },
  {
    id: "character",
    label: "古装人物·CG 写实质感",
    ratio: "3:4",
    prompt: `古装历史剧人物定妆照，半身，正面略侧。
人物：二十五六岁的东亚男性，剑眉，眼神冷峻带疲惫，鬓角有细汗，下颌有一道浅疤。
服装：唐末边关低阶军官的圆领窄袖袍，土黄色麻布，肩甲皮革磨损开裂，领口有洗旧的汗渍与尘土。
道具：腰间挂一枚缺了三分的青白残玉，玉面有暗红沁色。
光线：黄昏侧逆光，暖橙主光从右后方来，左脸留冷蓝补光，颧骨与鼻梁有明确高光转折。
背景：虚化的夯土城墙与远处烽燧，浅景深。
写实电影质感，皮肤有真实毛孔与油光，布料有纤维与磨损细节。
不要仙侠法术，不要现代物品，不要文字，不要水印。`,
  },
  {
    id: "board",
    label: "导演分镜板·多区块复杂版面",
    ratio: "16:9",
    prompt: `一张 16:9 横版短剧导演分镜设定板，用于拍摄前沟通，结合电影概念图、摄影分镜与信息图表。不是电影海报。

版式：中央大型电影主画面约占画布 65%；下方横向排列三个编号小分镜格；右侧为深色垂直信息栏。
中央叠加淡色 9:16 竖屏安全框（青色虚线）。红色箭头标注人物与道具的移动方向，青色箭头标注摄影机运动轨迹。

中央主画面：夜色下的古籍修复馆，冷白日光灯，一名男子俯身在工作台前，指尖沿一枚残玉的裂纹移动，玉面渗出暗红。远处窗外有一点橙色微光。
下方三格：1) 血珠渗入玉纹的微距特写 2) 灯管熄灭瞬间的过曝画面 3) 男子在草堆中猛然坐起的仰角。

右侧信息栏必须逐字呈现以下中文短句，每行一条：
「第01集　残玉认主」
「人物：谢无咎」
「服装：白大褂」
「道具：残玉、修复锥」
「场景：修复馆→马厩」
「运镜：微距固定→过曝切黑→仰角手持」
「灯光：冷白日光→熄灭→草堆晨光」

除上述文字外不要生成任何其他文字。写实历史电影质感，冷蓝与暖黄对照，不要水印，不要标志。`,
  },
];

async function createTask(model: string, c: Case): Promise<string> {
  const isSeedream = model.startsWith("doubao-");
  const body: Record<string, unknown> = isSeedream
    ? { model, prompt: c.prompt, size: c.ratio, quality: "2K", output_format: "png", watermark: false }
    : { model, prompt: c.prompt, size: c.ratio, resolution: "2K", quality: "high", n: 1 };
  const res = await fetch(`${API}/v1/images/generations`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`create ${model} HTTP ${res.status}: ${raw.slice(0, 400)}`);
  const json = JSON.parse(raw);
  console.log(`  [${model}] task=${json.id} 预估积分=${json.usage?.credits_reserved ?? "?"}`);
  return json.id;
}

async function waitTask(id: string, model: string): Promise<{ urls: string[]; ms: number }> {
  const t0 = Date.now();
  for (let i = 0; i < 150; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    const res = await fetch(`${API}/v1/tasks/${id}`, { headers: { Authorization: `Bearer ${KEY}` } });
    const json = JSON.parse(await res.text());
    if (json.status === "completed") return { urls: json.results || [], ms: Date.now() - t0 };
    if (json.status === "failed") {
      throw new Error(`${model} failed: ${json.error?.code} ${json.error?.message}`);
    }
  }
  throw new Error(`${model} 轮询超时`);
}

async function download(url: string, dest: string): Promise<number> {
  const res = await fetch(url);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(dest, buf);
  return buf.length;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const models = ["doubao-seedream-5.0-pro", "gpt-image-2"];
  const report: string[] = ["# Seedream 5.0 Pro vs GPT-Image-2 对照记录", ""];

  for (const c of CASES) {
    console.log(`\n=== ${c.label}（${c.ratio}）===`);
    report.push(`## ${c.label}（${c.ratio}）`, "");
    for (const model of models) {
      try {
        const id = await createTask(model, c);
        const { urls, ms } = await waitTask(id, model);
        if (!urls.length) throw new Error("完成但无结果 URL");
        const ext = urls[0].includes(".jpg") || urls[0].includes(".jpeg") ? "jpg" : "png";
        const file = path.join(OUT_DIR, `${c.id}__${model.replace(/[^a-z0-9]/gi, "-")}.${ext}`);
        const bytes = await download(urls[0], file);
        console.log(`  ✓ ${model} ${(ms / 1000).toFixed(1)}s ${(bytes / 1024).toFixed(0)}KB → ${file}`);
        report.push(`- **${model}** · ${(ms / 1000).toFixed(1)}s · ${(bytes / 1024).toFixed(0)}KB · \`${file}\``);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`  ✗ ${model} ${msg}`);
        report.push(`- **${model}** · 失败：${msg}`);
      }
    }
    report.push("");
  }
  writeFileSync(path.join(OUT_DIR, "report.md"), report.join("\n"));
  console.log(`\n报告：${path.join(OUT_DIR, "report.md")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
