/**
 * 选题单帧封面管线：将 `imageGenFlowLog` 拆成 **DR-Pro（0.5）**、**英文化**、**生图（GPT-IMAGE-2 / NB2 / 兜底）**，
 * 供 Platform Debug 对照全链路（避免生图阶段只在折叠「其余」里以为卡住）。
 */

export type TopicCoverPipelinePartitionHints = {
  /** 服务端写入的 `[管线·阶段顺序]`（有则表示后端已打阶段分界标记） */
  phaseOrderLine?: string;
  /** 曾出现 Interactions create / poll（代表至少打到 DR Pro API） */
  drProApiActivity: boolean;
  /** 简报锚定通过并合并（`完成 · 简报长`） */
  drProBriefMerged: boolean;
  /** 略过 DR（金钥未设、create 失败、锚定失败等会写入 0.5 行） */
  drProSkippedOrEmpty: boolean;
  /** GPT 5.4 / Flash 翻译层有日志 */
  gpt54LayerActivity: boolean;
  /** 步骤1 英文化已完成字样 */
  step1TranslationDone: boolean;
  /** 步骤2/3 生图子日志（GPT-IMAGE-2、NB2、fal 等） */
  imageGenLayerActivity: boolean;
  /** 单条任务已成功取得 URL（服务端 ✓ 行） */
  imageGenSuccess: boolean;
};

export type TopicCoverPipelinePartition = {
  drProLines: string[];
  gpt54AndTranslationLines: string[];
  /** GPT-IMAGE-2 / Vertex NB2 / fal / 兜底等 */
  imageGenLines: string[];
  otherLines: string[];
  hints: TopicCoverPipelinePartitionHints;
};

function lineMatchesDrPro(s: string): boolean {
  return (
    /步骤0\.5·DR-Pro|\[步骤0\.5[·\]]/i.test(s) ||
    /cover_dr_pro/i.test(s) ||
    (/\[DeepResearch Pro/i.test(s) && /优化/.test(s))
  );
}

function lineMatchesGpt54Layer(s: string): boolean {
  return (
    /\[GPT54|GPT54·|\[步骤1\]|\[步骤1b\]|Vertex·Flash|骨架·中文视觉|extractChineseVisualBrief|\[语境\]|调用 GPT 5\.4|GPT 5\.4（OpenAI）|\[\s*统计\s*\]\s*translated=/.test(
      s,
    ) ||
    /\[2×4·步骤1|2×4·步骤1b|translatePlatformComposite|\[GPT54·英文化\]|\[套装·并翻\]/.test(s)
  );
}

/** 生图与其前置衔接（勿与 Vertex·Flash 英文化混淆） */
function lineMatchesImageGenLayer(s: string): boolean {
  return (
    /\[步骤2\]|\[步骤2-NB2\]|\[步骤3[ab]?\]|\[步骤1\/2\]/.test(s) ||
    /\[步骤3/.test(s) ||
    /\[GPT-IMAGE-2\]|FAL·GPT-IMAGE-2|OhMyGPT|像素锁|生图|生图/.test(s) ||
    /Nano Banana|\bNB2\b|Vertex Nano|nbpImage|platform_topic_reference/.test(s) ||
    /\[2×4·步骤(2|2b|3)\b|宽?幅.*GPT-IMAGE|2×4.*提炼完成/.test(s)
  );
}

export function partitionTopicCoverPipelineFlowLog(lines: string[]): TopicCoverPipelinePartition {
  const drProLines: string[] = [];
  const gpt54AndTranslationLines: string[] = [];
  const imageGenLines: string[] = [];
  const otherLines: string[] = [];
  let phaseOrderLine: string | undefined;

  for (const raw of lines) {
    const s = String(raw);
    if (/\[管线·阶段顺序\]|\[管线·阶段顺序·2×4\]/.test(s)) {
      phaseOrderLine = s;
      otherLines.push(s);
      continue;
    }
    if (lineMatchesDrPro(s)) {
      drProLines.push(s);
      continue;
    }
    if (lineMatchesGpt54Layer(s)) {
      gpt54AndTranslationLines.push(s);
      continue;
    }
    if (lineMatchesImageGenLayer(s)) {
      imageGenLines.push(s);
      continue;
    }
    otherLines.push(s);
  }

  const joinedDr = drProLines.join("\n");
  const joinedImg = imageGenLines.join("\n");
  const drProBriefMerged = /完成 · 简报长=/.test(joinedDr);
  const hints: TopicCoverPipelinePartitionHints = {
    phaseOrderLine,
    drProApiActivity: /interaction=|进入轮询|polling · elapsed|create HTTP/i.test(joinedDr),
    drProBriefMerged,
    drProSkippedOrEmpty:
      !drProBriefMerged &&
      (/跳过：`GEMINI_API_KEY`/.test(joinedDr) ||
        /create HTTP|正文过短|舍弃：与当前选题/.test(joinedDr) ||
        /\[步骤0\.5\] 异常/.test(joinedDr)),
    gpt54LayerActivity: gpt54AndTranslationLines.length > 0,
    step1TranslationDone:
      /\[步骤1\] 完成 · 英文 prompt|\[2×4·步骤1·完成\]/.test(gpt54AndTranslationLines.join("\n")),
    imageGenLayerActivity: imageGenLines.length > 0,
    imageGenSuccess: /✓ 本条结束：已得到 imageUrl|尺寸 \d+x\d+ 成功|\[GPT-IMAGE-2\].*成功/.test(joinedImg),
  };

  return { drProLines, gpt54AndTranslationLines, imageGenLines, otherLines, hints };
}
