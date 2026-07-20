/**
 * 剧本工作台：从工厂节点文本推导「片段内多镜」列表，供批量静帧与成片对齐。
 */

export type ManhuaWorkbenchShot = {
  index: number;
  durationSec: number;
  cameraZh: string;
  actionZh: string;
};

const DEFAULT_CAMERAS = [
  "全景，平视，缓慢推近",
  "中景，固定机位，三分构图",
  "中近景，轻微横移",
  "特写，平视，微推",
];

const CAMERA_TOKENS =
  "远景|大远景|全景|中全景|中景|中近景|近景|特写|大特写|过肩|双人镜头|双人镜";

export const MANHUA_SINGLE_CLIP_DURATION_SEC = 10;

/** 成片前按镜静帧上限（成本与编排平衡） */
export const MANHUA_SHOT_KEYART_MAX = 4;

function looksLikeEnglishMotionOnly(line: string): boolean {
  const t = String(line || "").trim();
  if (!t) return true;
  if (/[\u4e00-\u9fff]/.test(t)) return false;
  return /^(slow|push|pan|orbit|dolly|zoom|handheld|locked|whip|soft|cinematic|camera)\b/i.test(
    t,
  );
}

function splitCameraAndAction(rawBody: string): { cameraZh: string; actionZh: string } {
  const body = String(rawBody || "").trim();
  const m = body.match(
    new RegExp(`^(${CAMERA_TOKENS})\\s*[，,：:\\-|/]\\s*(.+)$`, "i"),
  );
  if (m?.[1] && m[2]) {
    return { cameraZh: m[1].trim(), actionZh: m[2].trim() };
  }
  const m2 = body.match(new RegExp(`^(${CAMERA_TOKENS})\\s+(.+)$`, "i"));
  if (m2?.[1] && m2[2] && m2[2].length > 2) {
    return { cameraZh: m2[1].trim(), actionZh: m2[2].trim() };
  }
  return { cameraZh: "", actionZh: body };
}

function extractStoryboardSection(text: string): string {
  const board = text.match(/##\s*分镜表\s*\n+([\s\S]*?)(?=\n##\s|\n*$)/i);
  if (board?.[1]?.trim()) return board[1].trim();
  const beats = text.match(/##\s*(?:镜头节拍|节拍表|分镜)\s*\n+([\s\S]*?)(?=\n##\s|\n*$)/i);
  if (beats?.[1]?.trim()) return beats[1].trim();
  return text;
}

type ParsedShotRow = { index: number; cameraZh: string; actionZh: string };

function parseShotRowsFromText(raw: string): ParsedShotRow[] {
  const section = extractStoryboardSection(String(raw || "").trim());
  if (!section) return [];

  const lines = section
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const byIndex = new Map<number, ParsedShotRow>();

  for (const line of lines) {
    if (/^\|?\s*[-:| ]+\s*\|?\s*$/.test(line)) continue;
    if (/镜号|景别|内容|镜头/.test(line) && /\|\s*镜|\|\s*景|\|\s*内/.test(line)) continue;

    // Markdown 表：| 1 | 近景 | 女主推门 |
    const table = line.match(
      /^\|\s*(\d{1,2})\s*\|\s*([^|]*)\|\s*(.+?)\s*\|?\s*$/,
    );
    if (table?.[1] && table[3]) {
      const index = Math.max(1, parseInt(table[1], 10));
      const cameraCell = String(table[2] || "").trim();
      const actionCell = String(table[3] || "").trim();
      if (looksLikeEnglishMotionOnly(actionCell)) continue;
      const split = splitCameraAndAction(
        cameraCell && actionCell ? `${cameraCell}：${actionCell}` : actionCell || cameraCell,
      );
      byIndex.set(index, {
        index,
        cameraZh: split.cameraZh || cameraCell || "",
        actionZh: split.actionZh || actionCell,
      });
      continue;
    }

    const numbered = line.match(
      /^(?:[-*•]\s*)?(?:分镜|镜头|节拍|Shot|SHOT)?\s*(\d{1,2})\s*[:：、.\)\]】]\s*(.+)$/i,
    );
    if (numbered?.[1] && numbered[2]) {
      const index = Math.max(1, parseInt(numbered[1], 10));
      const body = numbered[2].trim();
      if (looksLikeEnglishMotionOnly(body)) continue;
      if (body.length < 2) continue;
      const split = splitCameraAndAction(body);
      byIndex.set(index, {
        index,
        cameraZh: split.cameraZh,
        actionZh: split.actionZh,
      });
    }
  }

  return Array.from(byIndex.values())
    .sort((a, b) => a.index - b.index)
    .slice(0, MANHUA_SHOT_KEYART_MAX);
}

