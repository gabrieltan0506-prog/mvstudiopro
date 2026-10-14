import { describe, expect, it } from "vitest";
import { mainActionKinds, speechFeasibilityFindings, ungroundedMeasureReferences } from "./viralDraftFeasibility";
import { auditXhsCreationPackage } from "./xhsCreationPackage";
import { fictionalViralBlueprint } from "./viralCreation.fixture";

describe("v2实际输出的定向可行性检查", () => {
 it("主动作不能同时关注与评论，否定动作和下期题材不误伤", () => {
  expect(mainActionKinds("关注看下一期，或在评论区聊聊常去的店")).toEqual(["关注","评论"]);
  expect(mainActionKinds("不用留言，关注看下一期“怎么预约咖啡体验”")).toEqual(["关注"]);
  expect(mainActionKinds("私信咨询或者站内咨询")).toEqual(["咨询"]);
  const bp=fictionalViralBlueprint();bp.xhsPackage.conversion.action="关注看下一篇，或在评论区聊聊经历";
  expect(auditXhsCreationPackage(bp).findings.some(f=>f.code==="multiple_actions")).toBe(true);
 });
 it("2秒26字不能当自然口播，合理分配和明确快嘴保持可用", () => {
  const cells=[{dialogueZh:"下次进店照这三个问题问一遍就能点出一杯适合你的咖啡"}];
  expect(speechFeasibilityFindings("0:28–0:30 镜8",cells).some(f=>f.code==="speech_timing")).toBe(true);
  expect(speechFeasibilityFindings("0:25–0:30 镜8",cells)).toEqual([]);
  expect(speechFeasibilityFindings("0:28–0:30 镜8",cells,"明确要求快嘴绕口令")).toEqual([]);
  expect(speechFeasibilityFindings("0:25–0:30 镜8",cells,"本轮口播合计不超过10个汉字").some(f=>f.code==="speech_length")).toBe(true);
 });
 it("单位换算不能补造参照容积，有明确参照规格才采用", () => {
  const text="300毫升也就是0.3升，大概是一个常见马克杯的量级";
  expect(ungroundedMeasureReferences(text,"仅提供示例300毫升=0.3升，不等于标准马克杯").some(f=>f.code==="measure_reference")).toBe(true);
  expect(ungroundedMeasureReferences("示例300毫升=0.3升。","仅提供单位换算示例")).toEqual([]);
  expect(ungroundedMeasureReferences(text,"参照马克杯容量为300毫升")).toEqual([]);
 });
});


it("实际秒数小数格式与明确句后停顿不能绕过窗口检查", () => {
 const cells=[{dialogueZh:"下一期教你说清自己的口味关注我",editNoteZh:"说完留约1.5秒窗口不加速"}];
 expect(speechFeasibilityFindings("【镜7｜27.0–30.0秒】",cells).some(f=>f.code==="speech_timing")).toBe(true);
 expect(speechFeasibilityFindings("【镜7｜25.0–30.0秒】",cells)).toEqual([]);
});
