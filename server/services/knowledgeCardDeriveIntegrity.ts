/** 只检查可确定的表格残缺，不把句末标点或节数当作语义完整性证明。 */
export function assertKnowledgeCardDeriveTablesComplete(markdown: string): void {
  const lines = markdown.split(/\r?\n/);
  let fence: { char: string; length: number } | undefined;
  let columns = 0;
  let previous: string[] | undefined;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!.trim();
    const marker = /^(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      if (marker?.[0] === fence.char && marker.length >= fence.length && line === marker) fence = undefined;
      continue;
    }
    if (marker) {
      fence = { char: marker[0]!, length: marker.length };
      columns = 0;
      previous = undefined;
      continue;
    }
    const cells = /^#{1,6}\s/.test(line) ? undefined : tableCells(line);
    if (!cells) {
      columns = 0;
      previous = undefined;
      continue;
    }
    if (previous && cells.length === previous.length && cells.every(cell => /^:?-+:?$/.test(cell.trim()))) {
      columns = cells.length;
    } else if (columns && cells.length < columns) {
      throw new Error(`精华版派生：第 ${index + 1} 行表格不完整（应有 ${columns} 列，实际 ${cells.length} 列），未保存该结果`);
    }
    previous = cells;
  }
}

/** 外侧竖线可省略；转义竖线属于单元格内容，显式空单元格保留。 */
function tableCells(line: string): string[] | undefined {
  const cells: string[] = [];
  let cell = "";
  let delimiter = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;
    if (char === "\\" && i + 1 < line.length) {
      cell += char + line[++i]!;
    } else if (char === "|") {
      cells.push(cell);
      cell = "";
      delimiter = true;
    } else {
      cell += char;
    }
  }
  if (!delimiter) return undefined;
  cells.push(cell);
  if (cells[0] === "") cells.shift();
  if (cells.at(-1) === "") cells.pop();
  return cells;
}
