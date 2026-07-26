/**
 * 后期剪辑手法 → 出片提示词的隐藏一层。
 *
 * 四条口径：切点卡情绪不卡秒、同场景景别要有反差、转场只在换场景用、音效补流畅度。
 * 这些是「怎么剪」的施工要求，不是「演什么」。逐条铺在审阅面上会把秒轴淹掉——
 * 人在那一栏要读的是谁在做什么、说什么。所以只在出片这一刻拼进提示词，
 * 不写回节点：审阅面、节点存稿、历史解析全都当它不存在。
 *
 * 按段内实际情况裁剪，不当常量墙灌：单镜段不讲切镜，无台词段不讲台词落点，
 * 相邻景别已经拉开时就不再啰嗦。
 */

const EDIT_CRAFT_MARK = "【剪辑手法】";

/**
 * 景别按「视野从窄到宽」排序，序号即跨度刻度。
 * 判「反差够不够」靠相邻序号差，不靠字面是否相同：
 * 「近景 → 中近景」字面不同但跨度只有 1，剪出来照样像原地踏步。
 */
const SHOT_SIZE_SCALE: Array<[string, number]> = [
  ["大特写", 0],
  ["特写", 1],
  ["中近景", 2],
  ["近景", 2],
  ["中景", 3],
  ["中全景", 4],
  ["全景", 5],
  ["大远景", 7],
  ["远景", 6],
];

/** 相邻镜头景别跨度至少要到这个数，才算「拉开了」 */
export const MANHUA_SHOT_SIZE_CONTRAST_MIN = 2;

/**
 * 段内点名的景别序列（按出现顺序）。
 *
 * 长词优先匹配：先扫到「大特写」就不能再被「特写」重复吃一遍，
 * 否则「大特写」会算成两镜、跨度判断跟着错。
 */
export function readManhuaShotSizeSequence(
  prompt: string | null | undefined,
): Array<{ nameZh: string; scale: number }> {
  const text = String(prompt || "");
  const byLongest = [...SHOT_SIZE_SCALE].sort((a, b) => b[0].length - a[0].length);
  const hits: Array<{ at: number; nameZh: string; scale: number }> = [];
  const taken: Array<[number, number]> = [];
  for (const [nameZh, scale] of byLongest) {
    let from = 0;
    for (;;) {
      const at = text.indexOf(nameZh, from);
      if (at < 0) break;
      from = at + nameZh.length;
      // 已被更长的景别词占掉的区间不再重复计
      if (taken.some(([s, e]) => at >= s && at < e)) continue;
      taken.push([at, at + nameZh.length]);
      hits.push({ at, nameZh, scale });
    }
  }
  return hits.sort((a, b) => a.at - b.at).map(({ nameZh, scale }) => ({ nameZh, scale }));
}

/** 相邻两镜景别跨度不足的第一处；没有则 null */
export function findManhuaFlatShotSizeRun(
  seq: Array<{ nameZh: string; scale: number }>,
): { fromZh: string; toZh: string } | null {
  for (let i = 1; i < seq.length; i++) {
    const prev = seq[i - 1]!;
    const cur = seq[i]!;
    if (Math.abs(cur.scale - prev.scale) < MANHUA_SHOT_SIZE_CONTRAST_MIN) {
      return { fromZh: prev.nameZh, toZh: cur.nameZh };
    }
  }
  return null;
}

/** 段里有人说话：台词落点那条才有意义 */
function hasDialogue(prompt: string): boolean {
  return /[「{][^」}\n]{1,200}[」}]/.test(prompt) || /说[：:「]/.test(prompt);
}

/**
 * 拼出这一段该讲的剪辑手法。返回空串表示没什么可讲（例如单镜无台词的纯空镜）。
 */
export function formatManhuaEditCraftDirectives(input: {
  prompt: string | null | undefined;
  /**
   * 本段分镜数。段内只有一镜时讲切点与景别反差都是空话，
   * 反而会诱导模型自己加一刀。
   */
  shotCount?: number;
  /** 本段跨了场景（罕见）：这时才允许短转场 */
  crossScene?: boolean;
}): string {
  const prompt = String(input.prompt || "");
  if (!prompt.trim()) return "";
  const seq = readManhuaShotSizeSequence(prompt);
  // 分镜数没传就按景别点名数估；两者都拿不到时按单镜处理
  const shots = Math.max(input.shotCount ?? 0, seq.length);
  const multiShot = shots > 1;

  const lines: string[] = [];

  if (multiShot) {
    const cutBits = [
      "切点卡情绪不卡秒",
      hasDialogue(prompt)
        ? "关键台词落地后停约 0.2 秒再切，禁止台词未说完就硬切（会像断片）"
        : "在情绪转折处切，不在动作中段切",
      "拔剑/转身/出拳这类动作，切在发力那一帧",
    ];
    lines.push(`${cutBits.join("；")}。`);

    const flat = findManhuaFlatShotSizeRun(seq);
    lines.push(
      flat
        ? `同场景相邻镜头必须拉开景别反差：现在「${flat.fromZh}→${flat.toZh}」跨度太小，改成中景→特写→全景这类大跨度，否则节奏像原地踏步。`
        : "同场景相邻镜头保持景别反差（中景→特写→全景），忌连续两镜景别相近。",
    );
  }

  lines.push(
    input.crossScene
      ? "换场景处用 0.3–0.5 秒叠化或淡入淡出；禁止闪白、旋转、拉扯这类花哨特效。"
      : "本段同一场景内一律直切，禁止转场特效（闪白、旋转、拉扯、叠化都不要）。",
  );

  lines.push(
    "声音补流畅度：人物走动补轻微脚步声，切到全景抬高环境底噪，换场景缝隙用关门/风声一类过渡音效盖住，紧张与爆发处给轻微情绪音效；不要配乐压过人声。",
  );

  return [EDIT_CRAFT_MARK, ...lines].join("\n");
}
