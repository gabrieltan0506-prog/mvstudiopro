/**
 * 动效 PPT 单页插图：必须套百科版式模板 + 页内容锁定。
 * 生图：官方 OpenAI gpt-image-2 →（失败）OpenRouter；不走 EvoLink。
 */
import {
  buildHtmlPptSlideImagePrompt,
  resolveHtmlPptImageTemplateId,
} from "../../shared/htmlPptImagePrompt.js";
import type { HtmlPptPage } from "../../shared/htmlPptMaker.js";
import { isOpenAiGptImage2Configured, postOpenAiGptImage2AndUpload } from "./openaiGptImage2.js";
import {
  isOpenRouterGptImage2Configured,
  postOpenRouterGptImage2AndUpload,
} from "./openrouterGptImage2.js";

export async function generateHtmlPptSlideImage(opts: {
  page: HtmlPptPage;
  deckTitle: string;
  /** 用户指定模板；空 / auto → 启发式推荐 */
  templateId?: string | null;
  /** 演示风格：插图配色对齐所选 PPT 模板 */
  styleId?: string | null;
}): Promise<{ imageUrl: string; templateId: string }> {
  const templateId = resolveHtmlPptImageTemplateId(opts.templateId, opts.page);
  const prompt = buildHtmlPptSlideImagePrompt({
    templateId,
    page: opts.page,
    deckTitle: opts.deckTitle,
    styleId: opts.styleId,
  });
  if (!prompt.trim()) {
    throw new Error("生图提示词为空");
  }

  const openaiReady = isOpenAiGptImage2Configured();
  const openrouterReady = isOpenRouterGptImage2Configured();
  if (!openaiReady && !openrouterReady) {
    throw new Error("生图服务未配置，请稍后重试");
  }

  if (openaiReady) {
    const imageUrl = await postOpenAiGptImage2AndUpload(prompt, "html-ppt-slides", {
      aspectRatio: "16:9",
      quality: "medium",
    });
    if (imageUrl) return { imageUrl, templateId };
  }

  if (openrouterReady) {
    const imageUrl = await postOpenRouterGptImage2AndUpload(prompt, "html-ppt-slides", {
      aspectRatio: "16:9",
      quality: "medium",
    });
    if (imageUrl) return { imageUrl, templateId };
  }

  throw new Error("插图生成失败，请稍后重试");
}
