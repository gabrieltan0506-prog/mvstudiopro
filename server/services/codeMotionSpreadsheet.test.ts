import { expect, it } from "vitest";
import JSZip from "jszip";
import {
  parseCodeMotionCsv,
  parseCodeMotionXlsx,
} from "./codeMotionSpreadsheet";
import { selectCodeMotionData } from "../../shared/codeMotionSpreadsheet";
const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
async function workbook(body: string, extras: Record<string, string> = {}) {
  const zip = new JSZip();
  zip.file(
    "xl/workbook.xml",
    `<x:workbook xmlns:x="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><x:sheets><x:sheet name="销售&amp;收入" sheetId="1" r:id="rId1"/></x:sheets></x:workbook>`
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/></Relationships>'
  );
  zip.file(
    "xl/worksheets/sheet1.xml",
    `<worksheet xmlns="${ns}"><sheetData>${body}</sheetData></worksheet>`
  );
  for (const [name, text] of Object.entries(extras)) zip.file(name, text);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
const rows =
  '<row r="1"><c r="A1" t="inlineStr"><is><t>月份</t></is></c><c r="B1" t="inlineStr"><is><t>收入</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>十月&amp;本期</t></is></c><c r="B2"><v>12.5</v></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>十一月</t></is></c><c r="B3"><v>0</v></c></row>';
it("真实XLSX有界读取，命名空间和实体文字保留，所选原值进入图表", async () => {
  const wb = await parseCodeMotionXlsx(await workbook(rows));
  expect(wb.sheets[0].name).toBe("销售&收入");
  expect(wb.sheets[0].rows).toHaveLength(3);
  expect(selectCodeMotionData(wb, 0, 0, 1, 2, 3).data).toEqual([
    { label: "十月&本期", value: 12.5 },
    { label: "十一月", value: 0 },
  ]);
});
it("公式无缓存拒绝选择，缓存明确标识且不执行公式", async () => {
  const wb = await parseCodeMotionXlsx(
    await workbook(rows.replace("<v>12.5</v>", "<f>SUM(B9:B99)</f>"))
  );
  expect(wb.sheets[0].rows[1].cells[1]).toMatchObject({
    kind: "error",
    formulaCached: false,
  });
  expect(() => selectCodeMotionData(wb, 0, 0, 1, 2, 3)).toThrow("不是可用数值");
  const cached = await parseCodeMotionXlsx(
    await workbook(rows.replace("<v>12.5</v>", "<f>SUM(B9:B99)</f><v>12.5</v>"))
  );
  expect(cached.sheets[0].rows[1].cells[1]).toMatchObject({
    kind: "number",
    formulaCached: true,
    value: 12.5,
  });
  expect(cached.warnings.join("")).toContain("未执行");
});
it("拒绝宏外链、DOCTYPE、超行与解压容量，不截断返回成功", async () => {
  await expect(
    parseCodeMotionXlsx(await workbook(rows, { "xl/vbaProject.bin": "x" }))
  ).rejects.toThrow("宏");
  await expect(
    parseCodeMotionXlsx(
      await workbook(rows, {
        "xl/worksheets/_rels/sheet1.xml.rels":
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="evil" TargetMode="External" Target="https://example.test/private"/></Relationships>',
      })
    )
  ).rejects.toThrow("外部链接");
  await expect(
    parseCodeMotionXlsx(
      await workbook(rows, {
        "xl/styles.xml": '<!DOCTYPE a [<!ENTITY a "x">]><styleSheet/>',
      })
    )
  ).rejects.toThrow("实体声明");
  await expect(
    parseCodeMotionXlsx(await workbook(rows.replace('r="B3"', 'r="B202"')))
  ).rejects.toThrow("201行");
  await expect(
    parseCodeMotionXlsx(
      await workbook(rows, {
        "xl/sharedStrings.xml": " ".repeat(8 * 1024 * 1024 + 1),
      })
    )
  ).rejects.toThrow("容量");
});
it("日期不作为数值，百分比保留0.15原数且提醒单位", async () => {
  const styles = `<styleSheet xmlns="${ns}"><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="10"/></cellXfs></styleSheet>`;
  const date = await parseCodeMotionXlsx(
    await workbook(
      rows.replace('<c r="B2"><v>12.5</v>', '<c r="B2" s="1"><v>46000</v>'),
      { "xl/styles.xml": styles }
    )
  );
  expect(date.sheets[0].rows[1].cells[1].kind).toBe("date");
  expect(() => selectCodeMotionData(date, 0, 0, 1, 2, 3)).toThrow(
    "不是可用数值"
  );
  const pct = await parseCodeMotionXlsx(
    await workbook(
      rows.replace('<c r="B2"><v>12.5</v>', '<c r="B2" s="2"><v>0.15</v>'),
      { "xl/styles.xml": styles }
    )
  );
  expect(selectCodeMotionData(pct, 0, 0, 1, 2, 3).data[0].value).toBe(0.15);
  expect(pct.warnings.join("")).toContain("不自动乘100");
});
it("CSV解析引号逗号换行和双引号，空白保留，错误UTF8与不闭合失败", () => {
  const wb = parseCodeMotionCsv(
    Buffer.from('名称,值\r\n"甲,店",12.5\r\n"乙""店\n分店",\r\n')
  );
  expect(selectCodeMotionData(wb, 0, 0, 1, 2, 3).data).toEqual([
    { label: "甲,店", value: 12.5 },
    { label: '乙"店\n分店', value: null },
  ]);
  expect(() => parseCodeMotionCsv(Buffer.from('a,b\n"oops,1'))).toThrow(
    "引号未闭合"
  );
  expect(() => parseCodeMotionCsv(Buffer.from([255]))).toThrow("UTF-8");
  expect(() => parseCodeMotionCsv(Buffer.from("a,b\n1,2,3"))).toThrow("列数");
});
it("PPT所选20行全部保留，MP4同范围明确报超限", () => {
  const wb = parseCodeMotionCsv(
    Buffer.from(
      "名称,值\n" +
        Array.from({ length: 20 }, (_, i) => `第${i + 1}月,${i}`).join("\n")
    )
  );
  expect(selectCodeMotionData(wb, 0, 0, 1, 2, 21, 200).data).toHaveLength(20);
  expect(() => selectCodeMotionData(wb, 0, 0, 1, 2, 21)).toThrow("最多选12");
  expect(() => selectCodeMotionData(wb, 0, 0, -1, 2, 3)).toThrow("存在");
});

it("原数值文字超过六位小数不得被浮点舍入后悄悄接受", () => {
  const wb = parseCodeMotionCsv(
    Buffer.from("名称,数值\n甲,0.100000000000000000001\n乙,2")
  );
  expect(() => selectCodeMotionData(wb, 0, 0, 1, 2, 3)).toThrow("未做舍入");
  expect(
    selectCodeMotionData(
      parseCodeMotionCsv(Buffer.from("名称,值\n甲,10000000e-7\n乙,0e-20")),
      0,
      0,
      1,
      2,
      3
    ).data
  ).toEqual([
    { label: "甲", value: 1 },
    { label: "乙", value: 0 },
  ]);
});
