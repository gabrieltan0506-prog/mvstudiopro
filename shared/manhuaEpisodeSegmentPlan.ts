/**
 * 单集 10–12 段 × 15s 可拍表：意图 / 对白 / 表演 / 场景配色 / 角色 / 服化道 / 光影运镜。
 * 禁止灌水：缺字段、寒暄对白、段间高度重复、对白过稀 → 质量不通过。
 * 数值与 `manhuaScriptWorkbench` 的 MANHUA_SEGMENT_MIN/MAX/DEFAULT / 15s 对齐。
 */

import {
  compileManhuaDirectedSegmentPrompt,
  stripManhuaPromptSlop,
} from "./manhuaDirectingWorkflow.js";

/** 推荐段数（扩写默认目标） */
export const MANHUA_EPISODE_SEGMENT_COUNT = 12;
export const MANHUA_EPISODE_SEGMENT_COUNT_MIN = 10;
export const MANHUA_EPISODE_SEGMENT_COUNT_MAX = 12;
export const MANHUA_EPISODE_SEGMENT_DURATION_SEC = 15;
export const MANHUA_EPISODE_SEGMENT_TARGET_SEC = 180;
export const MANHUA_EPISODE_SEGMENT_TARGET_MIN_SEC = 150;

/** 每段约 15s：至少 3 句「」对白（推荐 3–4） */
export const MANHUA_EPISODE_SEGMENT_MIN_DIALOGUE_QUOTES = 3;

export type ManhuaEpisodeSegmentBeat = {
  index: number;
  /** 本段单一意图：观众应感到什么（导戏硬锚） */
  intentZh: string;
  dialogueZh: string;
  /** 表情 / 肢体 / 情绪起伏（可拍表演） */
  performanceZh: string;
  sceneZh: string;
  paletteZh: string;
  castZh: string;
  wardrobePropZh: string;
  lightingCameraZh: string;
};

export type ManhuaEpisodeSegmentPlan = {
  segmentCount: number;
  durationSecPerSegment: number;
  targetSec: number;
  segments: ManhuaEpisodeSegmentBeat[];
};

export type ManhuaEpisodeSegmentPlanQuality = {
  ok: boolean;
  readyCount: number;
  requiredCount: number;
  issues: string[];
};

const FILLER_DIALOGUE_RE =
  /^(嗯+|啊+|哦+|好的|是的|对啊|哈哈+|今天天气|你好啊|在吗|没事|随便|加油|晚安|早啊)[.。!！?？…]*$/i;

const PERFORMANCE_CUE_RE =
  /表情|眼神|眉|嘴角|咬唇|咬牙|泪|哽|颤|冷笑|怒|慌|沉|握拳|攥|指|推|退|逼近|侧身|抬头|低头|转身|跪|扑|甩|肢体|情绪|气口/;

const FIELD_KEYS: Array<{
  key: keyof Omit<ManhuaEpisodeSegmentBeat, "index">;
  aliases: string[];
}> = [
  { key: "intentZh", aliases: ["意图", "本段意图", "戏剧意图", "观众感受"] },
  { key: "dialogueZh", aliases: ["对白", "台词", "对话"] },
  { key: "performanceZh", aliases: ["表演", "表情肢体", "情绪表演", "表情", "肢体"] },
  { key: "sceneZh", aliases: ["场景", "地点", "场次"] },
  { key: "paletteZh", aliases: ["配色风格", "配色", "色调", "风格色"] },
  { key: "castZh", aliases: ["角色", "出演", "人物"] },
  { key: "wardrobePropZh", aliases: ["服装道具", "服化道", "服装", "道具"] },
  { key: "lightingCameraZh", aliases: ["光影运镜", "光影", "运镜", "镜头"] },
];

function normalizeFieldLine(raw: string): string {
  return String(raw || "")
    .replace(/^[\s>*\-•·]+/, "")
    .replace(/\*\*/g, "")
    .trim();
}

function pickField(block: string, aliases: string[]): string {
  for (const alias of aliases) {
    const re = new RegExp(
      `(?:^|\\n)\\s*[-*·]?\\s*${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[:：]\\s*([^\\n]+)`,
      "i",
    );
    const m = block.match(re)?.[1];
    if (m && normalizeFieldLine(m).length >= 2) return normalizeFieldLine(m).slice(0, 400);
  }
  return "";
}

/**
 * 对白可单行，也可写成：
 * - 对白：
 *   - 甲：「…」
 *   - 乙：「…」
 */
