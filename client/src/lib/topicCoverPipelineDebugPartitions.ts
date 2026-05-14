/**
 * 選題單幀封面管線：將 `imageGenFlowLog` 拆成 **Deep Research Pro（0.5）** 與 **GPT 5.4 英文化** 兩段，
 * 供 Platform Debug 面板對照「是否真跑 DR Pro → 再進翻譯層」。
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
};

export type TopicCoverPipelinePartition = {
  drProLines: string[];
  gpt54AndTranslationLines: string[];
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
    /\[GPT54|GPT54·|\[步骤1\]|\[步骤1b\]|Vertex·Flash|骨架·中文视觉|extractChineseVisualBrief|\[语境\]|调用 GPT 5\.4|GPT 5\.4（OpenAI）/.test(s)
  );
}

export function partitionTopicCoverPipelineFlowLog(lines: string[]): TopicCoverPipelinePartition {
  const drProLines: string[] = [];
  const gpt54AndTranslationLines: string[] = [];
  const otherLines: string[] = [];
  let phaseOrderLine: string | undefined;

  for (const raw of lines) {
    const s = String(raw);
    if (/\[管线·阶段顺序\]/.test(s)) {
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
    otherLines.push(s);
  }

  const joinedDr = drProLines.join("\n");
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
    step1TranslationDone: /\[步骤1\] 完成 · 英文 prompt/.test(gpt54AndTranslationLines.join("\n")),
  };

  return { drProLines, gpt54AndTranslationLines, otherLines, hints };
}
