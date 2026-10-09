import {describe,expect,it,vi} from "vitest";
vi.mock("./gcs",()=>({getGcsBucketName:()=>"test-only",inspectGcsObjectBounded:vi.fn(),uploadBufferToGcsIfAbsent:vi.fn()}));
vi.mock("./knowledgeCardEpubToPdf",()=>({buildEpubPrintHtml:vi.fn(),parseEpub:vi.fn(),splitEpubChaptersIntoShards:vi.fn()}));
import{isScannedConversionEpub}from"./fileConversion";
describe("电子书扫描形态检测",()=>{
 it("带文字目录的扫描书仍进入识别，不因目录绕开收费",()=>{expect(isScannedConversionEpub(["目录","<img>","<img>","<img>"],["目录标题".repeat(30),"","",""])).toBe(true);});
 it("普通书少量封面/插图不误按整本扫描收费",()=>{expect(isScannedConversionEpub(["<img>","正文","正文","正文"],["","正文".repeat(100),"正文".repeat(100),"正文".repeat(100)])).toBe(false);expect(isScannedConversionEpub(["无图短句"],["短句"])).toBe(false);});
});