/** 从节拍 / 反推正文拆出多镜；失败则回落为 4 镜骨架（单次合计 10s） */
export function parseWorkbenchShotsFromText(raw: string | undefined | null): ManhuaWorkbenchShot[] {
  const text = String(raw || "").trim();
  if (!text) return defaultWorkbenchShots();

  const rows = parseShotRowsFromText(text);
  if (rows.length < 2) return defaultWorkbenchShots(text.slice(0, 180));

  // 重新编号为 1..n，保证与 keyart-s01 连续对齐（表中空洞镜号折叠）
  const durations = splitDurations(MANHUA_SINGLE_CLIP_DURATION_SEC, rows.length);
  return rows.map((row, i) => ({
    index: i + 1,
    durationSec: durations[i]!,
    cameraZh: row.cameraZh || DEFAULT_CAMERAS[i % DEFAULT_CAMERAS.length]!,
    actionZh: row.actionZh.slice(0, 220),
  }));
}

export function defaultWorkbenchShots(seedAction?: string): ManhuaWorkbenchShot[] {
  const base = String(seedAction || "").trim();
  const actions = base
    ? [
        `开场交代：${base.slice(0, 80)}`,
        "人物进场，情绪与关系落点",
        "冲突或信息转折",
        "钩子收束，留未解悬念",
      ]
    : [
        "开场建立场景与人物位置",
        "人物互动，推进本集主冲突",
        "情绪/信息转折点",
        "集末钩子，引导下一集",
      ];
  const durations = splitDurations(MANHUA_SINGLE_CLIP_DURATION_SEC, actions.length);
  return actions.map((actionZh, i) => ({
    index: i + 1,
    durationSec: durations[i]!,
    cameraZh: DEFAULT_CAMERAS[i % DEFAULT_CAMERAS.length]!,
    actionZh,
  }));
}

function splitDurations(totalSec: number, n: number): number[] {
  if (n <= 0) return [];
  if (n === 1) return [totalSec];
  const base = Math.floor((totalSec * 10) / n) / 10;
  const out = Array.from({ length: n }, () => base);
  let sum = out.reduce((a, b) => a + b, 0);
  out[out.length - 1] = Math.round((out[out.length - 1]! + (totalSec - sum)) * 10) / 10;
  return out;
}

export function workbenchShotTotalSec(shots: ManhuaWorkbenchShot[]): number {
  return Math.round(shots.reduce((s, x) => s + x.durationSec, 0) * 10) / 10;
}

/** 从场面文案推断同框人数（用于静帧硬锁） */
export function inferWorkbenchShotCastCount(actionZh: string): number {
  const t = String(actionZh || "");
  if (/群像|众人|一群|多名|围观|弟子们/.test(t)) return 3;
  if (/三人|三人对/.test(t)) return 3;
  if (
    /两人|双人|男女|对视|对峙|交锋|对决|递.+给|并肩|同框|并肩而立|主仆|夫妻|母女|父子|兄妹|姐妹|师徒|宾主|一旁/.test(
      t,
    )
  ) {
    return 2;
  }
  return 1;
}

/** 静帧禁字：避免设定卡/字幕污染后续质检（中文硬锁，写入 keyart prompt） */
export const MANHUA_KEYART_NO_TEXT_LOCK =
  "禁字硬锁：画面必须是纯视觉电影静帧，零可读文字。禁止字幕、对白气泡、旁白条、水印、Logo、姓名条、设定卡多格、UI 文案、标题大字、镜号数字、印章题跋；对白/旁白只作表演依据，绝不能烧进画面；工牌/手机/文件/霓虹仅几何光斑或完全模糊不可辨认字形。";

