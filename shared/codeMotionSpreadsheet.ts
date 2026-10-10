export type CodeMotionCell = {
  text: string;
  kind: "blank" | "text" | "number" | "date" | "error";
  value?: number;
  formulaCached?: boolean;
};
export type CodeMotionWorkbook = {
  sheets: {
    name: string;
    hidden?: boolean;
    rows: { index: number; cells: CodeMotionCell[] }[];
  }[];
  warnings: string[];
};
/** 选择明确行列后才交给图表；空白、公式错误和日期不被转成零。 */
export function selectCodeMotionData(
  workbook: CodeMotionWorkbook,
  sheetIndex: number,
  labelColumn: number,
  valueColumn: number,
  startRow: number,
  endRow: number,
  maximumRows: 12 | 200 = 12
) {
  const sheet = workbook.sheets[sheetIndex];
  if (
    !sheet ||
    !Number.isInteger(startRow) ||
    !Number.isInteger(endRow) ||
    startRow < 1 ||
    endRow < startRow ||
    endRow > sheet.rows.length
  )
    throw new Error("请选择有效的数据行范围");
  const columns = sheet.rows[0]?.cells.length || 0;
  if (
    !Number.isInteger(labelColumn) ||
    !Number.isInteger(valueColumn) ||
    labelColumn < 0 ||
    valueColumn < 0 ||
    labelColumn >= columns ||
    valueColumn >= columns
  )
    throw new Error("请选择存在的名称列和数值列");
  if (labelColumn === valueColumn) throw new Error("名称和数值请选择不同列");
  if (endRow - startRow + 1 > maximumRows)
    throw new Error(`一次最多选${maximumRows}项数据，请调整起止行；没有截断`);
  const data = sheet.rows.slice(startRow - 1, endRow).map(row => {
    const label = row.cells[labelColumn]?.text.trim(),
      cell = row.cells[valueColumn];
    if (!label || label.length > 30)
      throw new Error(`第${row.index}行名称为空或超过三十字`);
    if (!cell || cell.kind === "blank" || !cell.text.trim())
      return { label, value: null };
    if (cell.kind === "date" || cell.kind === "error")
      throw new Error(`第${row.index}行不是可用数值：${cell.text}`);
    if (
      !/^[+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(cell.text.trim())
    )
      throw new Error(`第${row.index}行包含文字、负值或单位，请先确认原始数值`);
    // 先核对原文字精度，不能先转浮点再把长小数悄悄舍入。
    const numeric = cell.text.trim().replace(/^\+/, "");
    const [mantissa, exponentText] = numeric.toLowerCase().split("e");
    const exponent = exponentText ? Number(exponentText) : 0;
    const fraction = mantissa.split(".")[1] || "";
    const digits = mantissa.replace(".", "");
    const significantDigits = digits.replace(/0+$/, "");
    const trailingZeros = digits.length - significantDigits.length;
    if (
      !Number.isSafeInteger(exponent) ||
      (significantDigits.length > 0 &&
        fraction.length - exponent - trailingZeros > 6)
    )
      throw new Error(
        `第${row.index}行原始小数超过六位，请先明确精度；未做舍入`
      );
    const value = Number(numeric);
    if (
      !Number.isFinite(value) ||
      value < 0 ||
      value > 1e9 ||
      Number(value.toFixed(6)) !== value
    )
      throw new Error(
        `第${row.index}行数值超出范围或超过六位小数，请先明确单位与精度`
      );
    return { label, value };
  });
  if (data.length < 2) throw new Error("至少选择两项真实数据");
  return { data, source: `${sheet.name}，第${startRow}—${endRow}行` };
}
