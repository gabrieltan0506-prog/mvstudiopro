/** 用户提供PDF第6—11、14、16页的方法蒸馏；不将二手研究数字作为质量门槛。 */
export const LYRIC_CRAFT_METHOD_VERSION = "lyrics-craft-20261016-v1";
export const LYRIC_CRAFT_INSTRUCTIONS = `歌词修订依次检查立意、段落推进、具体语言、韵律、词曲咬合和冷审。
先明确谁在什么处境对谁说话、想做什么、遇到什么阻力；保留用户主题、专名与有意设计的口号，不把所有歌改成生活小品。
用动作、物件、对话或身体反应承载情绪。不要凭空把虚构细节说成用户真实经历；可提出可替换的虚构场景。抽象词不是禁词，判断它在上下文是否由具体行动支撑。
逐段说明起始情绪→转折触发→结束情绪，并指出歌词、演唱与编曲分别怎样落实。第二主歌须增加事件、代价或认识，桥段改变视角或选择；允许非标准结构，不强加桥段。
副歌保留容易记住的核心句，重复可以是有效设计；检查重复时情境或音乐是否改变。不设歌名必须重复5到7次、副歌必须50秒内出现、必须第一人称或必须负面情绪等硬指标。
先按自然语序和呼吸修句，再处理韵脚。宁可调整韵式也不倒装凑韵。字符数只作文本长度参考，英文缩写、多音字、儿化和拖腔不能按字符推定音节。
声调、自然重音、高音元音、换气与实际速度须结合旋律和演唱证据判断。没有音频/谱面时标为待试唱，不声称可唱性已验证；不机械规定四声必须对应某种旋律、入声不能拖长或高音不能用某个元音。
先修结构再改句；每个问题引用实际原句和段落，说明问题与本歌目标的关系，给保留、编辑、替换或删除建议及理由。不输出AI检测概率，不用禁词命中或重复比例直接判不合格。优秀原句应保留，不为修改而修改。
此方法来自用户提供的二手报告，未逐条核验其中人物引语、统计、歌曲归属及固定公式；只采用以上创作原则，不复述其数字为科学保证。`;

export function inspectLyricText(lyrics: string) {
  const lines = lyrics.split(/\r?\n/);
  let section = "未标段落";
  const rows: { line: number; section: string; text: string; characterCount: number }[] = [];
  lines.forEach((raw, index) => {
    const text = raw.trim();
    if (!text) return;
    if (/^\[[^\]]+\]$/.test(text)) { section = text.slice(1, -1); return; }
    rows.push({ line: index + 1, section, text, characterCount: Array.from(text.replace(new RegExp("[\\s\\p{P}\\p{S}]", "gu"), "")).length });
  });
  const groups = new Map<string, number[]>();
  for (const row of rows) groups.set(row.text, [...(groups.get(row.text) || []), row.line]);
  return {
    version: LYRIC_CRAFT_METHOD_VERSION,
    scopeZh: "完整文本行号、段落标签、字符数与逐字重复；不判断音节、押韵、AI来源或实际演唱质量",
    lines: rows,
    repeatedLines: Array.from(groups, ([text, lineNumbers]) => ({ text, lineNumbers })).filter(x => x.lineNumbers.length > 1),
  };
}

/** 只检查明确的歌词字段，避免把研究证据、提示词或器乐演奏指令误当唱词。 */
export function buildLyricReviewContext(candidate: unknown) {
  if (!candidate || typeof candidate !== "object") return undefined;
  const c = candidate as Record<string, unknown>;
  const entries: { path: string; lyrics: string }[] = [];
  if (typeof c.lyrics === "string" && c.lyrics.trim()) entries.push({ path: "/candidate/lyrics", lyrics: c.lyrics });
  if (c.kind === "suno_song_v1" && Array.isArray(c.concepts)) c.concepts.forEach((concept, index) => {
    const brief = concept?.brief;
    if (brief?.instrumental === false && typeof brief.prompt === "string" && brief.prompt.trim())
      entries.push({ path: `/candidate/concepts/${index}/brief/prompt`, lyrics: brief.prompt });
  });
  if (!entries.length) return undefined;
  return { methodVersion: LYRIC_CRAFT_METHOD_VERSION, instructions: LYRIC_CRAFT_INSTRUCTIONS, diagnostics: entries.map(e => ({ sourcePath: e.path, ...inspectLyricText(e.lyrics) })) };
}
