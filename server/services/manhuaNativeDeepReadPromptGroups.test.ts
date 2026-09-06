import { describe, expect, it } from "vitest";
import {
  buildGeminiNativeDeepReadSegmentPrompt,
  buildGeminiNativeDeepReadSegmentRequest,
  NATIVE_DEEP_READ_RESPONSE_SCHEMA,
  buildNativeDeepReadResponseSchema,
} from "./manhuaNativeDeepReadRunner.js";

const input = {
  episodeDurationSec: 1594,
  startSec: 319,
  endSec: 638,
  segmentIndex: 1,
  segmentCount: 5,
  videoFps: 12,
};
const cases = [
  { name: "有音轨首发", hasAudio: true, retry: false },
  { name: "有音轨重试", hasAudio: true, retry: true },
  { name: "无音轨首发", hasAudio: false, retry: false },
  { name: "无音轨重试", hasAudio: false, retry: true },
];

// 按业务规则断言保留项，而不是只验证标题存在或局部关键词消失。
const commonProhibitions = [
  "将 MM:SS 或 HH:MM:SS 去掉冒号后直接当作累计秒",
  "例如把文件内 05:13 的本段累计秒误写为 513",
  "用等长等距的时间切分代替真实剪辑点",
  "镜头内容与该时段实际画面不符",
  "该时段有台词时写与台词情境无关的场面",
  "用其他段落的描述顶替本该逐镜观察的内容",
  "将补充信息中的场景、道具或动作直接当成当前镜头的可见事实",
  "逐字转写全片对白",
  "收录 keyMoments 前后2秒范围之外的台词",
  "为了多写字幕而压缩镜头条数或缩短镜头描述",
  "为凑够音轨段数或声音事件数而编造不存在的声音",
  "凭画面推测声音",
  "长镜拆分时截断原镜头尾部",
  "为了打破等长而改动真实剪辑点或虚构镜内变化",
  "在总结中引入镜头表里没有的内容",
  "给 non_story_ad 的 hintZh 填写非null内容，或填写 startSec、endSec、evidenceRole、hintZh、detailLevel 之外的字段",
  "单条 shots 记录的 endSec − startSec 超过 30 秒",
  "把同一长镜的证据段边界伪报为真实剪辑切换",
];

