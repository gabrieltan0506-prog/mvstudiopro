import { expect, it } from "vitest";
import { topicDisplayText } from "./platformTopicDisplay";
it("旧草稿隐藏两平台零样本诊断，保留前后正文与承接动作", () => {
 expect(topicDisplayText("具体内容。证据说明：Growth小红书窗口内0条可用样本，本条为待验证创意。承接动作：关注下一期。" )).toBe("具体内容。承接动作：关注下一期。");
 expect(topicDisplayText("具体内容。Growth窗口内0样本，属待验证创意。承接动作：关注下一期。")).toBe("具体内容。承接动作：关注下一期。");
 expect(topicDisplayText("抖音无相关样本。完整正文。")).toBe("完整正文。");
 expect(topicDisplayText("小红书10条样本可供参考。" )).toBe("小红书10条样本可供参考。");
});