/** 生图最终英文提示词追加（模型对英文 negative 更听话） */
export const MANHUA_KEYART_NO_TEXT_EN =
  "STRICT NO TEXT: pure cinematic still only. Zero readable letters, Chinese characters, numbers, subtitles, captions, speech bubbles, logos, watermarks, nameplates, UI panels, title cards, or signage glyphs. Any dialogue is acting direction only — never painted on the image. Screens/badges/papers = blank glow or illegible blur only.";

/** 写入静帧 prompt：本镜场面必须带场景/道具/服装配合 */
export function formatWorkbenchShotInjectBlock(shot: ManhuaWorkbenchShot): string {
  const camera = String(shot.cameraZh || "").trim();
  const action = String(shot.actionZh || "").trim();
  const framingLock = /全景|远景/.test(camera)
    ? "景别硬锁：全景/远景；人物必须全身入画，并清楚展示环境纵深与人物空间关系，禁止裁到腰部或大腿。"
    : /中近景/.test(camera)
      ? "景别硬锁：中近景；主体以胸部以上为主，保留动作方向，禁止退回普通半身中景。"
      : /特写|大特写/.test(camera)
        ? "景别硬锁：特写；面部表情或关键道具必须占画面主体，禁止生成半身或全身中景。"
        : /中景|中全景/.test(camera)
          ? "景别硬锁：中景；人物动作与关系清楚可读；若指定三分构图，主体必须落在三分线交点，禁止中心对称海报构图。"
          : /近景/.test(camera)
            ? "景别硬锁：近景；肩部以上为主，表情与视线方向可读。"
            : /双人/.test(camera)
              ? "景别硬锁：双人镜头；两人同框、关系轴线清楚，禁止裁成单人肖像。"
              : "";
  const castCount = inferWorkbenchShotCastCount(shot.actionZh);
  const castLock =
    castCount >= 3
      ? "人数硬锁：本镜为群像/多人场面，须同框出现三位及以上可读人物，禁止只画单人半身定妆像。"
      : castCount >= 2
        ? "人数硬锁：本镜为双人/关系场面，须同框出现至少两名身份可辨的人物（含对视、对峙、递接、并肩），禁止只保留单人肖像或单人特写糊弄。"
        : "人数提示：若分镜动作涉及第二人，必须同框画出，不得省略成单人空镜肖像。";
  const sceneShiftHint = /切到|转场|外景|内景|门外|窗|殿|庙|街|台/.test(action)
    ? "场景变换：若动作含空间跳转，画面须交代前后景或门窗过渡，禁止无因跳切空棚。"
    : "";
  return [
    `【分镜 ${shot.index}·静帧】`,
    camera ? `运镜（镜头运动，勿与人物动作混写）：${camera}` : "运镜：承接上镜构图做可读微动",
    framingLock,
    action ? `动作轨迹（主体肢体/身体移位，须有方向与起止）：${action}` : "动作轨迹：落实本镜关键表演",
    sceneShiftHint,
    castLock,
    "光线硬锁：必须落实本镜动作描述中的具体光向、冷暖与明暗关系；禁止套用统一的暖背景加轮廓光模板。",
    "必须画出本镜人物、场景与点选道具的配合；服装连续与题材时代一致；禁止空镜或错时代穿戴。",
    "对白硬锁：若动作描述含对白/旁白，只表现为口型、表情与肢体，禁止任何字形出现在画面中。",
    MANHUA_KEYART_NO_TEXT_LOCK,
  ]
    .filter(Boolean)
    .join("\n");
}

/** 写入片段成片 prompt：强制本镜事件，时长对齐分镜秒数 */
export function formatWorkbenchClipInjectBlock(shot: ManhuaWorkbenchShot): string {
  const dur =
    typeof shot.durationSec === "number" && shot.durationSec > 0
      ? Math.round(shot.durationSec * 10) / 10
      : 2.5;
  const action = String(shot.actionZh || "").trim() || "落实本镜节拍中的关键动作与道具交互";
  const camera = String(shot.cameraZh || "").trim() || "承接首镜构图做可读微动";
  return [
    `【分镜 ${shot.index}·片段成片】`,
    `目标时长：约 ${dur} 秒（允许 ±0.8 秒）；勿按整集 10 秒要求本镜。`,
    `动作轨迹（主体肢体/身体移位）：${action}`,
    `运镜（镜头运动，与动作分行执行）：${camera}`,
    "禁止只做空镜走路或纯运镜展示；须出现本镜关键动作、道具交互或人物关系变化中的至少一项。",
    "承接首镜人物身份与服装，不新增无关角色；成片画面无新增可读字幕。",
  ].join("\n");
}