function pickDialogueField(block: string): string {
  // 冒号后只用同行空白，避免 \s 吃掉换行把下一子弹进「行内」
  const header = block.match(
    /(?:^|\n)[ \t]*[-*·]?[ \t]*(?:对白|台词|对话)[ \t]*[:：][ \t]*([^\n]*)/i,
  );
  if (!header || header.index == null) return "";
  const inline = normalizeFieldLine(header[1] || "");
  const collected: string[] = [];
  if (inline) collected.push(inline);

  const after = block.slice(header.index + header[0].length);
  for (const rawLine of after.split("\n")) {
    const line = String(rawLine || "");
    if (
      /^[ \t]*[-*·]?[ \t]*(表演|表情肢体|情绪表演|场景|地点|场次|配色风格|配色|色调|角色|出演|人物|服装道具|服化道|服装|道具|光影运镜|光影|运镜|镜头)[ \t]*[:：]/.test(
        line,
      )
    ) {
      break;
    }
    const t = line.replace(/^[ \t]*[-*·][ \t]*/, "").trim();
    if (!t) {
      if (collected.length) break;
      continue;
    }
    collected.push(t);
  }
  const readable = collected.join(" ").replace(/\s+/g, " ").trim();
  return readable.slice(0, 500);
}

function emptyBeat(index: number): ManhuaEpisodeSegmentBeat {
  return {
    index,
    intentZh: "",
    dialogueZh: "",
    performanceZh: "",
    sceneZh: "",
    paletteZh: "",
    castZh: "",
    wardrobePropZh: "",
    lightingCameraZh: "",
  };
}

/** 统计对白行内直角/弯引号句数 */
export function countManhuaSegmentDialogueQuotes(dialogueZh: string): number {
  const t = String(dialogueZh || "");
  const cn = t.match(/「[^」]{1,80}」/g) || [];
  const curly = t.match(/[\u201c“][^\u201d”]{1,80}[\u201d”]/g) || [];
  const en = t.match(/"[^"]{1,80}"/g) || [];
  return new Set([...cn, ...curly, ...en].map((s) => s.trim())).size;
}

/** 从「#### 段01」或「#### 段 1」块解析 */
export function parseManhuaEpisodeSegmentPlanFromMarkdown(md: string): ManhuaEpisodeSegmentPlan {
  const text = String(md || "");
  const segments: ManhuaEpisodeSegmentBeat[] = [];
  const re = /(?:^|\n)#{2,4}\s*段\s*0*(\d{1,2})\s*\n([\s\S]*?)(?=\n#{2,4}\s*段\s*0*\d|\n#{2,3}\s*片尾钩子|\n##\s*第\d+集|\n##\s[^#]|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const index = Math.floor(Number(m[1]));
    if (!Number.isFinite(index) || index < 1 || index > 24) continue;
    const block = m[2] || "";
    const beat = emptyBeat(index);
    for (const field of FIELD_KEYS) {
      if (field.key === "dialogueZh") {
        beat.dialogueZh = pickDialogueField(block);
        continue;
      }
      beat[field.key] = pickField(block, field.aliases);
    }
    segments.push(beat);
  }
  segments.sort((a, b) => a.index - b.index);
  // 去重同 index，保留字段更全的一条
  const byIndex = new Map<number, ManhuaEpisodeSegmentBeat>();
  for (const s of segments) {
    const prev = byIndex.get(s.index);
    if (!prev) {
      byIndex.set(s.index, s);
      continue;
    }
    const score = (b: ManhuaEpisodeSegmentBeat) =>
      FIELD_KEYS.reduce((n, f) => n + (b[f.key] ? 1 : 0), 0);
    if (score(s) >= score(prev)) byIndex.set(s.index, s);
  }
  const ordered = Array.from(byIndex.values()).sort((a, b) => a.index - b.index);
  return {
    segmentCount: MANHUA_EPISODE_SEGMENT_COUNT,
    durationSecPerSegment: MANHUA_EPISODE_SEGMENT_DURATION_SEC,
    targetSec: MANHUA_EPISODE_SEGMENT_TARGET_SEC,
    segments: ordered,
  };
}

function isFillerDialogue(s: string): boolean {
  const t = s.replace(/\s+/g, "").trim();
  if (t.length < 4) return true;
  if (FILLER_DIALOGUE_RE.test(t)) return true;
  if (/^(哈哈|嘿嘿|呵呵|嗯嗯|啊啊)+$/.test(t)) return true;
  return false;
}

function nearDuplicate(a: string, b: string): boolean {
  const x = a.replace(/\s+/g, "");
  const y = b.replace(/\s+/g, "");
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.length >= 8 && y.length >= 8 && (x.includes(y) || y.includes(x))) return true;
  return false;
}

