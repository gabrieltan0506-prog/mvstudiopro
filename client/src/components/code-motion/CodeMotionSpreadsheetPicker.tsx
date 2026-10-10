import { useState } from "react";
import {
  selectCodeMotionData,
  type CodeMotionWorkbook,
} from "@shared/codeMotionSpreadsheet";
export default function CodeMotionSpreadsheetPicker({
  name,
  workbook,
  output,
  onClose,
  onUse,
}: {
  name: string;
  output: "ppt" | "video";
  workbook: CodeMotionWorkbook;
  onClose: () => void;
  onUse: (value: ReturnType<typeof selectCodeMotionData>) => void;
}) {
  const [sheetIndex, setSheetIndex] = useState(0),
    [labelColumn, setLabelColumn] = useState(0),
    [valueColumn, setValueColumn] = useState(1),
    [startRow, setStartRow] = useState(2),
    [endRow, setEndRow] = useState(workbook.sheets[0]?.rows.length || 1),
    [error, setError] = useState("");
  const sheet = workbook.sheets[sheetIndex],
    width = sheet?.rows[0]?.cells.length || 0;
  const field =
    "mt-1 w-full rounded-lg border border-stone-300 bg-white px-2 py-2 text-sm";
  return (
    <div className="space-y-3 rounded-xl border border-orange-200 bg-orange-50 p-4">
      <p className="text-sm font-semibold">{name}</p>
      <label className="block text-sm">
        工作表
        <select
          aria-label="选择导入工作表"
          className={field}
          value={sheetIndex}
          onChange={e => {
            const i = Number(e.target.value);
            setSheetIndex(i);
            setStartRow(2);
            setEndRow(workbook.sheets[i].rows.length);
            setLabelColumn(0);
            setValueColumn(1);
            setError("");
          }}
        >
          {workbook.sheets.map((s, i) => (
            <option key={i} value={i}>
              {s.name}
              {s.hidden ? "（原隐藏表）" : ""}
            </option>
          ))}
        </select>
      </label>
      <p className="text-xs">
        已读取本表 {sheet.rows.length} 行、{width}{" "}
        列。下表展示全部已读内容，可滚动核对；第 1
        行默认作表头，可自行调整数据起止行。导入内容仅留在本页；视频所选数据随作品保存，PPT所选数据保存在本机，请下载工程备份。
      </p>
      <div className="max-h-64 overflow-auto rounded-lg border bg-white">
        <table className="w-full whitespace-pre-wrap text-left text-xs">
          <thead>
            <tr>
              <th className="p-2">行</th>
              {Array.from({ length: width }, (_, i) => (
                <th className="p-2" key={i}>
                  {String.fromCharCode(65 + i)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheet.rows.map(r => (
              <tr key={r.index} className="border-t">
                <th className="p-2">{r.index}</th>
                {r.cells.map((c, i) => (
                  <td
                    key={i}
                    className={
                      "max-w-64 break-words p-2 " +
                      (c.kind === "error" ? "text-red-700" : "")
                    }
                  >
                    {c.text || "（空白）"}
                    {c.formulaCached ? " · 缓存" : ""}
                    {c.kind === "date" ? " · 日期" : ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="list-disc space-y-1 pl-4 text-xs text-stone-600">
        {workbook.warnings.map(w => (
          <li key={w}>{w}</li>
        ))}
      </ul>
      <div className="grid grid-cols-2 gap-3">
        {(
          [
            [labelColumn, setLabelColumn, "名称列"],
            [valueColumn, setValueColumn, "数值列"],
          ] as const
        ).map(([value, set, label]) => (
          <label className="text-sm" key={label}>
            {label}
            <select
              aria-label={label}
              className={field}
              value={value}
              onChange={e => set(Number(e.target.value))}
            >
              {Array.from({ length: width }, (_, i) => (
                <option key={i} value={i}>
                  {String.fromCharCode(65 + i)} ·{" "}
                  {sheet.rows[0]?.cells[i]?.text || "未命名"}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm">
          起始行
          <input
            aria-label="数据起始行"
            type="number"
            min={1}
            max={sheet.rows.length}
            className={field}
            value={startRow}
            onChange={e => setStartRow(Number(e.target.value))}
          />
        </label>
        <label className="text-sm">
          结束行
          <input
            aria-label="数据结束行"
            type="number"
            min={1}
            max={sheet.rows.length}
            className={field}
            value={endRow}
            onChange={e => setEndRow(Number(e.target.value))}
          />
        </label>
      </div>
      <p className="text-xs">
        {output === "ppt"
          ? "PPT可选完整表格，单页图表最多8项，后续逐页选择范围。"
          : "MP4一次最多选择12项。"}
        空白数值保留为空，不自动按零或公式推算。
      </p>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-lg border bg-white px-3 py-2 text-sm"
          onClick={() => {
            try {
              const selected = selectCodeMotionData(
                workbook,
                sheetIndex,
                labelColumn,
                valueColumn,
                startRow,
                endRow,
                output === "ppt" ? 200 : 12
              );
              const source = `${name} / ${selected.source}`;
              if (source.length > 120)
                throw new Error(
                  "文件与工作表名称过长，请缩短文件名后导入，避免来源被截断"
                );
              onUse({ ...selected, source });
            } catch (e) {
              setError(e instanceof Error ? e.message : "请选择有效数据");
            }
          }}
        >
          使用所选数据
        </button>
        <button
          type="button"
          className="rounded-lg border bg-white px-3 py-2 text-sm"
          onClick={onClose}
        >
          暂不使用
        </button>
      </div>
    </div>
  );
}
