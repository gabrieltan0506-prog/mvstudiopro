import { expect, it } from "vitest";
import { topicDisplayText, topicReasonDisplay } from "./platformTopicDisplay";
it("旧草稿隐藏两平台零样本诊断，保留前后正文与承接动作", () => {
 expect(topicDisplayText("具体内容。证据说明：Growth小红书窗口内0条可用样本，本条为待验证创意。承接动作：关注下一期。" )).toBe("具体内容。承接动作：关注下一期。");
 expect(topicDisplayText("具体内容。Growth窗口内0样本，属待验证创意。承接动作：关注下一期。")).toBe("具体内容。承接动作：关注下一期。");
 expect(topicDisplayText("抖音无相关样本。完整正文。")).toBe("完整正文。");
 expect(topicDisplayText("小红书10条样本可供参考。" )).toBe("小红书10条样本可供参考。");
});

it("原页两条24字历史片段识别为疑似不完整，完整长理由不截断", () => {
 for (const text of ["适配依据：人群（刚入职年轻人）×高频具体场景（会", "适配依据：与选题一同一主题但走'同条件对比'切口"]) {
  expect(topicReasonDisplay(text)).toEqual({ text, incomplete: true });
 }
 const full = "面向刚入职年轻人，以会议突然被问进度的真实困扰为切口。".repeat(20);
 expect(topicReasonDisplay(full)).toEqual({text:full,incomplete:false});
 expect(topicReasonDisplay("一个简短但完整的理由。").incomplete).toBe(false);
});
