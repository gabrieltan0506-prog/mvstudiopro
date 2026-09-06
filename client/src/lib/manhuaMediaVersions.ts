/**
 * 合并媒体版本并去重。最新结果始终在首位，既有成片保留用于 A/B 与撤销。
 * 只接受可播放的 http(s) 地址，避免把空值或本地临时指针写进云草稿。
 */
export function mergeManhuaMediaVersions(
  newest: readonly (string | null | undefined)[],
  previous: readonly (string | null | undefined)[]
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of [...newest, ...previous]) {
    const url = String(value || "").trim();
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

const VIDEO_EDIT_SECTION_RE = /\n*【视频编辑指令】[^\n]*(?:\n|$)/g;

/** 只识别工厂已经明确准备的局部编辑，不改变其他生成模式。 */
export function isManhuaVideoEditBlock(
  block:
    | {
        id: string;
        kind: string;
        videoModel?: string;
        seedance25WorkMode?: string;
      }
    | null
    | undefined
): boolean {
  return Boolean(
    block?.id.startsWith("clip-") &&
      block.kind === "video" &&
      block.videoModel === "seedance-2.5" &&
      block.seedance25WorkMode === "video_edit"
  );
}

/** 节点留原生成稿溯源；编辑出站只取本次明确指令，不注入旧剧情与生成手法。 */
export function compileManhuaVideoEditPrompt(
  prompt: string | null | undefined
): string {
  const matches = Array.from(
    String(prompt || "").matchAll(/(?:^|\n)【视频编辑指令】([^\n]*)/g)
  );
  const instruction = String(matches[matches.length - 1]?.[1] || "").trim();
  if (!instruction)
    throw new Error("请先填写本次视频编辑要求，不要把原生成稿当作编辑要求");
  return [
    "编辑 @视频1；它是本次待修改的原片，不是续拍参考。",
    `修改要求：${instruction}`,
    "生效范围：遵循修改要求指定的对象、区域和时段；未指定时段时仅修改该对象在原片中的对应部分。",
    "保留：除明确要求修改的部分外，保留原片的人物身份、服装、动作时序、构图、运镜、光影、对白、口型、环境声与音效；不重演剧情，不延长原片。",
    "补全：修改处保持原片透视、光照、遮挡和接触关系，未涉及的区域与时段保持不变。",
  ].join("\n");
}

/** 切回生成／重拍时清除一次性编辑模式和原片绑定，历史产物原样保留。 */
export function clearManhuaVideoEditOperation<
  T extends {
    id: string;
    kind: string;
    videoModel?: string;
    seedance25WorkMode?: string;
    prompt: string;
    refVideoUrl?: string;
    seedance25RefVideoUrls?: string[];
  },
>(block: T): T {
  if (!isManhuaVideoEditBlock(block)) return block;
  return {
    ...block,
    prompt: applyManhuaVideoEditInstruction(block.prompt, ""),
    seedance25WorkMode: undefined,
    refVideoUrl: undefined,
    seedance25RefVideoUrls: [],
  };
}

/** 在保留原导演提示词的前提下，仅替换一条有界的视频编辑指令。 */
export function applyManhuaVideoEditInstruction(
  prompt: string | null | undefined,
  instructionZh: string
): string {
  const base = String(prompt || "")
    .replace(VIDEO_EDIT_SECTION_RE, "\n")
    .trim();
  const instruction = String(instructionZh || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
  if (!instruction) return base;
  return `${base}\n\n【视频编辑指令】${instruction}`.trim();
}
