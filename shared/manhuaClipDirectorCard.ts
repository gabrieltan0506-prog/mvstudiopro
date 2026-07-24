/**
 * 段成片画布卡面摘要：从 clip.prompt 解析秒轴 / @角色 / @场景 / 微表情，
 * 供 FreeformCanvas 正面展示（不依赖侧栏长文）。
 */

export type ManhuaClipDirectorCueRow = {
  startSec: number;
  endSec: number;
  roleLabelZh: string;
  castTags: string[];
  sceneTags: string[];
  microOrActionZh: string;
};

export type ManhuaClipDirectorCardSummary = {
  segmentIndex: number | null;
  durationSec: number | null;
  castTags: string[];
  sceneTags: string[];
  propTags: string[];
  microExpressionZh: string;
  cueRows: ManhuaClipDirectorCueRow[];
};

function uniqTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function tagsOf(re: RegExp, text: string): string[] {
  return uniqTags(Array.from(String(text || "").matchAll(re)).map((m) => m[0]));
}

/** `0–5s：@角色2 抬头，眼眶发红，说「…」。近景微推。` */
const CUE_HEAD_RE =
  /^(\d+(?:\.\d+)?)[–-](\d+(?:\.\d+)?)s[：:](.+?)。\s*([^。\n]{1,40})。?$/;
const CUE_PIPE_RE = /^(\d+(?:\.\d+)?)[–-](\d+(?:\.\d+)?)s[｜|]/;

/** 从成片 prompt 抽出卡面可读摘要 */
export function parseManhuaClipDirectorCardSummary(
  prompt: string | null | undefined,
): ManhuaClipDirectorCardSummary {
  const raw = String(prompt || "");
  const seg =
    raw.match(/【第\s*(\d+)\s*段·(\d+(?:\.\d+)?)s】/) ||
    raw.match(/【第\s*(\d+)\s*段·约\d+(?:\.\d+)?s】/) ||
    raw.match(/【第\s*(\d+)\s*段·成片】/) ||
    raw.match(/【按秒导戏单·第0*(\d+)段/) ||
    raw.match(/【视频生成导戏单·第(\d+)段/);
  const dur =
    raw.match(/【第\s*\d+\s*段·(\d+(?:\.\d+)?)s】/) ||
    raw.match(/【第\s*\d+\s*段·约(\d+(?:\.\d+)?)s】/) ||
    raw.match(/目标时长：约\s*(\d+(?:\.\d+)?)\s*秒/) ||
    raw.match(/本段一条成片约\s*(\d+(?:\.\d+)?)\s*秒/) ||
    raw.match(/【按秒导戏单·第\d+段·(\d+)s】/);

  const castTags = tagsOf(/@角色\d+/g, raw);
  const sceneTags = tagsOf(/@场景\d+/g, raw);
  const propTags = tagsOf(/@道具\d+/g, raw);

  const microFromLock =
    raw.match(/微表情[=：:]\s*([^｜|\n」]{2,40})/)?.[1] ||
    raw.match(/眼眶发红|下颌绷紧|咬下唇|咬牙|泪未落/)?.[0] ||
    "";

  const cueRows: ManhuaClipDirectorCueRow[] = [];
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length && cueRows.length < 6; i++) {
    const line = String(lines[i] || "").trim();
    const head = CUE_HEAD_RE.exec(line);
    if (head) {
      const body = String(head[3] || "");
      const cam = String(head[4] || "").trim();
      cueRows.push({
        startSec: Number(head[1]),
        endSec: Number(head[2]),
        roleLabelZh: cam.slice(0, 12) || "运镜",
        castTags: tagsOf(/@角色\d+/g, body),
        sceneTags: tagsOf(/@场景\d+/g, body),
        microOrActionZh: String(
          body.match(/「([^」]{1,20})」/)?.[1] ||
            body.replace(/@角色\d+/g, "").replace(/说$/, "").trim() ||
            "节拍",
        )
          .trim()
          .slice(0, 28),
      });
      continue;
    }
    if (!CUE_PIPE_RE.test(line)) continue;
    const pipe = CUE_PIPE_RE.exec(line)!;
    cueRows.push({
      startSec: Number(pipe[1]),
      endSec: Number(pipe[2]),
      roleLabelZh: "运镜",
      castTags: tagsOf(/@角色\d+/g, line),
      sceneTags: tagsOf(/@场景\d+/g, line),
      microOrActionZh: String(line.match(/「([^」]{1,20})」/)?.[1] || "节拍")
        .trim()
        .slice(0, 28),
    });
  }

  // 导戏单「分镜N｜…｜约0–4s」回退（头行 + 后续缩进/对白行一并取 @角色）
  if (!cueRows.length) {
    const shotHeadRe =
      /^分镜(\d+)[｜|][^｜\n]*[｜|][^｜\n]*[｜|]约(\d+(?:\.\d+)?)[–-](\d+(?:\.\d+)?)s[^\n]*$/;
    for (let i = 0; i < lines.length && cueRows.length < 6; i++) {
      const head = shotHeadRe.exec(String(lines[i] || "").trim());
      if (!head) continue;
      const chunk: string[] = [lines[i]!];
      let j = i + 1;
      while (j < lines.length) {
        const ln = lines[j]!;
        if (shotHeadRe.test(ln.trim()) || /^【/.test(ln.trim())) break;
        if (
          /^\s/.test(ln) ||
          /^(说话人|对白|动作|场面|微表情|情绪|光影|交接)/.test(ln.trim())
        ) {
          chunk.push(ln);
          j++;
          continue;
        }
        break;
      }
      i = j - 1;
      const blob = chunk.join("\n");
      cueRows.push({
        startSec: Number(head[2]),
        endSec: Number(head[3]),
        roleLabelZh: `镜${head[1]}`,
        castTags: tagsOf(/@角色\d+/g, blob),
        sceneTags: tagsOf(/@场景\d+/g, blob),
        microOrActionZh: (
          blob.match(/微表情差[：:]\s*([^｜|\n]{2,28})/)?.[1] ||
          blob.match(/场面动作[：:]\s*([^｜|\n]{2,28})/)?.[1] ||
          blob.match(/对白[^：\n]*[：:][^\n「]*「([^」]{1,20})/)?.[1] ||
          ""
        ).slice(0, 28),
      });
    }
  }

  return {
    segmentIndex: seg?.[1] ? Math.max(1, parseInt(seg[1], 10)) : null,
    durationSec: dur?.[1] ? Math.round(Number(dur[1]) * 10) / 10 : null,
    castTags,
    sceneTags,
    propTags,
    microExpressionZh: String(microFromLock || "").trim().slice(0, 40),
    cueRows,
  };
}

/** 卡面一行秒轴文案 */
export function formatManhuaClipDirectorCueFaceLine(row: ManhuaClipDirectorCueRow): string {
  const cast = row.castTags.slice(0, 2).join(" ") || "";
  const scene = row.sceneTags[0] || "";
  const who = [cast, scene].filter(Boolean).join(" · ");
  const body = row.microOrActionZh || row.roleLabelZh || "节拍";
  return `${row.startSec}–${row.endSec}s  ${who ? `${who}  ` : ""}${body}`.trim();
}
