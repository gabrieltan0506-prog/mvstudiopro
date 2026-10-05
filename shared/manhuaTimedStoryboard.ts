/** 原稿秒位表的共同读取契约；不补镜、不去重、不用默认秒数掩盖坏行。 */
export type ManhuaTimedStoryboardRow = {
  index: number;
  startSec: number;
  endSec: number;
  cameraZh: string;
  actionZh: string;
  /** 显式制作片段切点，写在该镜动作单元格开头，不进入模型动作提示词。 */
  segmentBreakBefore?: boolean;
  dialogueZh: string;
  /** 混合音频列中明确与台词分开的音效/配乐，不能作为对白朗读。 */
  soundZh?: string;
};

/** 保留既有工作台的区块优先级，确认门禁同时检查区块外是否还藏有另一份原镜。 */
export function extractManhuaStoryboardSection(text: string): string {
  const board = text.match(/##\s*分镜表\s*\n+([\s\S]*?)(?=\n##\s|\n*$)/i);
  if (board?.[1]?.trim()) return board[1].trim();
  const beats = text.match(
    /##\s*(?:镜头节拍|节拍表|分镜)\s*\n+([\s\S]*?)(?=\n##\s|\n*$)/i
  );
  if (beats?.[1]?.trim()) return beats[1].trim();
  return text;
}

/** 转义竖线是单元格内容，不能令动作、对白及声音列整体错位。 */
function splitTimedTableCells(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  for (let i = 1; i < line.length; i++) {
    const char = line[i];
    if (char === "\\" && (line[i + 1] === "|" || line[i + 1] === "\\")) {
      cell += line[++i];
    } else if (char === "|") {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell) cells.push(cell.trim());
  return cells;
}

/** 只拆明确带说话人和引号的对白；不把未标明的混合说明猜成台词。 */
function splitReverseAudio(value: string): { dialogueZh: string; soundZh: string; performanceZh?: string; error?: string } {
  const raw = value.trim();
  const soundLabel = /^(?:音效|环境声|配乐|音乐|BGM)[:：]/i;
  const quotedSpeech = /[^:：「」“”『』"＋+]{1,80}[:：]\s*(?:「[^」]+」|“[^”]+”|『[^』]+』|"[^"]+")/;
  const spoken = new RegExp(`^(${quotedSpeech.source})`);
  const noDialogue = raw.match(/^(?:无对白|无|[-—–]+)(?:\s*[＋+]\s*(.+))?$/);
  const tail = noDialogue?.[1]?.trim() || "";
  if (noDialogue && !quotedSpeech.test(tail.replace(soundLabel, "")) && (!/[:：]/.test(tail) || soundLabel.test(tail)))
    return { dialogueZh: "无", soundZh: tail };
  if (soundLabel.test(raw) && /[:：]\s*\S/.test(raw))
    return { dialogueZh: "无", soundZh: raw, ...(quotedSpeech.test(raw.replace(soundLabel, "")) ? { error: "音频标签与引用对白混用，请明确分开" } : {}) };

  const dialogue: string[] = [];
  const performance: string[] = [];
  const result = (soundZh: string) => ({ dialogueZh: dialogue.join("\n"), soundZh, ...(performance.length ? { performanceZh: performance.join("；") } : {}) });
  let rest = raw;
  while (rest) {
    const match = rest.match(spoken);
    if (!match) break;
    dialogue.push(match[1].trim());
    rest = rest.slice(match[0].length).trim();
    // 引号外的明确表演括注保留为动作说明，不能丢弃或交给 TTS 朗读。
    const direction = rest.match(/^(?:（([^（）():：「」“”『』"\r\n]+)）|\(([^（）():：「」“”『』"\r\n]+)\))/);
    if (direction) {
      performance.push(`${match[1].split(/[:：]/, 1)[0].trim()}：${direction[1] ?? direction[2]}`);
      rest = rest.slice(direction[0].length).trim();
    }
    if (!rest) return result("");
    if (spoken.test(rest)) continue;
    if (!/^[＋+]/.test(rest)) break;
    rest = rest.slice(1).trim();
    if (!rest) return { dialogueZh: dialogue.join("\n"), soundZh: "", error: "音频分隔符后缺少内容" };
    if (!spoken.test(rest)) {
      if (/[「」“”『』"]/.test(rest) || /[:：]/.test(rest) && !/^(?:音效|环境声|配乐|音乐|BGM)[:：]/i.test(rest)) break;
      return result(rest);
    }
  }
  return { dialogueZh: "", soundZh: raw, error: "音频列含未明确的对白/音效，请标明说话人及引号，或标注无对白/音效" };
}

function readTimedRows(text: string): {
  recognized: boolean;
  rows: ManhuaTimedStoryboardRow[];
  errors: string[];
} {
  const rows: ManhuaTimedStoryboardRow[] = [];
  const errors: string[] = [];
  let recognized = false;
  let columnCount = 0;
  let columns: {
    index: number;
    time: number;
    camera: number[];
    action: number;
    visual: Array<{ index: number; label: string }>;
    dialogue: number;
    duration: number;
    startClock: boolean;
  } | null = null;
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (/^#{1,6}\s/.test(line)) columns = null;
    if (!line.startsWith("|")) {
      if (columns && /^\d+\s*\|/.test(line))
        errors.push("秒位分镜行缺行首竖线，请修复后再确认，不能跳过该镜");
      continue;
    }
    const cells = splitTimedTableCells(line);
    if (cells.every(cell => /^[-: ]*$/.test(cell))) continue;
    const headings = cells.map(cell => cell.replace(/\*\*/g, ""));
    const time = headings.findIndex(cell =>
      /^(?:秒位|时间|时间轴|起止秒位|约时码)$/.test(cell)
    );
    if (time >= 0) {
      recognized = true;
      columnCount = cells.length;
      const startClock = headings[time] === "约时码";
      columns = {
        index: headings.findIndex(cell => /^(?:#|镜号|序号|镜头)$/.test(cell)),
        time,
        camera: startClock
          ? [...["景别", "角度", "运镜"].map(heading => headings.indexOf(heading)), ...headings.map((cell, i) => /^(?:构图|焦段(?:.*)?|FOV(?:.*)?)$/i.test(cell) ? i : -1).filter(i => i >= 0)]
          : headings.map((cell, i) => /景别|运镜|机位|角度|构图|焦段|FOV/i.test(cell) ? i : -1).filter(i => i >= 0),
        visual: headings.map((cell, index) => ({ index, label: cell })).filter(item => /^(?:灯光|光影|氛围|场景氛围|色调|配色|转场(?:\/卡点)?|衔接)$/.test(item.label)),
        action: headings.findIndex(cell => /^(?:画面|内容|动作|主体动作)$/.test(cell)),
        dialogue: headings.findIndex(cell => startClock ? cell === "音频" : /台词|对白/.test(cell)),
        duration: headings.indexOf("时长建议"),
        startClock,
      };
      if ([columns.index, columns.time, columns.action, columns.dialogue, ...columns.camera].some(value => value < 0) || !columns.camera.length || startClock && columns.duration < 0)
        errors.push(startClock ? "约时码分镜表缺镜号、约时码、景别/角度/运镜、主体动作、音频或时长建议列" : "秒位分镜表缺镜号、秒位、景别/运镜、画面或对白列");
      continue;
    }
    if (!columns) continue;
    if (cells.length !== columnCount)
      errors.push(
        `秒位分镜列数与表头不一致（应为${columnCount}列，实际${cells.length}列）；内容中的竖线请写成\\|`
      );
    const indexText = cells[columns.index] || "";
    const index = /^\d+$/.test(indexText) ? Number(indexText) : NaN;
    const match = (cells[columns.time] || "").match(
      /^(\d+(?:\.\d+)?)\s*(?:-|–|—|~|～|至)\s*(\d+(?:\.\d+)?)\s*(?:s|秒)?$/i
    );
    const clock = columns.startClock ? (cells[columns.time] || "").match(/^(\d+):([0-5]\d(?:\.\d+)?)(?:\s*(?:-|–|—|~|～|至)\s*(\d+):([0-5]\d(?:\.\d+)?))?$/) : null;
    const duration = columns.startClock ? (cells[columns.duration] || "").match(/^(\d+(?:\.\d+)?)\s*(?:s|秒)$/i) : null;
    const startSec = columns.startClock ? (clock ? Number(clock[1]) * 60 + Number(clock[2]) : NaN) : (match ? Number(match[1]) : NaN);
    const explicitEndSec = clock?.[3] !== undefined ? Number(clock[3]) * 60 + Number(clock[4]) : undefined;
    const audio = columns.startClock ? splitReverseAudio(cells[columns.dialogue] || "") : null;
    const row: ManhuaTimedStoryboardRow = {
      index,
      startSec,
      endSec: columns.startClock ? (explicitEndSec ?? (duration ? startSec + Number(duration[1]) : NaN)) : (match ? Number(match[2]) : NaN),
      cameraZh: columns.camera.map(column => cells[column] || "").filter(cell => cell && !/^[-—–]+$/.test(cell)).join("；"),
      actionZh: [
        (cells[columns.action] || "").replace(/^【新段】\s*/, ""),
        ...columns.visual.map(item => cells[item.index] && !/^[-—–]+$/.test(cells[item.index]!) ? `${item.label}：${cells[item.index]}` : ""),
        ...(audio?.performanceZh ? [`对白表演：${audio.performanceZh}`] : []),
      ].filter(Boolean).join("；"),
      ...(/^【新段】/.test(cells[columns.action] || "") ? { segmentBreakBefore: true } : {}),
      dialogueZh: audio?.dialogueZh ?? cells[columns.dialogue] ?? "",
      ...(audio ? { soundZh: audio.soundZh } : {}),
    };
    const label = `镜${indexText || rows.length + 1}`;
    if (columns.startClock && (!duration || Number(duration[1]) <= 0))
      errors.push(`${label} 无精确时长，时长建议须为单个正数秒；不能使用范围或默认秒数`);
    if (explicitEndSec !== undefined && duration && Math.abs(explicitEndSec - startSec - Number(duration[1])) > 0.001)
      errors.push(`${label} 起止时码与时长建议不一致`);
    if (audio?.error) errors.push(`${label} ${audio.error}`);
    if (!Number.isSafeInteger(index) || index !== rows.length + 1)
      errors.push(`${label} 镜号重复、缺失或不连续`);
    if (
      !Number.isFinite(row.startSec) ||
      !Number.isFinite(row.endSec) ||
      row.endSec <= row.startSec
    )
      errors.push(`${label} 秒位无效，须填写递增的起止秒数`);
    else if (Math.abs(row.startSec - (rows.at(-1)?.endSec ?? 0)) > 0.001)
      errors.push(`${label} 秒位不连续或重叠`);
    if (!row.cameraZh || /^[-—–]+$/.test(row.cameraZh))
      errors.push(`${label} 缺景别/运镜`);
    if (!row.actionZh || /^[-—–]+$/.test(row.actionZh))
      errors.push(`${label} 缺画面动作`);
    if (!row.dialogueZh)
      errors.push(`${label} 缺对白说明；无对白请明确标注“无”`);
    rows.push(row);
  }
  if (recognized && rows.length < 2)
    errors.push("秒位分镜表至少需要两行真实镜头");
  return { recognized, rows, errors };
}

export function readManhuaTimedStoryboard(
  text: string
): ReturnType<typeof readTimedRows> {
  const raw = String(text || "").trim();
  const result = readTimedRows(raw);
  const section = extractManhuaStoryboardSection(raw);
  if (result.recognized && section !== raw) {
    const selected = readTimedRows(section);
    if (
      !selected.recognized ||
      JSON.stringify(selected.rows) !== JSON.stringify(result.rows)
    ) {
      result.errors.push(
        "秒位分镜表位于当前分镜区块之外，请将本集原镜整理到同一分镜区块再确认"
      );
    }
  }
  return result;
}
