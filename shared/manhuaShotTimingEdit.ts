import { readManhuaTimedStoryboard } from './manhuaTimedStoryboard';

/** 只修改秒位与时长列；保留表演、光影、声音、构图等原列，后续镜头整体顺延。 */
export function retimeManhuaShot(text: string, shotIndex: number, durationSec: number) {
  if (!Number.isInteger(shotIndex) || shotIndex < 1 || !Number.isFinite(durationSec) || durationSec < 0.1 || durationSec > 3600) throw new Error('镜头时长须为0.1–3600秒。');
  const before = readManhuaTimedStoryboard(text);
  if (!before.recognized || before.errors.length || !before.rows.some(row => row.index === shotIndex)) throw new Error('请先提供完整、连续的秒位分镜表；原稿未修改。');
  const desired = Math.round(durationSec * 1000) / 1000;
  const delta = desired - (before.rows[shotIndex - 1].endSec - before.rows[shotIndex - 1].startSec);
  const round = (n: number) => Math.round(n * 1000) / 1000;
  const clock = (n: number) => `${Math.floor(n / 60)}:${(n % 60).toFixed(3).padStart(6, '0')}`;
  // 保留转义竖线；以原始单元格写回，避免改变台词和提示词。
  const cellsOf = (line: string) => line.trim().slice(1).replace(/\|\s*$/, '').split(/(?<!\\)\|/);
  let indexCol = -1, timeCol = -1, durationCol = -1;
  let clockMode = false;
  const tableLines: string[] = [];
  const lines = text.split(/\r?\n/).map(line => {
    if (/^#{1,6}\s/.test(line.trim())) { timeCol = -1; return line; }
    if (!line.trim().startsWith('|')) return line;
    const cells = cellsOf(line);
    const headings = cells.map(cell => cell.trim().replace(/\*\*/g, ''));
    const time = headings.findIndex(cell => /^(秒位|时间|时间轴|起止秒位|约时码)$/.test(cell));
    if (time >= 0) {
      timeCol = time; indexCol = headings.findIndex(cell => /^(#|镜号|序号|镜头)$/.test(cell));
      durationCol = headings.indexOf('时长建议'); clockMode = headings[time] === '约时码';
      tableLines.push(line); return line;
    }
    if (timeCol < 0) return line;
    if (headings.every(cell => /^[-: ]*$/.test(cell))) { tableLines.push(line); return line; }
    const index = Number(headings[indexCol]);
    const original = before.rows.find(row => row.index === index);
    if (!original) throw new Error('分镜表镜号无法对应，原稿未修改。');
    const start = round(original.startSec + (index > shotIndex ? delta : 0));
    const end = round(original.endSec + (index >= shotIndex ? delta : 0));
    cells[timeCol] = ` ${clockMode ? clock(start) : `${start}–${end}秒`} `;
    if (clockMode) cells[durationCol] = ` ${round(end - start)}s `;
    const updated = `|${cells.join('|')}|`;
    tableLines.push(updated); return updated;
  });
  const updatedText = lines.join('\n');
  const after = readManhuaTimedStoryboard(updatedText);
  if (after.errors.length || after.rows.length !== before.rows.length) throw new Error('调整后秒位校验未通过，原稿未修改。');
  if (after.rows.some((row, i) => row.actionZh !== before.rows[i].actionZh || row.dialogueZh !== before.rows[i].dialogueZh || row.cameraZh !== before.rows[i].cameraZh || row.soundZh !== before.rows[i].soundZh)) throw new Error('非时间内容发生变化，原稿未修改。');
  return { text: updatedText, table: tableLines.join('\n'), totalSec: after.rows.at(-1)!.endSec, rows: after.rows };
}
