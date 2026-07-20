/**
 * 选题单帧封面 / 2×4 管线：将 `imageGenFlowLog` 拆成
 * **DR-Pro（0.5）**、**中文直送（指令组装）**、**生图（OpenAI/OpenRouter GPT-IMAGE-2）**，
 * 供 Platform Debug 对照全链路。
 */

export type TopicCoverPipelinePartitionHints = {
  /** 服务端写入的 `[管线·阶段顺序]`（有则表示后端已打阶段分界标记） */
  phaseOrderLine?: string;
  /** 曾出现 Interactions create / poll（代表至少打到 DR Pro API） */
  drProApiActivity: boolean;
  /** 简报锚定通过并合并（`完成 · 简报長`） */
  drProBriefMerged: boolean;
  /** 略过 DR（密钥未设、create 失败、锚定失败等会写入 0.5 行） */
  drProSkippedOrEmpty: boolean;
  /** 中文直送 / staging / 步骤1 指令组装有日志 */
  chineseDirectActivity: boolean;
  /** 步骤1 中文直送主体已就绪 */
  step1ChineseDirectDone: boolean;
  /** 步骤2 生图子日志（OpenAI / OpenRouter GPT-IMAGE-2） */
  imageGenLayerActivity: boolean;
  /** 单条任务已成功取得 URL（服务端 ✓ 行） */
  imageGenSuccess: boolean;
  /** @deprecated 兼容旧名；等同 chineseDirectActivity */
  gpt54LayerActivity: boolean;
  /** @deprecated 兼容旧名；等同 step1ChineseDirectDone */
  step1TranslationDone: boolean;
};

export type TopicCoverPipelinePartition = {
  drProLines: string[];
  /** 中文直送 · 指令组装（不再含 GPT 5.4 英文化） */
  chineseDirectLines: string[];
  /** @deprecated 兼容旧名；等同 chineseDirectLines */
  gpt54AndTranslationLines: string[];
  /** OpenAI / OpenRouter GPT-IMAGE-2（无 NB2 降级） */
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

/** B 栏：中文直送 / staging / 步骤1 主体组装（含历史英文化行，便于旧 job 对照） */
function lineMatchesChineseDirectLayer(s: string): boolean {
  return (
    /\[步骤1·中文直送\]|\[步骤1b\]|\[chineseStaging|中文直送|无 GPT 5\.4|无智能提炼|确定性语境聚焦/.test(s) ||
    /\[2×4·中文直送\]|\[2×4·中文骨架\]|\[2×4·步骤1|buildCompositeSheetDirectChineseBody|宽幅合成.*中文/.test(s) ||
    /\[步骤1\] 完成 · 英文 prompt|\[GPT54|GPT54·|Vertex·Flash|骨架·中文视觉|extractChineseVisualBrief|\[英文化·完成\]|\[套裝·併翻\]|translatePlatformComposite/.test(
      s,
    )
  );
}

/** C 栏：生图像素（勿与中文直送混淆） */
function lineMatchesImageGenLayer(s: string): boolean {
  return (
    /\[步骤2\]|\[步骤2·换人\]|\[封面·像素\]|\[Imagen·封面\]|\[步骤3[ab]?\]|\[步骤1\/2\]/.test(s) ||
    /\[步骤3/.test(s) ||
    /\[GPT-IMAGE-2|GPT-IMAGE-2·OpenAI|GPT-IMAGE-2·OpenRouter|单帧·OpenAI|单帧·OpenRouter|像素锁|生图|生圖/.test(
      s,
    ) ||
    /\[2×4·步骤2|\[2×4·主路径\]|\[2×4·步骤2a|宽?幅.*GPT-IMAGE|OpenAI\/OpenRouter/.test(s) ||
    /Nano Banana|\bNB2\b|Vertex Nano|OhMyGPT|FAL·|EvoLink.*GPT-IMAGE|platform_topic_reference/.test(s)
  );
}

export function partitionTopicCoverPipelineFlowLog(lines: string[]): TopicCoverPipelinePartition {
  const drProLines: string[] = [];
  const chineseDirectLines: string[] = [];
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
    if (lineMatchesChineseDirectLayer(s)) {
      chineseDirectLines.push(s);
      continue;
    }
    if (lineMatchesImageGenLayer(s)) {
      imageGenLines.push(s);
      continue;
    }
    otherLines.push(s);
  }

  const joinedDr = drProLines.join("\n");
  const joinedDirect = chineseDirectLines.join("\n");
  const joinedImg = imageGenLines.join("\n");
  const drProBriefMerged = /完成 · 简报長=/.test(joinedDr);
  const chineseDirectActivity = chineseDirectLines.length > 0;
  const step1ChineseDirectDone =
    /\[步骤1·中文直送\]|\[步骤1b\]|\[2×4·步骤1·完成\]|\[2×4·步骤1·中文直送\]|主体就绪|主体直接进封面像素/.test(
      joinedDirect,
    );
  const hints: TopicCoverPipelinePartitionHints = {
    phaseOrderLine,
    drProApiActivity: /interaction=|進入輪詢|polling · elapsed|create HTTP/i.test(joinedDr),
    drProBriefMerged,
    drProSkippedOrEmpty:
      !drProBriefMerged &&
      (/跳過：`GEMINI_API_KEY`/.test(joinedDr) ||
        /create HTTP|正文過短|捨棄：與當前選題/.test(joinedDr) ||
        /\[步骤0\.5\] 异常/.test(joinedDr)),
    chineseDirectActivity,
    step1ChineseDirectDone,
    gpt54LayerActivity: chineseDirectActivity,
    step1TranslationDone: step1ChineseDirectDone,
    imageGenLayerActivity: imageGenLines.length > 0,
    imageGenSuccess:
      /✓ 本条结束：已得到 imageUrl|尺寸 \d+x\d+ 成功|\[GPT-IMAGE-2[^\n]*成功|OpenAI\/OpenRouter 成功/.test(
        joinedImg,
      ),
  };

  return {
    drProLines,
    chineseDirectLines,
    gpt54AndTranslationLines: chineseDirectLines,
    imageGenLines,
    otherLines,
    hints,
  };
}
