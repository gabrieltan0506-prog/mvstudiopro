/**
 * 动效 PPT 单页插图：必须套百科版式模板 + 页内容锁定；EvoLink GPT-IMAGE-2 · 16:9 · quality=medium。
 */
import {
  buildHtmlPptSlideImagePrompt,
  resolveHtmlPptImageTemplateId,
} from "../../shared/htmlPptImagePrompt.js";
import type { HtmlPptPage } from "../../shared/htmlPptMaker.js";
import { postEvolinkGptImage2AndUpload, isEvolinkGptImage2Configured } from "./evolinkGptImage2.js";

export async function generateHtmlPptSlideImage(opts: {
  page: HtmlPptPage;
  deckTitle: string;
  /** 用户指定模板；空 / auto → 启发式推荐 */
  templateId?: string | null;
}): Promise<{ imageUrl: string; templateId: string }> {
  const templateId = resolveHtmlPptImageTemplateId(opts.templateId, opts.page);
  const prompt = buildHtmlPptSlideImagePrompt({
    templateId,
    page: opts.page,
    deckTitle: opts.deckTitle,
  });
  if (!prompt.trim()) {
    throw new Error("生图提示词为空");
  }
  if (!isEvolinkGptImage2Configured()) {
    throw new Error("生图服务未配置，请稍后重试");
  }
  const imageUrl = await postEvolinkGptImage2AndUpload(prompt, "html-ppt-slides", {
    aspectRatio: "16:9",
    quality: "medium",
  });
  if (!imageUrl) {
    throw new Error("插图生成失败，请稍后重试");
  }
  return { imageUrl, templateId };
}