/** 从 keyart / clip 节点 id 或静帧 prompt 解析分镜号（默认 1） */
export function resolveKeyartShotIndex(blockId: string, prompt?: string | null): number {
  const fromId = String(blockId || "").match(/-s(\d{2})(?:-|$)/);
  if (fromId?.[1]) return Math.max(1, parseInt(fromId[1], 10));
  const fromPrompt = String(prompt || "").match(/【分镜\s*(\d+)/);
  if (fromPrompt?.[1]) return Math.max(1, parseInt(fromPrompt[1], 10));
  // 无镜号后缀的本集主 keyart/clip 视为第 1 镜
  if (/^(keyart|clip)-e\d{2}-/i.test(String(blockId || ""))) return 1;
  if (/^(keyart|clip)-[a-z0-9]+$/i.test(String(blockId || ""))) return 1;
  return 1;
}

/** 片段成片 id 与静帧共用镜号解析 */
export const resolveClipShotIndex = resolveKeyartShotIndex;

export type WorkbenchShotAssetMount = {
  /** matched=分镜文案点名；default=回落本集全套 */
  mode: "matched" | "default";
  characterIds: string[];
  ancientArchetypeIds: string[];
  propIds: string[];
  expectedCastCount: number;
};

/**
 * 按当前片段文案推断左栏「本片段挂载」：点名角色/道具优先；点不到则回落本集资产。
 */
export function resolveWorkbenchShotAssetMount(input: {
  actionZh?: string | null;
  cameraZh?: string | null;
  keyartPrompt?: string | null;
  characters: Array<{ id: string; nameZh: string }>;
  archetypes?: Array<{ id: string; nameZh: string }>;
  props?: Array<{ id: string; nameZh: string }>;
}): WorkbenchShotAssetMount {
  const hay = [
    String(input.actionZh || ""),
    String(input.cameraZh || ""),
    String(input.keyartPrompt || ""),
  ]
    .join("\n")
    .trim();
  const expectedCastCount = inferWorkbenchShotCastCount(input.actionZh || "");
  const characters = input.characters || [];
  const archetypes = input.archetypes || [];
  const props = input.props || [];

  const hitChar = characters
    .filter((c) => c.nameZh && c.nameZh.length >= 2 && hay.includes(c.nameZh))
    .map((c) => c.id);
  const hitArch = archetypes
    .filter((a) => a.nameZh && a.nameZh.length >= 2 && hay.includes(a.nameZh))
    .map((a) => a.id);
  const hitProp = props
    .filter((p) => p.nameZh && p.nameZh.length >= 2 && hay.includes(p.nameZh))
    .map((p) => p.id);

  // 角色名未点到时，用 女主/男主 等角色词做软匹配（按库序取前 N）
  let softChar = hitChar;
  let softArch = hitArch;
  if (!softChar.length && !softArch.length && hay) {
    const want = Math.max(1, expectedCastCount);
    if (/女主|男主|男女|双人|两人|对视|对峙/.test(hay)) {
      softChar = characters.slice(0, Math.min(want, characters.length)).map((c) => c.id);
      if (softChar.length < want) {
        softArch = archetypes
          .slice(0, Math.min(want - softChar.length, archetypes.length))
          .map((a) => a.id);
      }
    }
  }

  const matched = softChar.length + softArch.length > 0 || hitProp.length > 0;
  if (!matched) {
    return {
      mode: "default",
      characterIds: characters.map((c) => c.id),
      ancientArchetypeIds: archetypes.map((a) => a.id),
      propIds: props.map((p) => p.id),
      expectedCastCount,
    };
  }

  return {
    mode: "matched",
    characterIds: softChar.length ? softChar : characters.map((c) => c.id),
    ancientArchetypeIds: softArch,
    propIds: hitProp.length ? hitProp : props.map((p) => p.id),
    expectedCastCount,
  };
}
