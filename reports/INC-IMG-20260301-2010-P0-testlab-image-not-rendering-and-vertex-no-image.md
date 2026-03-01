# INC-IMG — TestLab 生图不可用 / 不渲染 / Vertex 返回 no_image_in_response（P0）

## 结论（给业务看的）
- TestLab 当前“生图”链路在部分模型/Provider 下会出现 **仅返回文本** 或 **no_image_in_response**，导致 UI 只看到 JSON，看不到图片。
- 该问题会直接阻塞“生图功能可测/可用”，属于 **P0**。

## 影响范围
- 页面：/test-lab
- 能力：图像生成（nano-banana-flash / nano-banana-pro 等）
- 环境：Vercel Production（serverless）

## 复现步骤（最少步骤）
1) 访问：`https://www.mvstudiopro.com/test-lab`
2) 选择图像模型（例如 Nano Banana Pro）
3) 输入任意 prompt，点击生成
4) 现象：
   - UI 仅显示 JSON，不显示图片
   - 或返回：
     - `image_generation_failed`
     - `stage: vertex`
     - `error: no_image_in_response`

## 观测证据（用户提供/线上日志摘要）
- 用户侧返回样例（节选）：
  - `error: "no_image_in_response"`
  - `modelVersion: "gemini-2.5-flash-image"`
  - `location: "us-west1"`
- 另有函数错误历史（节选）：
  - `ERR_MODULE_NOT_FOUND`（serverless import 不当）
  - `Invalid regular expression: missing /`（冲突标记/脚本插坏导致）
  - `Unsupported provider`（provider 解析/覆盖逻辑异常）

## 初步根因假设（按优先级）
1) **调用的是“文本/多模态 generateContent”路径，但未显式请求 image 输出**  
   - 返回 candidates.parts[].text，导致 no_image_in_response
2) **模型/区域可用性与实际调用 endpoint 不一致**  
   - 同名模型在不同 region 发布策略不同
3) **TestLab 只打印 JSON，未做 imageUrl 展示（或字段名不一致）**  
   - imageUrl/base64 已返回但 UI 未渲染
4) **provider default/override 逻辑误伤 paid provider**  
   - 选择 pro 也被降级/覆盖

## 需要的验收标准（Done）
- [ ] TestLab 图像生成：点击生成后能在页面直接看到图片（img 渲染成功）
- [ ] pro 与 flash：选择 pro 不会被强制覆盖成 flash（仅缺省时 default）
- [ ] /api/jobs：对 image 请求返回统一字段：
  - `ok=true`
  - `type="image"`
  - `provider`
  - `imageUrl`（data url 或可访问 url）
- [ ] 失败时返回结构化 error（不抛 HTML 500）

## 行动项（下一步）
- [ ] A：统一 image 生成返回结构（imageUrl），并补齐 UI 渲染逻辑（img + loading + error）
- [ ] B：修正“请求 image 输出”的调用方式（避免只返回 text）
- [ ] C：恢复 paid provider 选择，不做强制覆盖（只做 default）
- [ ] D：补充 serverless import 规则校验（禁止 import server/* 进入 api/*.ts）
