/**
 * 選題單幀封面管線：將 `imageGenFlowLog` 拆成 **DR-Pro（0.5）**、**英文化**、**生圖（GPT-IMAGE-2 / NB2 / 兜底）**，
 * 供 Platform Debug 對照全鏈路（避免生圖階段只在摺疊「其餘」裡以為卡住）。
 */

export type TopicCoverPipelinePartitionHints = {
  /** 服務端寫入的 `[管线·阶段顺序]`（有則表示後端已打階段分界標記） */
  phaseOrderLine?: string;
  /** 曾出現 Interactions create / poll（代表至少打到 DR Pro API） */
  drProApiActivity: boolean;
  /** 簡報錨定通過並合併（`完成 · 简报長`） */
  drProBriefMerged: boolean;
  /** 略過 DR（金鑰未設、create 失敗、錨定失敗等會寫入 0.5 行） */
  drProSkippedOrEmpty: boolean;
  /** GPT 5.4 / Flash 翻譯層有日誌 */
  gpt54LayerActivity: boolean;
  /** 步驟1 英文化已完成字樣 */
  step1TranslationDone: boolean;
  /** 步驟2/3 生圖子日誌（GPT-IMAGE-2、NB2、fal 等） */
  imageGenLayerActivity: boolean;
  /** 單條任務已成功取得 URL（服務端 ✓ 行） */
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
    /\[2×4·步骤1|2×4·步骤1b|translatePlatformComposite|\[GPT54·英文化\]|\[套裝·併翻\]/.test(s)
  );
}

/** 生圖與其前置銜接（勿與 Vertex·Flash 英文化混淆） */
function lineMatchesImageGenLayer(s: string): boolean {
  return (
    /\[步骤2\]|\[步骤2-NB2\]|\[步骤3[ab]?\]|\[步骤1\/2\]/.test(s) ||
    /\[步骤3/.test(s) ||
    /\[GPT-IMAGE-2\]|FAL·GPT-IMAGE-2|OhMyGPT|像素锁|生图|生圖/.test(s) ||
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
  const drProBriefMerged = /完成 · 简报長=/.test(joinedDr);
  const hints: TopicCoverPipelinePartitionHints = {
    phaseOrderLine,
    drProApiActivity: /interaction=|進入輪詢|polling · elapsed|create HTTP/i.test(joinedDr),
    drProBriefMerged,
    drProSkippedOrEmpty:
      !drProBriefMerged &&
      (/跳過：`GEMINI_API_KEY`/.test(joinedDr) ||
        /create HTTP|正文過短|捨棄：與當前選題/.test(joinedDr) ||
        /\[步骤0\.5\] 异常/.test(joinedDr)),
    gpt54LayerActivity: gpt54AndTranslationLines.length > 0,
    step1TranslationDone:
      /\[步骤1\] 完成 · 英文 prompt|\[2×4·步骤1·完成\]/.test(gpt54AndTranslationLines.join("\n")),
    imageGenLayerActivity: imageGenLines.length > 0,
    imageGenSuccess: /✓ 本条结束：已得到 imageUrl|尺寸 \d+x\d+ 成功|\[GPT-IMAGE-2\].*成功/.test(joinedImg),
  };

  return { drProLines, gpt54AndTranslationLines, imageGenLines, otherLines, hints };
}