describe("Gemini 原生读片正向要求与禁止事项分区", () => {
  it("实际请求逐镜先生成时间、分类与必填观察；广告占位和正文同序", () => {
    const prompt = buildGeminiNativeDeepReadSegmentPrompt({ ...input, hasAudio: true });
    const schema = buildNativeDeepReadResponseSchema({ ...input, hasAudio: true }) as any;
    const shot = schema.properties.shots.items.anyOf[0];
    expect(shot.required).toContain("hintZh");
    expect(shot.properties.hintZh).toMatchObject({ type: "STRING", nullable: false });
    expect(shot.properties.hintZh.description).toContain("≤80字");
    expect(shot.propertyOrdering.slice(0, 5)).toEqual(["startSec", "endSec", "evidenceRole", "detailLevel", "hintZh"]);
    const section = prompt.split("【正向要求二：逐镜分析 shots】")[1]!.split("【正向要求三")[0]!;
    const fields = Array.from(section.matchAll(/^- ([A-Za-z]+)(?: \/ ([A-Za-z]+))?：/gm))
      .flatMap(match => [match[1], ...(match[2] ? [match[2]] : [])]);
    expect(fields).toEqual(shot.propertyOrdering.filter((key: string) => key !== "detailLevel"));
    expect(prompt).toContain("hintZh固定填null");
    expect(prompt).not.toContain("看不清时写明可见范围");
    expect(prompt).not.toContain("使用完整18字段结构");
    expect(schema.propertyOrdering[0]).toBe("keyMoments");
    expect(prompt).toContain("实际相同的呈现方式可以重复");
  });
  it.each(cases)(
    "$name：整个请求只有一个禁止区，正向区与重试均不夹禁令",
    row => {
      const prompt = buildGeminiNativeDeepReadSegmentPrompt({
        ...input,
        hasAudio: row.hasAudio,
        rejectedReasonZh: row.retry ? "镜头证据段超过33秒" : undefined,
      });
      const parts = prompt.split("【禁止事项】");
      expect(parts).toHaveLength(2);
      const [positive, negative] = parts as [string, string];
      // 检查完整正向文本，包括过去漏掉的正向要求一到五、广告分支和重试。
      expect(positive).not.toMatch(
        /禁止|不得|不要|严禁|一概不收|只增不减|不引入|不补猜|省略不写/
      );
      expect(negative).not.toMatch(
        /禁止|不得|不要|严禁|一概不收|只增不减|必须|按实际听到的写|亲耳所听|按前文长镜拆分规则拆成多条/
      );
      expect(positive).toContain("【正向要求五");
      expect(positive).toContain(
        "仅保留 startSec、endSec、evidenceRole 三个有内容的字段"
      );
      expect(positive).toContain("总结");
      expect(positive).toContain("每条 shots 记录最长 30 秒");
      expect(positive).toContain(
        "真实剪辑镜头按实际起止秒位记录，短于 3 秒也完整保留"
      );
      expect(positive).toContain("同一长镜的每个拆分证据段保持 3—30 秒");
      expect(positive).toContain("相邻镜头时长可以相同");
      expect(positive).not.toContain("每 3—6 秒");
      expect(positive).not.toContain("最长 6 秒");
      expect(positive).not.toContain("1—30 秒");
      expect(negative).not.toContain("连续镜头的时长不得相等");
      for (const rule of commonProhibitions) expect(negative).toContain(rule);

      if (row.retry) {
        expect(positive).toContain("【上一轮未通过的检查】镜头证据段超过30秒输出上限");
        expect(positive).toContain(
          "只修正上面点名的问题，其余一律照常完整观察"
        );
        expect(positive).toContain("按前文长镜拆分规则拆成多条");
        expect(positive).toContain(
          "每条证据的画面描述必须来自你在该时间段真实看到的内容"
        );
        expect(negative).toContain("重试时减少镜头表条数");
        expect(negative).toContain("修正过长证据段时删掉、合并记录，或拉长单条覆盖");
        expect(negative).toContain(
          "重试时用「剧情推进」「人物交替出现」「交谈与动作」「表情自然」"
        );
        expect(negative).not.toContain("给不同镜头填写雷同描述");
      } else {
        expect(negative).not.toContain("重试时减少镜头表条数");
      }
      expect(negative.includes('重试时为了"补足"而增加不存在的声音事件')).toBe(
        row.retry && row.hasAudio
      );
      if (!row.hasAudio) {
        expect(positive).toContain(
          "本段素材没有音轨，audioResolution 返回空数组 []"
        );
        expect(positive).not.toContain("声音部分按实际听到的写");
      }

      // 检查最终序列化请求所使用的正文，避免测试到没有实际发送的旁路模板。
      const wire = JSON.parse(
        JSON.stringify(
          buildGeminiNativeDeepReadSegmentRequest({
            segmentContext: { ...input, hasAudio: row.hasAudio },
            fileUri: "gs://test-bucket/segment.mp4",
            fps: 12,
            prompt,
          })
        )
      );
      expect(wire.contents[0].parts[1].text).toBe(prompt);
      expect(wire.generationConfig.thinkingConfig).toEqual({
        thinkingLevel: "MEDIUM",
        includeThoughts: false,
      });
      expect(wire.generationConfig.responseSchema).toEqual(
        buildNativeDeepReadResponseSchema({ ...input, hasAudio: row.hasAudio })
      );
    }
  );

  it("真实108秒拒因进入重试正文时保留位置，去掉内部容差和混入的禁令", () => {
    const reason = "原生精读密度门禁：第1段有 1 个超过 33 秒的镜头证据段（要求 30 秒 + 10% 容差）：第37镜 205—313 秒（108 秒）；这几条必须按镜内变化拆成连续证据段，禁止截断尾部";
    const prompt = buildGeminiNativeDeepReadSegmentPrompt({
      ...input, startSec: 0, endSec: 313.04, hasAudio: true, rejectedReasonZh: reason,
    });
    const request = buildGeminiNativeDeepReadSegmentRequest({
      segmentContext: { startSec: 0, endSec: 313.04, segmentIndex: input.segmentIndex, hasAudio: true },
      fileUri: "gs://test-bucket/segment.mp4", fps: 12, prompt,
    }) as any;
    const wire = JSON.parse(JSON.stringify(request));
    const positive = wire.contents[0].parts[1].text.split("【禁止事项】")[0];
    expect(positive).toContain("第37镜 205—313 秒（108 秒）");
    expect(positive).not.toMatch(/(?:超过|拒收线)\s*33\s*秒|容差|禁止|不得|不要|输出前自检|回去拆/);
    expect(wire.generationConfig.responseSchema.properties.shots.description).not.toMatch(/33秒|容差/);
    expect(wire.generationConfig.responseSchema.properties.shots.items.anyOf[0].properties.endSec.description)
      .toContain("startSec < endSec ≤ startSec + 30");
    // 33也可能是原片真实时间，不能通过全局替换抹掉观测值。
    const realTime = buildGeminiNativeDeepReadSegmentPrompt({
      ...input, hasAudio: true, rejectedReasonZh: "第2镜 33—141 秒（108 秒）",
    });
    expect(realTime).toContain("第2镜 33—141 秒（108 秒）");
  });

  it.each(cases)("$name：整理位置后24项字数上限仍与schema相同", row => {
    const prompt = buildGeminiNativeDeepReadSegmentPrompt({
      ...input,
      hasAudio: row.hasAudio,
      rejectedReasonZh: row.retry ? "镜头条目不足" : undefined,
    });
    const declared = Array.from(
      prompt.matchAll(/^- ([A-Za-z][A-Za-z0-9]*)：[^\n]*?≤(\d+)字/gm)
    );
    expect(declared).toHaveLength(24);
    const limits = new Map<string, number>();
    const schema = buildNativeDeepReadResponseSchema({ ...input, hasAudio: row.hasAudio });
    const wireLimits = new Map<string, number>();
    const walk = (node: unknown, target: Map<string, number>, fromDescription = false) => {
      if (!node || typeof node !== "object") return;
      const record = node as Record<string, unknown>;
      for (const [key, value] of Object.entries(record.properties || {})) {
        if (value && typeof value === "object") {
          if (!fromDescription && "maxLength" in value) target.set(key, Number(value.maxLength));
          if (fromDescription && "description" in value) {
            const limit = String(value.description).match(/≤(\d+)字/);
            if (limit) target.set(key, Number(limit[1]));
          }
        }
        walk(value, target, fromDescription);
      }
      walk(record.items, target, fromDescription);
      if (Array.isArray(record.anyOf)) record.anyOf.forEach(branch => walk(branch, target, fromDescription));
    };
    walk(NATIVE_DEEP_READ_RESPONSE_SCHEMA, limits);
    walk(schema, wireLimits, true);
    expect(wireLimits.size).toBe(24);
    for (const [, field, maximum] of declared) {
      expect(Number(maximum), field).toBe(limits.get(field!));
      expect(Number(maximum), `实际请求${field}`).toBe(wireLimits.get(field!));
    }
  });
});
