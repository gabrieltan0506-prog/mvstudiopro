/**
 * 图文笔记出图：过滤「创作者技术指导 / 怎么拍怎么发」元内容，
 * 只保留读者可直接收藏的生活攻略节拍。
 */

const META_CREATOR_GUIDANCE_RE =
  /(封面素材|今晚拍|素材包|拆成?\s*\d+\s*页|八页图文|十二格|页码清单|60\s*秒|一分钟视频|同步录|拍摄脚本|分镜|口播|运镜|机位|灯光安排|发布建议|hashtag|话题标签|小红书封面|做成笔记|内容蓝图|落地三步|落地执行|执行细项|如何生成|怎么拍|怎么发|批量生成|出图积分|创作指南|技术指导|可拍结构|可拍画面|同步记录|录视频版|图文笔记拆)/i;

/** 读者向生活笔记应保留；命中创作者元指令则剔除 */
export function isGraphicNoteMetaCreatorGuidance(text: unknown): boolean {
  const s = String(text || "").trim();
  if (!s) return false;
  return META_CREATOR_GUIDANCE_RE.test(s);
}

/** 过滤数组项（actionableSteps 等） */
export function filterGraphicNoteReaderFacingSteps(steps: unknown[] | undefined | null): string[] {
  if (!Array.isArray(steps)) return [];
  return steps
    .map((s) => String(s || "").trim())
    .filter((s) => s.length > 0 && !isGraphicNoteMetaCreatorGuidance(s));
}

/**
 * 从详细脚本里尽量只留 [封面]/[图N] 读者页；去掉创作教学页。
 * 若整段没有页面标记，则按行过滤元指令后返回。
 */
export function focusGraphicNoteReaderScript(detailedScript: unknown): string {
  const full = String(detailedScript || "").trim();
  if (!full) return "";

  const pageBlocks = full.match(/\[(?:封面|图\d+)\][\s\S]*?(?=\[(?:封面|图\d+)\]|$)/g);
  if (pageBlocks?.length) {
    const kept = pageBlocks
      .map((b) => b.trim())
      .filter((b) => !isGraphicNoteMetaCreatorGuidance(b));
    if (kept.length > 0) return kept.join("\n\n").slice(0, 8000);
  }

  return full
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l && !isGraphicNoteMetaCreatorGuidance(l))
    .join("\n")
    .slice(0, 8000);
}

export const GRAPHIC_NOTE_READER_FACING_DIRECTIVE_ZH = `【读者向图文·硬约束】本图是给粉丝直接收藏转发的小红书生活/知识笔记，不是给创作者看的「技术指导手册」。
禁止任何格子出现：如何拍封面、如何拆八页/十二格、如何录60秒、发布建议、话题标签墙、分镜口播、灯光机位、落地执行三步曲、内容生产SOP。
每格只写读者用得上的一点：痛点、误区、场景、关系、节律、可试动作、搜索疑问、评论CTA。
对标正常可发布笔记：封面钩子 → 你是谁/痛点 → 误区 → 场景/关系/节律要点 → 常见问 → 评论领清单；禁止末几格变成「今晚拍素材/拆成八页/同步录视频」。`.trim();
