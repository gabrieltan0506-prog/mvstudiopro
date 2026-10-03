# 底本小说改编：方法来源与实现边界

用户要求底本、方向与所选模板共同驱动 LLM 小说改编，再使用同一模板生成可拍剧情。源码路径为 `shared/manhuaNovelAdaptation.ts`、`server/services/manhuaNovelAdaptationRun.ts` 及既有扩写入口。

参考 [PenglongHuang/chinese-novelist-skill](https://github.com/PenglongHuang/chinese-novelist-skill/tree/cb6c3e7d0563c6a685e6539ea642642ab98855d7)，MIT，2026-10-03 核对。已读 SKILL.md、phase3-writing.md、dialogue-writing.md、character-building.md。借鉴人物目标/弱点、动作呈现、对话潜台词、章节因果和一次集中修订的流程，以独立中文规则写入服务；未安装其脚本、未执行远端代码，未采用逐题问答、多Agent自动写作或建立独立小说目录。

- 模板在两阶段都参与，必须来自现有 approved 服务；完整模板只送模型，客户端保留模板指纹，不泄漏商业卡全文。
- 第一步生成真正小说正文和改编说明，第二步读取完整小说，再按既有时长/段落契约生成剧情。底本、小说、模型与模板指纹按集保留，会话恢复和局部重写沿现有链路。
- 复用现有 GLM 5.3 FlashX、DeepSeek V4.1 Flash 模型标识、密钥获取、供应商锁和 SSE 读取器。GLM 拥堵/断流切 DeepSeek，鉴权和安全拦截不自动切；正常数据持续时不按总时长杀掉请求。没有新增 API 配置。
- 对白几乎全为五字内碎句时，最多集中修订一次，仍不通过则不采用/不扣点。此检查只捕捉用户指出的模式，不等于文学质量、人物一致性或原著忠实度已获验证。
- 未调用真实模型生成用户书籍；长时间线上连接、两阶段最终文学质量与计费闭环仍须正式工作流验收。当前是所选底本片段的改编，不是整书无人工分卷的持久任务系统；断线可能需要重试，完成前的中间小说尚无跨服务重启恢复。

## MIT 许可

MIT License

Copyright (c) 2026 PenglongHuang

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