export function evaluateManhuaEpisodeSegmentPlanQuality(
  plan: ManhuaEpisodeSegmentPlan | null | undefined,
  requiredCount:
    | number
    | { min?: number; max?: number } = {
      min: MANHUA_EPISODE_SEGMENT_COUNT_MIN,
      max: MANHUA_EPISODE_SEGMENT_COUNT_MAX,
    },
): ManhuaEpisodeSegmentPlanQuality {
  const issues: string[] = [];
  const segments = plan?.segments || [];
  const minRequired =
    typeof requiredCount === "number"
      ? Math.max(1, Math.min(24, requiredCount))
      : Math.max(
          1,
          Math.min(
            24,
            Math.floor(requiredCount.min ?? MANHUA_EPISODE_SEGMENT_COUNT_MIN),
          ),
        );
  const maxRequired =
    typeof requiredCount === "number"
      ? minRequired
      : Math.max(
          minRequired,
          Math.min(
            24,
            Math.floor(requiredCount.max ?? MANHUA_EPISODE_SEGMENT_COUNT_MAX),
          ),
        );

  let readyCount = 0;
  const seenDialogue: string[] = [];
  const seenScene: string[] = [];

  // 从段 1 连续验收到 max；允许在 [min,max] 提前收束
  for (let i = 1; i <= maxRequired; i++) {
    const beat = segments.find((s) => s.index === i);
    if (!beat) {
      if (readyCount < minRequired) {
        issues.push(`缺段 ${String(i).padStart(2, "0")}`);
      }
      break;
    }
    const missing = FIELD_KEYS.filter((f) => !String(beat[f.key] || "").trim()).map((f) => f.aliases[0]);
    if (missing.length) {
      issues.push(`段${String(i).padStart(2, "0")} 缺字段：${missing.join("、")}`);
      break;
    }
    if (isFillerDialogue(beat.dialogueZh)) {
      issues.push(`段${String(i).padStart(2, "0")} 对白灌水或过短`);
      break;
    }
    const quotes = countManhuaSegmentDialogueQuotes(beat.dialogueZh);
    if (quotes < MANHUA_EPISODE_SEGMENT_MIN_DIALOGUE_QUOTES) {
      issues.push(
        `段${String(i).padStart(2, "0")} 对白仅 ${quotes} 句「」，约15秒段至少 ${MANHUA_EPISODE_SEGMENT_MIN_DIALOGUE_QUOTES} 句（推荐3–4句）`,
      );
      break;
    }
    const intent = String(beat.intentZh || "").trim();
    if (intent.length < 4) {
      issues.push(`段${String(i).padStart(2, "0")} 缺本段意图：须写清观众应感到什么`);
      break;
    }
    const perf = String(beat.performanceZh || "").trim();
    if (perf.length < 8 || !PERFORMANCE_CUE_RE.test(perf)) {
      issues.push(
        `段${String(i).padStart(2, "0")} 表演过薄：须写清表情/肢体/情绪起伏（可拍）`,
      );
      break;
    }
    if (seenDialogue.some((d) => nearDuplicate(d, beat.dialogueZh))) {
      issues.push(`段${String(i).padStart(2, "0")} 对白与他段重复`);
      break;
    }
    seenDialogue.push(beat.dialogueZh);
    seenScene.push(beat.sceneZh);
    readyCount += 1;
  }

  if (readyCount < minRequired) {
    issues.unshift(
      `可拍段不足：需要 ${minRequired}–${maxRequired} 段，当前连续合格 ${readyCount} 段`,
    );
  }

  const uniqueScenes = new Set(seenScene.map((s) => s.replace(/\s+/g, ""))).size;
  if (readyCount >= minRequired && uniqueScenes <= 2) {
    issues.push(
      `场景几乎不换场：${minRequired}–${maxRequired} 段须有空间/氛围递进，禁止同一空壳场景复读`,
    );
  }

  return {
    ok: readyCount >= minRequired && readyCount <= maxRequired && issues.length === 0,
    readyCount,
    requiredCount: minRequired,
    issues: issues.slice(0, 16),
  };
}

