import { expect, it } from "vitest";
import { requestsAdvisorPrevisRender } from "./manhuaAdvisorPrevisIntent";
it.each(["曹三逼近时镜头更有压迫感。保留动作和对白，先生成一版白模给我看看。", "生成试看", "不要改动作，生成白模给我看", "不要另开链接，生成试看", "渲染一版視頻", "把白模渲染出来"])("明确生成指令：%s", text => expect(requestsAdvisorPrevisRender(text)).toBe(true));
it.each(["不要生成视频，只讨论", "先不要渲染白模", "如果生成白模会怎样", "生成试看需要多久？", "先讨论方案，之后生成试看", "别急着生成视频", "镜头再有冲击力一点", "请解释生成视频的方法"])("讨论或否定不触发：%s", text => expect(requestsAdvisorPrevisRender(text)).toBe(false));
