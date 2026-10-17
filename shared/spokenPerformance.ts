/** 口播正文与表演说明分开，沿现有分镜字段保存，不把导演说明送进朗读正文。 */
export const SPOKEN_PERFORMANCE_PROMPT = `【逐句口播表演】
copywriting和dialogueZh只放实际要说的话，不把重音/换气标签当成要念出的台词。
每个有口播的镜头都要有表演安排：editNoteZh用“语气：…；重音：…；停顿：…”写清情绪如何变化、具体强调哪些原词、在哪个词前后停顿，合计不超过80字。actionZh用“手势：…；视线：…”写清哪只手、跟哪个词起落、动作如何收住以及目光对象，合计不超过160字。握持道具或动作受限时说明保持姿态的理由，不机械地每句挥手。
detailedScript逐句展开意图、情绪、声量/语速、停顿、手势与表情；镜表保留能直接执行的要点。开场设问、提醒、解释、结尾邀请应有不同演法，不能全程同一音量平读，也不能全程喊叫。用户指定的重音和顿点优先，不擅改台词或压缩内容；停顿秒数是待试读建议，不冒充已锁定音频。
画内对白对口型，动作中的旁白不驱动人物机械张嘴；手势不遮嘴，强动作与细微表情分配到可读窗口。表演说明不代表TTS已经执行，须用实际配音试听核对。`;

/** 仅审核新生成的口播镜表；不改变旧稿回读或通用镜表兼容规则。 */
export function assertSpokenPerformance(rawCells: unknown): void {
  if (!Array.isArray(rawCells)) throw new Error("口播表演缺少逐镜表");
  for (let index = 0; index < rawCells.length; index++) {
    const raw = rawCells[index];
    if (!raw || typeof raw !== "object") continue;
    const cell = raw as Record<string, unknown>;
    if (typeof cell.dialogueZh !== "string" || !cell.dialogueZh.trim()) continue;
    const notes = String(cell.editNoteZh ?? ""), action = String(cell.actionZh ?? "");
    const has = (text: string, label: string) => {
      const value = text.match(new RegExp(`${label}[:：]([^；;\\n]+)`))?.[1]?.trim();
      return Boolean(value && !/^(无|暂无|待定|待补|待补充|略|TODO)$/i.test(value));
    };
    const missing = [
      ...["语气", "重音", "停顿"].filter(label => !has(notes, label)),
      ...["手势", "视线"].filter(label => !has(action, label)),
    ];
    if (missing.length) throw new Error(`第${index + 1}镜口播表演缺少具体${missing.join("、")}；请补入editNoteZh/actionZh，保留纯台词`);
    if (notes.length > 80 || action.length > 160) throw new Error(`第${index + 1}镜表演说明超出字段容量；请精炼镜表并将完整演法保留在detailedScript，不得截断`);
  }
}
