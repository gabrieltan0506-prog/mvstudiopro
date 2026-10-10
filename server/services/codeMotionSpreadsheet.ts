import { spawn } from "node:child_process";
import path from "node:path";
import type { CodeMotionWorkbook } from "../../shared/codeMotionSpreadsheet";
const MAX_ROWS = 201,
  MAX_COLS = 24,
  MAX_CHARS = 200_000;
function utf8(buffer: Buffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true })
      .decode(buffer)
      .replace(/^\uFEFF/, "");
  } catch {
    throw new Error("文件不是有效 UTF-8，请另存为 UTF-8 CSV 后导入");
  }
}
export function parseCodeMotionCsv(buffer: Buffer): CodeMotionWorkbook {
  const text = utf8(buffer);
  if (text.length > MAX_CHARS)
    throw new Error("CSV 超过20万字符，已停止读取，请缩小范围；没有截断导入");
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false,
    closed = false;
  const pushCell = () => {
    if (cell.length > 2000) throw new Error("单元格超过2000字，已停止导入");
    row.push(cell);
    cell = "";
    closed = false;
    if (row.length > MAX_COLS)
      throw new Error("CSV 超过24列，已停止导入，请先选出所需列");
  };
  const pushRow = () => {
    pushCell();
    rows.push(row);
    row = [];
    if (rows.length > MAX_ROWS)
      throw new Error("CSV 超过201行（含表头），已停止导入，请先缩小范围");
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += ch;
      continue;
    }
    if (ch === '"') {
      if (cell || closed) throw new Error("CSV 引号格式错误，请检查原文件");
      quoted = true;
    } else if (ch === ",") pushCell();
    else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      pushRow();
    } else {
      if (closed) throw new Error("CSV 结束引号后有额外文字，请检查原文件");
      cell += ch;
    }
  }
  if (quoted) throw new Error("CSV 引号未闭合，未导入不完整内容");
  if (cell || row.length || closed) pushRow();
  if (!rows.length) throw new Error("没有可读数据");
  const width = Math.max(...rows.map(r => r.length));
  if (rows.some(r => r.length !== width))
    throw new Error("CSV 各行列数不一致，请补齐空单元格后导入");
  return {
    sheets: [
      {
        name: "CSV",
        rows: rows.map((r, index) => ({
          index: index + 1,
          cells: r.map(value => ({
            text: value,
            kind: value === "" ? "blank" : "text",
          })),
        })),
      },
    ],
    warnings: [
      "CSV 不含单元格类型和单位；选择数值列后请核对原文、小数与单位。",
    ],
  };
}

/** 使用Docker已安装的Python标准库读取OOXML，不增加第三方依赖。 */
export async function parseCodeMotionXlsx(
  buffer: Buffer
): Promise<CodeMotionWorkbook> {
  if (buffer.length > 8 * 1024 * 1024) throw new Error("文件超过8MB");
  const response = await new Promise<string>((resolve, reject) => {
    const child = spawn(
      "python3",
      [path.resolve("server/scripts/code_motion_spreadsheet.py")],
      { stdio: ["pipe", "pipe", "pipe"] }
    );
    const chunks: Buffer[] = [];
    let size = 0,
      settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill("SIGKILL");
      reject(error);
    };
    const timer = setTimeout(
      () => fail(new Error("表格读取超过15秒，已停止；请缩小范围后重试")),
      15_000
    );
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 4 * 1024 * 1024) {
        fail(new Error("表格展示内容超过4MB，已停止导入"));
        return;
      }
      chunks.push(chunk);
    });
    child.stderr.resume();
    child.on("error", () => fail(new Error("表格读取服务不可用，请稍后再试")));
    child.stdin.on("error", () =>
      fail(new Error("表格读取未完成，请检查文件"))
    );
    child.on("close", code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) reject(new Error("表格读取服务未正常完成"));
      else resolve(Buffer.concat(chunks).toString("utf8"));
    });
    child.stdin.end(buffer);
  });
  const result = JSON.parse(response) as {
    ok: boolean;
    workbook?: CodeMotionWorkbook;
    error?: string;
  };
  if (!result.ok || !result.workbook)
    throw new Error(result.error || "工作簿读取失败");
  return result.workbook;
}
