/**
 * 逐镜拆片表：内容创作扩写产物的结构化分镜层。
 * 此前六栏（景别/运镜/…）只存在于 2×4 分镜图的像素里，无法复制、导出、复用；
 * 这里给每一镜落成字段（对齐爆款拆片方法：台词一字不差/场景/景别/动作/运镜/剪辑），
 * 供结果卡表格、PDF 导出与出图 scriptContext 三处消费。
 */

import { z } from "zod";

/** 景别 6 选 1（拆片口径） */
export const PLATFORM_SHOT_SIZES_ZH = [
  "全景",
  "远景",
  "中景",
  "近景",
  "特写",
  "大特写",
] as const;

export const platformStoryboardCellSchema = z.object({
  cellIndex: z.number().int().min(1).max(12),
  /** 这一镜嘴里说的每句话，一字不差；无台词留空 */
  dialogueZh: z.string().max(200).default(""),
  /** 画面发生在哪（如「浴室镜前」「烧烤店操作台」） */
  sceneZh: z.string().max(60).default(""),
  /** 景别：全景/远景/中景/近景/特写/大特写 */
  shotSize: z.string().max(12).default(""),
  /** 画面里谁在做什么，核心内容一句说清 */
  actionZh: z.string().max(160).default(""),
  /** 推/拉/摇/移/跟/固定，明确标注 */
  cameraMoveZh: z.string().max(24).default(""),
  /** 转场/特效/BGM 节点等补充 */
  editNoteZh: z.string().max(80).default(""),
});

export type PlatformStoryboardCell = z.infer<typeof platformStoryboardCellSchema>;

export const platformStoryboardCellsSchema = z
  .array(platformStoryboardCellSchema)
  .max(12);

/** 容错归一：LLM 输出/存档回读都走这里，坏行丢弃、镜号重排 */
export function normalizePlatformStoryboardCells(
  raw: unknown,
): PlatformStoryboardCell[] {
  if (!Array.isArray(raw)) return [];
  const out: PlatformStoryboardCell[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const parsed = platformStoryboardCellSchema.safeParse({
      cellIndex: Number(o.cellIndex) || out.length + 1,
      dialogueZh: String(o.dialogueZh ?? o.dialogue ?? "").trim().slice(0, 200),
      sceneZh: String(o.sceneZh ?? o.scene ?? "").trim().slice(0, 60),
      shotSize: String(o.shotSize ?? o.framing ?? "").trim().slice(0, 12),
      actionZh: String(o.actionZh ?? o.action ?? "").trim().slice(0, 160),
      cameraMoveZh: String(o.cameraMoveZh ?? o.cameraMovement ?? "")
        .trim()
        .slice(0, 24),
      editNoteZh: String(o.editNoteZh ?? o.editNote ?? "").trim().slice(0, 80),
    });
    if (!parsed.success) continue;
    const cell = parsed.data;
    // 全空行不是一镜
    if (
      !cell.dialogueZh &&
      !cell.actionZh &&
      !cell.sceneZh &&
      !cell.shotSize
    ) {
      continue;
    }
    out.push(cell);
    if (out.length >= 12) break;
  }
  return out.map((c, i) => ({ ...c, cellIndex: i + 1 }));
}

/**
 * 降级兜底：老扩写卡只有 stepByStepScript 字符串数组
 * （形如「【0-3秒】钩子｜侧光高反差｜缓推｜克制好奇：台词…」）时，尽力拆成镜表。
 * 拆不出的段落整句放进「动作·画面」，保证表格永远有内容可看。
 */
export function buildStoryboardCellsFromStepScript(
  steps: ReadonlyArray<string> | null | undefined,
): PlatformStoryboardCell[] {
  const list = (steps || []).map((s) => String(s || "").trim()).filter(Boolean);
  const cells: PlatformStoryboardCell[] = [];
  for (const line of list) {
    const bare = line.replace(/^【[^】]*】\s*/, "");
    const [head, ...tailParts] = bare.split(/[：:]/);
    const dialogue = tailParts.join("：").trim().slice(0, 200);
    const segs = String(head || "")
      .split(/[｜|]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const shotSize =
      segs.find((s) => (PLATFORM_SHOT_SIZES_ZH as readonly string[]).includes(s)) || "";
    const cameraMove =
      segs.find((s) => /^(缓)?(推|拉|摇|移|跟|固定|环绕)/.test(s)) || "";
    const rest = segs.filter((s) => s !== shotSize && s !== cameraMove);
    cells.push({
      cellIndex: cells.length + 1,
      dialogueZh: dialogue,
      sceneZh: "",
      shotSize,
      actionZh: (rest.join("｜") || bare).slice(0, 160),
      cameraMoveZh: cameraMove,
      editNoteZh: (line.match(/^【([^】]*)】/)?.[1] || "").slice(0, 80),
    });
    if (cells.length >= 12) break;
  }
  return cells;
}

/** Markdown 表格（结果卡渲染与「复制表格」共用） */
export function formatPlatformStoryboardCellsMarkdown(
  cells: ReadonlyArray<PlatformStoryboardCell>,
): string {
  if (!cells.length) return "";
  const esc = (s: string) => s.replace(/\|/g, "／").replace(/\n/g, " ");
  const lines = [
    "| 镜 | 台词文案 | 场景 | 景别 | 动作·画面 | 运镜 | 剪辑备注 |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...cells.map(
      (c) =>
        `| ${c.cellIndex} | ${esc(c.dialogueZh) || "—"} | ${esc(c.sceneZh) || "—"} | ${
          esc(c.shotSize) || "—"
        } | ${esc(c.actionZh) || "—"} | ${esc(c.cameraMoveZh) || "—"} | ${
          esc(c.editNoteZh) || "—"
        } |`,
    ),
  ];
  return lines.join("\n");
}

/**
 * 六栏文本（喂给 2×4 分镜出图的 scriptContext）：
 * 有结构化镜表时不再让出图模型自己拆镜，画格更稳。
 */
export function formatPlatformStoryboardCellsSixColumnText(
  cells: ReadonlyArray<PlatformStoryboardCell>,
): string {
  if (!cells.length) return "";
  const rows = cells.map((c) => {
    const parts = [
      `第${c.cellIndex}格`,
      c.shotSize && `景别：${c.shotSize}`,
      c.cameraMoveZh && `运镜：${c.cameraMoveZh}`,
      c.sceneZh && `场景：${c.sceneZh}`,
      c.actionZh && `画面：${c.actionZh}`,
      c.dialogueZh && `台词：${c.dialogueZh}`,
      c.editNoteZh && `剪辑：${c.editNoteZh}`,
    ].filter(Boolean);
    return parts.join("｜");
  });
  return ["【逐镜拆片表·按此分格，不得自行改镜】", ...rows].join("\n");
}
