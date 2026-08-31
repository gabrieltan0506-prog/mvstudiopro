import { describe, expect, it } from "vitest";
import {
  buildGeminiNativeDeepReadSegmentPrompt,
  buildGeminiNativeDeepReadSegmentRequest,
  NATIVE_DEEP_READ_RESPONSE_SCHEMA,
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
  "同一段描述套用到不同时间段",
  "两条镜头的画面描述逐字相同",
  "用等长等距的时间切分代替真实剪辑点",
  "镜头内容与该时段实际画面不符",
  "该时段有台词时写与台词情境无关的场面",
  "用其他段落的描述顶替本该逐镜观察的内容",
  "逐字转写全片对白",
  "落在 keyMoments 邻域之外的台词一概不收",
  "为了多写字幕而压缩镜头条数或缩短镜头描述",
  "为凑够音轨段数或声音事件数而编造不存在的声音",
  "凭画面推测声音",
  "长镜拆分时不得截断原镜头尾部",
  "不得为了打破等长而改动真实剪辑点或虚构镜内变化",
  "总结中不得引入镜头表里没有的内容",
  "non_story_ad 除 startSec、endSec、evidenceRole 外，其他描述及衍生内容严禁写入",
  "不得提交仍未通过输出前自检的产出",
];

describe("Gemini 原生读片正向要求与禁止事项分区", () => {
  it.each(cases)(
    "$name：整个请求只有一个禁止区，正向区与重试均不夹禁令",
    row => {
      const prompt = buildGeminiNativeDeepReadSegmentPrompt({
        ...input,
        hasAudio: row.hasAudio,
        rejectedReasonZh: row.retry ? "镜头证据段超过33秒" : undefined,
      });
      const parts = prompt.split("【不得出现】");
      expect(parts).toHaveLength(2);
      const [positive, negative] = parts as [string, string];
      // 检查完整正向文本，包括过去漏掉的正向要求一到五、广告分支和重试。
      expect(positive).not.toMatch(
        /禁止|不得|不要|严禁|一概不收|只增不减|不引入/
      );
      expect(negative).not.toMatch(
        /必须|按实际听到的写|亲耳所听|按前文长镜拆分规则拆成多条/
      );
      expect(positive).toContain("【正向要求五");
      expect(positive).toContain(
        "仅保留 startSec、endSec、evidenceRole 三个字段"
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
        expect(positive).toContain("【上一轮未通过的检查】镜头证据段超过33秒");
        expect(positive).toContain(
          "只修正上面点名的问题，其余一律照常完整观察"
        );
        expect(positive).toContain("按前文长镜拆分规则拆成多条");
        expect(positive).toContain(
          "每条证据的画面描述必须来自你在该时间段真实看到的内容"
        );
        expect(negative).toContain("镜头表条数只增不减");
        expect(negative).toContain("不得删掉、不得合并、不得拉长单条覆盖");
        expect(negative).toContain(
          "禁止用「剧情推进」「人物交替出现」「交谈与动作」「表情自然」"
        );
        expect(negative).toContain("各条不得雷同");
      } else {
        expect(negative).not.toContain("重试禁止事项");
      }
      expect(negative.includes('不要为了"补足"而增加不存在的声音事件')).toBe(
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
            fileUri: "gs://test-bucket/segment.mp4",
            fps: 12,
            prompt,
          })
        )
      );
      expect(wire.contents[0].parts[1].text).toBe(prompt);
      expect(wire.generationConfig.thinkingConfig).toEqual({
        thinkingLevel: "LOW",
        includeThoughts: false,
      });
      expect(wire.generationConfig.responseSchema).toEqual(
        NATIVE_DEEP_READ_RESPONSE_SCHEMA
      );
    }
  );

  it.each(cases)("$name：整理位置后20项字数上限仍与schema相同", row => {
    const prompt = buildGeminiNativeDeepReadSegmentPrompt({
      ...input,
      hasAudio: row.hasAudio,
      rejectedReasonZh: row.retry ? "镜头条目不足" : undefined,
    });
    const declared = Array.from(
      prompt.matchAll(/^- ([A-Za-z][A-Za-z0-9]*)：[^\n]*?≤(\d+)字/gm)
    );
    expect(declared).toHaveLength(20);
    const limits = new Map<string, number>();
    const walk = (node: unknown) => {
      if (!node || typeof node !== "object") return;
      const record = node as Record<string, unknown>;
      for (const [key, value] of Object.entries(record.properties || {})) {
        if (value && typeof value === "object" && "maxLength" in value) {
          limits.set(key, Number(value.maxLength));
        }
        walk(value);
      }
      walk(record.items);
    };
    walk(NATIVE_DEEP_READ_RESPONSE_SCHEMA);
    for (const [, field, maximum] of declared)
      expect(Number(maximum), field).toBe(limits.get(field!));
  });
});