/** 编剧扩写 prompt 用的十至十二段表头说明（禁灌水） */
export function formatManhuaEpisodeSegmentPlanPromptBlock(
  segmentCount = MANHUA_EPISODE_SEGMENT_COUNT,
  durationSec = MANHUA_EPISODE_SEGMENT_DURATION_SEC,
): string {
  const n = Math.max(
    MANHUA_EPISODE_SEGMENT_COUNT_MIN,
    Math.min(MANHUA_EPISODE_SEGMENT_COUNT_MAX, segmentCount),
  );
  const minSec = MANHUA_EPISODE_SEGMENT_COUNT_MIN * durationSec;
  const maxSec = MANHUA_EPISODE_SEGMENT_COUNT_MAX * durationSec;
  return [
    `### 十至十二段可拍表`,
    `（硬性：至少 ${MANHUA_EPISODE_SEGMENT_COUNT_MIN} 段、至多 ${MANHUA_EPISODE_SEGMENT_COUNT_MAX} 段；推荐 ${n} 段；每段约 ${durationSec} 秒；整集约 ${minSec}–${maxSec} 秒。禁止寒暄灌水、禁止段间复制粘贴。）`,
    `每一段必须用下列字段（缺一不可）：`,
    `- 意图：一句「观众应感到什么」（单一戏剧意图）；机位/光/表演只服务这一句。`,
    `- 对白：至少 ${MANHUA_EPISODE_SEGMENT_MIN_DIALOGUE_QUOTES} 句直角引号「」（推荐 3–4 句），须推动关系/信息/冲突；禁止两句口号撑满 ${durationSec} 秒。`,
    `- 表演：写清表情、肢体与情绪起伏（可拍），与对白气口对齐；禁止只写抽象词如「很生气」。`,
    `#### 段01`,
    `- 意图：`,
    `- 对白：`,
    `- 表演：`,
    `- 场景：`,
    `- 配色风格：`,
    `- 角色：`,
    `- 服装道具：`,
    `- 光影运镜：`,
    `（段02…段${String(n).padStart(2, "0")} 同结构；若只写到段10亦可，但不得少于10段；跨段须有信息增量与场面变化。禁止把后段钩子提前写进本段对白。）`,
  ].join("\n");
}

/** 单测夹具：12 段合格可拍表（禁止当产品灌水生成器用） */
export function buildManhuaEpisodeSegmentPlanFixtureMarkdown(): string {
  const scenes = [
    "雨夜回廊",
    "烛火偏殿",
    "鹤影湖堤",
    "山神破庙",
    "雨夜回廊侧门",
    "偏殿屏风后",
    "湖堤石阶",
    "破庙香案前",
    "回廊转角",
    "偏殿门槛",
    "湖面栈桥",
    "破庙外阶",
  ];
  const blocks = scenes.map((scene, i) => {
    const n = String(i + 1).padStart(2, "0");
    const k = i + 1;
    return [
      `#### 段${n}`,
      `- 意图：压迫感逼近，旧盟从硬撑到松口`,
      `- 对白：「把玉珏交出来——第${k}次。」「你再装傻，我就掀了这屏风。」「……拿去，别碰她。」`,
      `- 表演：逼近方眉心紧、握拳指节发白；对方先冷笑再眼神一颤，后退半步攥袖。`,
      `- 场景：${scene}`,
      `- 配色风格：冷青主色，烛金辅，血锈点缀`,
      `- 角色：沈清逼近；旧盟冷笑后退`,
      `- 服装道具：青衣银簪；半枚玉珏握于掌心`,
      `- 光影运镜：侧逆光压暗；中景推至近景`,
    ].join("\n");
  });
  return ["### 十至十二段可拍表", ...blocks].join("\n");
}

/** 把可拍表压成工厂节拍提示（不编造缺失段；含意图 + 节拍防火墙 + 去空话） */
export function formatManhuaEpisodeSegmentPlanBeatsBlock(
  plan: ManhuaEpisodeSegmentPlan | null | undefined,
): string {
  const segs = (plan?.segments || []).slice().sort((a, b) => a.index - b.index);
  if (!segs.length) return "";
  const lines = segs.map((s, idx) => {
    const already = segs
      .slice(0, idx)
      .map((p) => `段${p.index}:${p.intentZh || String(p.dialogueZh || "").slice(0, 24)}`)
      .join("；")
      .slice(0, 280);
    const later = segs
      .slice(idx + 1, idx + 3)
      .map((p) => `段${p.index}:${p.intentZh || "后段冲突"}`)
      .join("；")
      .slice(0, 200);
    const body = stripManhuaPromptSlop(
      [
        `对白：${s.dialogueZh}`,
        `表演：${s.performanceZh}`,
        `场景：${s.sceneZh}｜配色：${s.paletteZh}`,
        `角色：${s.castZh}｜服化道：${s.wardrobePropZh}`,
        `光影运镜：${s.lightingCameraZh}`,
      ].join("\n"),
    );
    return [
      `【段${String(s.index).padStart(2, "0")}·${MANHUA_EPISODE_SEGMENT_DURATION_SEC}s】`,
      compileManhuaDirectedSegmentPrompt({
        segmentIndex: s.index,
        intentZh: s.intentZh,
        thisBeatZh: body,
        alreadyHappenedZh: already,
        reservedForLaterZh: later,
      }),
    ].join("\n");
  });
  return `【已确认十至十二段可拍表·禁止改写成灌水】\n${lines.join("\n\n")}`;
}
